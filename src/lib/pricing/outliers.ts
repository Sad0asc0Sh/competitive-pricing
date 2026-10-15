import { mad, median, percentile } from "./stats";
import type { OfferEvaluation, PricingProfileConfig } from "./types";

export interface OutlierReport {
  method: string;
  lowerBound: number | null;
  upperBound: number | null;
  removed: number;
  staleLowRemoved: number;
  highOutlierRemoved: number;
}

/**
 * مرحله ۲: حذف هوشمند داده‌های پرت و فروشندگان غیربه‌روز (سه‌مرحله‌ای)
 *
 * چرا سه مرحله؟
 *  1) لنگر فروشندگان تازه (Fresh Sellers Median Anchor):
 *     در ترب، فروشندگانی که قیمتشان خیلی پایین‌تر از بقیه است، اغلب قیمتشان از ماه‌ها/هفته‌های قبل مانده و بروز نیست.
 *     بنابراین ابتدا میانه را روی «فروشندگانی که تازه آپدیت شده‌اند» (یا اگر تاریخ نداشتند، نیمه میانی بازار) محاسبه می‌کنیم.
 *  2) باند نامتقارن سخت (Asymmetric Hard Band):
 *     - در سمت پایین: از `lowerStaleBandPct` (مثلاً ۱۶٪ زیر میانه فروشندگان تازه) استفاده می‌کنیم تا فروشندگان جا مانده از بازار حذف شوند.
 *     - در سمت بالا: از `hardBandPct` (مثلاً ۲۵٪ بالای میانه) استفاده می‌کنیم تا قیمت‌های کاذب بالا حذف شوند.
 *  3) فیلتر آماری ترکیبی (IQR + Modified Z-Score مبتنی بر MAD):
 *     حتی اگر چند فروشنده با هم قیمت پرت داده باشند، ترکیب IQR و MAD آن‌ها را به‌دقت شناسایی و حذف می‌کند.
 */
export function removeOutliers(
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["outliers"],
  opts?: { isCostlessMode?: boolean; now?: Date },
): OutlierReport {
  const included = offers.filter((o) => o.included);
  let removed = 0;
  let staleLowRemoved = 0;
  let highOutlierRemoved = 0;

  if (included.length < 2) {
    return {
      method: cfg.method,
      lowerBound: null,
      upperBound: null,
      removed: 0,
      staleLowRemoved: 0,
      highOutlierRemoved: 0,
    };
  }

  const now = opts?.now ?? new Date();
  // ۱) محاسبه لنگر میانه با اولویت فروشندگانی که در ۳ روز اخیر آپدیت شده‌اند
  const recentOffers = included.filter((o) => {
    if (!o.lastChangedAt) return false;
    const ageDays = (now.getTime() - o.lastChangedAt.getTime()) / 86_400_000;
    return ageDays <= 3;
  });

  const anchorPrices =
    recentOffers.length >= 3
      ? recentOffers.map((o) => o.price)
      : included.map((o) => o.price);

  const med = median(anchorPrices);

  // در حالت بدون قیمت خرید (isCostlessMode)، باند پایین را کمی سخت‌گیرانه‌تر می‌گیریم تا هیچ قیمت قدیمیِ ارزانی وارد میانگین نشود
  const rawLowerPct = cfg.lowerStaleBandPct ?? cfg.hardBandPct;
  const effectiveLowerPct = opts?.isCostlessMode ? Math.min(rawLowerPct, 14) : rawLowerPct;

  const bandLo = med * (1 - effectiveLowerPct / 100);
  const bandHi = med * (1 + cfg.hardBandPct / 100);

  for (const o of included) {
    if (o.price < bandLo) {
      o.included = false;
      o.weight = 0;
      const pct = (((o.price - med) / med) * 100).toFixed(1);
      o.excludeReason = `اختلاف شدید رو به پایین با میانه بازار (${pct}%) — احتمال عدم بروزرسانی قیمت`;
      removed++;
      staleLowRemoved++;
    } else if (o.price > bandHi) {
      o.included = false;
      o.weight = 0;
      const pct = (((o.price - med) / med) * 100).toFixed(1);
      o.excludeReason = `اختلاف زیاد رو به بالا با میانه بازار (+${pct}%) — گران‌فروشی پرت`;
      removed++;
      highOutlierRemoved++;
    }
  }

  const rest = offers.filter((o) => o.included);
  if (rest.length < cfg.minSamples) {
    return {
      method: `asymmetric_band(-${effectiveLowerPct}%/+${cfg.hardBandPct}%)`,
      lowerBound: bandLo,
      upperBound: bandHi,
      removed,
      staleLowRemoved,
      highOutlierRemoved,
    };
  }

  let lo = bandLo;
  let hi = bandHi;
  const prices = rest.map((o) => o.price);

  // ترکیب هوشمند IQR و MAD برای دقت حداکثری در کشف پرت‌ها
  const q1 = percentile(prices, 25);
  const q3 = percentile(prices, 75);
  const iqr = q3 - q1;

  const m = median(prices);
  const normMad = mad(prices) * 1.4826;

  if (cfg.method === "iqr") {
    const iqrLo = q1 - cfg.iqrK * iqr;
    const iqrHi = q3 + cfg.iqrK * iqr;
    lo = Math.max(lo, iqrLo);
    hi = Math.min(hi, iqrHi);
    // اگر در حالت بدون لیست خرید هستیم و MAD هم انحراف معنی‌دار نشان می‌دهد، مرز پایین را با MAD هم تقویت کن
    if (opts?.isCostlessMode && normMad > 0) {
      lo = Math.max(lo, m - (cfg.madK ?? 2.5) * normMad);
    }
  } else if (cfg.method === "mad") {
    if (normMad > 0) {
      lo = Math.max(lo, m - cfg.madK * normMad);
      hi = Math.min(hi, m + cfg.madK * normMad);
    }
  }

  for (const o of rest) {
    if (o.price < lo) {
      o.included = false;
      o.weight = 0;
      o.excludeReason = `قیمت پرت پایین آماری (${cfg.method.toUpperCase()}) — مشکوک به عدم آپدیت`;
      removed++;
      staleLowRemoved++;
    } else if (o.price > hi) {
      o.included = false;
      o.weight = 0;
      o.excludeReason = `داده پرت بالای آماری (${cfg.method.toUpperCase()})`;
      removed++;
      highOutlierRemoved++;
    }
  }

  return {
    method: cfg.method === "band" ? `asymmetric_band` : `asymmetric_band+${cfg.method}`,
    lowerBound: Math.round(lo),
    upperBound: Math.round(hi),
    removed,
    staleLowRemoved,
    highOutlierRemoved,
  };
}
