import { mad, median, percentile } from "./stats";
import type { OfferClass, OfferEvaluation, PricingProfileConfig } from "./types";

export interface OutlierReport {
  method: string;
  lowerBound: number | null;
  upperBound: number | null;
  removed: number;
  staleLowRemoved: number;
  highOutlierRemoved: number;
  /** قیمت‌های «مشکوک پایین» از محاسبه خارج شده ولی برای حفظ شفافیت به زیرخودکار برگردانده می‌شود */
  suspectLows: { price: number; shopName: string; cls: OfferClass }[];
  /** مرجع میانه وزنی فروشندگان به‌روز و معتبر (طبقه‌بندی R0/R1) */
  stableRefPrice: number | null;
}

export interface ClassificationOptions {
  isCostlessMode?: boolean;
  now?: Date;
  highTrustScoreThreshold?: number;
  /**
   * تخمین‌گر v2: طبقه‌بندی سمت پایین (R0/R1) را مدل احتمالی اعتبار (validity.ts) انجام داده است؛
   * اینجا فقط «گران‌فروش پرتِ» سمت بالا حذف می‌شود.
   */
  highSideOnly?: boolean;
}

function isTrusted(o: OfferEvaluation, highTrustScoreThreshold: number): boolean {
  if (o.shopScore == null) {
    // بدون امتیاز همیشه «نه معتبر قطعی» است (مگر فاصله معقول از مرجع در R1 عبور کند)
    return false;
  }
  return o.shopScore >= highTrustScoreThreshold;
}

/**
 * مرحله ۲ (نسخه ۴.۱): حذف/طبقه‌بندی داده‌های پرت با معیار «تازگی و اعتبار»
 *
 * چرا دیگر فقط حذف نمی‌کنیم؟ چون طبقه‌بندی سه‌پله‌ای در ۴.۱ شامل:
 *  R0) «خوشه تاییدشده» (confirmed_low):
 *      یک گروه فروشندگان به‌روز + معتبر (touq قیمتی نزدیک به هم) با حداقل ۲ عضو — این یک «هسته واقعی قیمت پایین» است و هیچ‌گاه به خاطر نبود مویانه حذف نمی‌شود.
 *  R1) «باند بدگمانی» (suspect_low):
 *      فروشنده‌ای که بیش از `suspectLowBandPct` زیر مرجع است ولی خوشه تایید ندارد:
 *      - قیمتش قدیمی است => stale_low (حذف)
 *      - فروشنده غیرمعتبر است => suspect_low (حذف، ولی برای شفافیت در گزارش می‌ماند)
 *      - فروشنده معتبر و تازه است ولی تنهاست => suspect_low (حذف؛ به عنوان سیگنال مغزدار)
 *  R2) قیمت‌های فوق‌العاده پایین و منزوی (همان suspect_low نه‌ریویو شده) از داده خوب حذف می‌شوند.
 *  سمت بالا: باند سخت (hardBandPct) و IQR/MAD حذف‌شان می‌کند (هیچ «گران‌فروشی پرتِ» رو به بالا نمی‌ماند).
 */
export function removeOutliers(
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["outliers"],
  opts?: ClassificationOptions,
): OutlierReport {
  const included = offers.filter((o) => o.included);
  let removed = 0;
  let staleLowRemoved = 0;
  let highOutlierRemoved = 0;
  const now = opts?.now ?? new Date();
  const highTrustScoreThreshold = opts?.highTrustScoreThreshold ?? 4.5;

  const suspectLows: OutlierReport["suspectLows"] = [];

  const markSuspect = (o: OfferEvaluation, cls: "stale_low" | "suspect_low", reason: string) => {
    o.included = false;
    o.weight = 0;
    o.cls = cls;
    o.excludeReason = reason;
    removed++;
    if (cls === "stale_low") staleLowRemoved++;
    suspectLows.push({ price: o.price, shopName: o.shopName, cls });
  };

  const markHigh = (o: OfferEvaluation, reason: string) => {
    o.included = false;
    o.weight = 0;
    o.cls = "high_outlier";
    o.excludeReason = reason;
    removed++;
    highOutlierRemoved++;
  };

  if (included.length < 2) {
    // با ۰ یا ۱ فروشنده، هیچ نخاعی دست‌خورده نمی‌شود — چون طبقه‌بندی از حداقل داده بی‌معناست
    for (const o of included) {
      o.cls = "ok";
      o.fresh = Boolean(o.lastChangedAt);
      o.credible = isTrusted(o, highTrustScoreThreshold);
    }
    return {
      method: cfg.method,
      lowerBound: null,
      upperBound: null,
      removed: 0,
      staleLowRemoved: 0,
      highOutlierRemoved: 0,
      suspectLows: [],
      stableRefPrice: included[0]?.price ?? null,
    };
  }

  // ۱) فلگ‌گذاری تازگی و اعتبار برای کل پول
  for (const o of included) {
    const ageDays = o.lastChangedAt
      ? (now.getTime() - o.lastChangedAt.getTime()) / 86_400_000
      : null;
    o.fresh = ageDays != null && ageDays <= Math.max(0, cfg.freshCutoffDays);
    o.credible = isTrusted(o, highTrustScoreThreshold);
    o.highTrust = o.credible;
  }

  // ۲) مرجع = میانه وزنی فقط از «به‌روز + معتبر»؛ اما تنها وقتی این زیرمجموعه «نماینده» است:
  //    حداقل max(۳، ۴۰٪ کل پیشنهادهای موجود). وگرنه مرجع از کل پول ساخته می‌شود تا
  //    یک یا دو ارزان‌فروش تازه، مرجع را پایین نکشند و بدنه‌ی سالم بازار «گران‌فروش پرت» نشود.
  const stablePool = included.filter((o) => o.fresh && o.credible);
  const minStablePool = Math.max(3, Math.ceil(included.length * 0.4));
  const refPool = stablePool.length >= minStablePool ? stablePool : included;
  const stableRef = weightedMedianInt(refPool);
  if (stableRef == null) {
    return {
      method: cfg.method,
      lowerBound: null,
      upperBound: null,
      removed: 0,
      staleLowRemoved: 0,
      highOutlierRemoved: 0,
      suspectLows: [],
      stableRefPrice: null,
    };
  }

  // ۳) سقف پایین بدگمانی (R1) و سقف بالای سخت.
  //    سمت بالا هرگز تنگ‌تر از ۱۰٪ بالای مرجع نیست؛ در نمونه‌های کوچک IQR/MAD ناپایدار است
  //    و حذف «گران‌فروش پرت» نباید به قیمت حذف بدنه‌ی عادی تمام شود.
  const bandLo = stableRef * (1 - Math.max(0, cfg.suspectLowBandPct) / 100);
  const highBandPct = Math.max(10, Math.max(0, cfg.hardBandPct));
  const bandHi = stableRef * (1 + highBandPct / 100);

  // ۴) ساخت خوشه‌ها بر اساس فاصله قیمتی (٪) بین همسایه‌ها
  const sorted = [...included].sort((a, b) => a.price - b.price);
  const clusterPct = Math.max(0.5, cfg.classifyClusterPct) / 100;
  const clusters: OfferEvaluation[][] = [];
  let current: OfferEvaluation[] = [];
  for (const o of sorted) {
    if (!current.length) {
      current = [o];
      continue;
    }
    const prev = current[current.length - 1];
    const stepGap = (o.price - prev.price) / Math.max(1, prev.price);
    const leaderGap = (o.price - current[0].price) / Math.max(1, current[0].price);
    if (stepGap > clusterPct * 0.65 || leaderGap > clusterPct) {
      clusters.push(current);
      current = [o];
    } else {
      current.push(o);
    }
  }
  if (current.length) clusters.push(current);

  for (const cluster of clusters) {
    const freshCredibleCount = cluster.filter((o) => o.fresh && o.credible).length;
    const isConfirmedCluster =
      cluster[0].price <= stableRef &&
      freshCredibleCount >= Math.max(2, cfg.minClusterMembers);
    for (const o of cluster) {
      if (o.price <= stableRef && isConfirmedCluster) {
        // R0: هسته تاییدشده ارزان — هیچ‌گاه به‌عنوان پرت حذف نمی‌شود
        o.cls = "confirmed_low";
        continue;
      }
      if (o.price < bandLo && !opts?.highSideOnly) {
        // R1: زیر باند بدگمانی
        if (!o.fresh) {
          markSuspect(
            o,
            "stale_low",
            `قیمت کهنه و بیش از ${cfg.suspectLowBandPct}% زیر مرجع بازار (فروشنده به‌روز نشده)`,
          );
          continue;
        }
        if (!o.credible || cluster.length < 2) {
          markSuspect(
            o,
            "suspect_low",
            `فروش منفرد بیش از ${cfg.suspectLowBandPct}% زیر مرجع بازار و فاقد خوشه همقیمت معتبر`,
          );
          continue;
        }
        // فروشنده معتبر و تازه با همراه — از داده خوب می‌ماند (پیشنهاد متقاضی معتبر)
        o.cls = "ok";
      } else if (o.price > bandHi) {
        markHigh(
          o,
          `اختلاف زیاد رو به بالا با مرجع بازار (+${(((o.price - stableRef) / stableRef) * 100).toFixed(1)}%) — گران‌فروشی نقش‌آفرین`,
        );
      } else if (!o.cls) {
        o.cls = "ok";
      }
    }
  }

  const rest = offers.filter((o) => o.included);

  // ۵) تجهیز انتخاب statistical فقط برای «سمت بالا» (IQR و MAD) — سمت پایین با R0/R1 انجام شد
  if (rest.length >= cfg.minSamples && cfg.method !== "band") {
    const prices = rest.map((o) => o.price);
    const q1 = percentile(prices, 25);
    const q3 = percentile(prices, 75);
    const iqr = q3 - q1;
    const m = median(prices);
    const normMad = mad(prices) * 1.4826;
    let hi = bandHi;
    if (cfg.method === "iqr") {
      hi = Math.min(bandHi, q3 + cfg.iqrK * iqr);
      // در حالت بی‌هزینه، MAD حلقه نهایی تقویت بالا
      if (opts?.isCostlessMode && normMad > 0) {
        hi = Math.min(hi, m + cfg.madK * normMad);
      }
    } else if (cfg.method === "mad" && normMad > 0) {
      hi = Math.min(bandHi, m + cfg.madK * normMad);
    }
    // سمت بالا: پیشنهاد تنها وقتی «پرت» است که دست‌کم ۱۰٪ بالای میانه باشد
    hi = Math.max(hi, m * 1.1);
    for (const o of rest) {
      if (o.price > hi) {
        markHigh(o, `داده پرت بالای آماری (${cfg.method.toUpperCase()})`);
      }
    }
  }

  return {
    method: cfg.method === "band" ? "asymmetric_band" : `classification+${cfg.method}`,
    lowerBound: Math.round(bandLo),
    upperBound: Math.round(bandHi),
    removed,
    staleLowRemoved,
    highOutlierRemoved,
    suspectLows,
    stableRefPrice: Math.round(stableRef),
  };
}

function weightedMedianInt(pool: OfferEvaluation[]): number | null {
  if (!pool.length) return null;
  const xs = pool.map((o) => o.price);
  const ws = pool.map((o) => Math.max(0.05, o.weight));
  const pairs = xs
    .map((x, i) => ({ x, w: ws[i] }))
    .sort((a, b) => a.x - b.x);
  const total = pairs.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return Math.round(median(xs));
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return Math.round(p.x);
  }
  return Math.round(pairs[pairs.length - 1].x);
}
