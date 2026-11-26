import { compactShopKey } from "./own-shop";
import { median } from "./stats";
import type { OfferEvaluation } from "./types";

export interface LiquidationDetectionOptions {
  /** هزینه تمام‌شده واقعی خودمان (برای تشخیص فروش منفردِ نقدکننده در یا زیر قیمت خرید) */
  effectiveCostPrice?: number;
  /** حداقل تعداد کل پیشنهادهای معتبر برای وجود یک «بدنهٔ واقعی بازار» */
  minBodySellers?: number;
  /** حداقل شکاف نسبت به نفر دوم (٪) برای تشخیص حراج/نقدسازی منفرد */
  stepGapPct?: number;
  /** حداقل شکاف نسبت به میانهٔ بدنه بازار (٪) برای تشخیص حراج/نقدسازی منفرد */
  bodyGapPct?: number;
  /** شعاع هم‌قیمتی کف (٪) برای تشخیص اینکه آیا فروشندهٔ دومی در همان سطح کف حضور دارد یا خیر */
  clusterRadiusPct?: number;
}

export interface LiquidationExcludedOffer {
  shopName: string;
  price: number;
  stepGapPct: number;
  bodyGapPct: number;
  reason: string;
  belowCostDumping: boolean;
}

export interface LiquidationReport {
  excluded: LiquidationExcludedOffer[];
  bodyMedian: number | null;
}

function sellerIdentityKey(o: OfferEvaluation): string {
  const idKey = compactShopKey(o.shopId);
  if (idKey) return `id:${idKey}`;
  const nameKey = compactShopKey(o.shopName);
  return nameKey ? `name:${nameKey}` : `anon:${o.price}`;
}

/**
 * فیلتر ریاضی محض برای تشخیص فروشندهٔ منفرد «نقدکننده انبار / حراج غیرعادی» در ترب (بدون AI):
 *
 * مسأله: گاهی یک فروشندهٔ حتی خوش‌امتیاز و به‌روز در ترب قصد نقد کردن موجودی قدیمی خود را دارد و
 * یک یا دو عدد کالا را با حراج یا قیمت زیر خرید کل بازار می‌گذارد. چون هیچ فروشندهٔ دیگری قیمتش را
 * تایید نکرده، رقابت مستقیم با او کل حاشیهٔ سود ما را نابود می‌کند.
 *
 * شرط تشخیص (۱۰۰٪ ریاضی و محافظه‌کارانه):
 *  - حداقل `minBodySellers` (پیش‌فرض ۴) فروشندهٔ معتبر در بازار باشد.
 *  - در کف بازار (بازه `clusterRadiusPct` ≈ ۲٫۵٪) **فقط یک فروشندهٔ یکتا** حضور داشته باشد (اگر ۲+ فروشنده مستقل روی این کف هستند، قیمت واقعی بازار است و دست نمی‌زنیم).
 *  - این فروشندهٔ منفرد یا:
 *      الف) هم ≥ `stepGapPct` (۶٪) زیر نفر بعدی باشد و هم ≥ `bodyGapPct` (۸٪) زیر میانهٔ بدنهٔ بازار؛
 *      ب) یا زیر/مساوی قیمت تمام‌شده ما (`effectiveCostPrice`) باشد در حالی که نفر بعدی ≥ ۳٫۵٪ گران‌تر و بدنهٔ بازار دست‌کم ۳٪ بالای تمام‌شده ماست.
 */
export function detectIsolatedLiquidationOffers(
  offers: OfferEvaluation[],
  opts: LiquidationDetectionOptions = {},
): LiquidationReport {
  const minBodySellers = Math.max(4, Math.round(opts.minBodySellers ?? 4));
  const minStepGapPct = Math.max(1, Number(opts.stepGapPct ?? 6));
  const minBodyGapPct = Math.max(1, Number(opts.bodyGapPct ?? 8));
  const clusterRadiusRatio = Math.max(0.5, Number(opts.clusterRadiusPct ?? 2.5)) / 100;
  const effectiveCost =
    opts.effectiveCostPrice != null && Number.isFinite(opts.effectiveCostPrice) && opts.effectiveCostPrice > 0
      ? opts.effectiveCostPrice
      : 0;

  const excluded: LiquidationExcludedOffer[] = [];
  let lastBodyMedian: number | null = null;

  // حداکثر ۲ تک‌فروشندهٔ نقدکننده متوالی را کنار می‌گذاریم تا در بازار کوچک بدنه تخلیه نشود
  for (let pass = 0; pass < 2; pass++) {
    const active = offers
      .filter((o) => o.included && typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0)
      .sort((a, b) => a.price - b.price);

    if (active.length < minBodySellers) break;

    const lowest = active[0];
    const bottomCap = lowest.price * (1 + clusterRadiusRatio);
    const corroboratingFloor = lowest.price * (1 - clusterRadiusRatio * 2);
    const bottomCluster = active.filter((o) => o.price <= bottomCap);
    // اگر ۲ یا چند فروشنده مستقل معتبر (حتی اگر یکی‌شان در مرحلهٔ اعتبارسنجی احتمالی کنار رفته باشد) روی همین کف هستند، قیمت واقعی بازار است
    const peerBottomCluster = offers.filter(
      (o) =>
        (o.included || (o.pValid != null && o.pValid > 0)) &&
        o.cls !== "liquidation_low" &&
        typeof o.price === "number" &&
        Number.isFinite(o.price) &&
        o.price >= corroboratingFloor &&
        o.price <= bottomCap,
    );
    const uniqueBottomSellers = new Set(peerBottomCluster.map(sellerIdentityKey));

    if (uniqueBottomSellers.size > 1) break;

    const rest = active.slice(bottomCluster.length);
    if (rest.length < Math.max(3, minBodySellers - 1)) break;

    const nextPrice = rest[0].price;
    const bodyPrices = rest.map((o) => o.price);
    const bodyMed = median(bodyPrices);
    if (!Number.isFinite(bodyMed) || bodyMed <= 0) break;
    lastBodyMedian = Math.round(bodyMed);

    const stepGapPct = ((nextPrice - lowest.price) / Math.max(1, nextPrice)) * 100;
    const bodyGapPct = ((bodyMed - lowest.price) / Math.max(1, bodyMed)) * 100;

    const ruleADeepIsolated = stepGapPct >= minStepGapPct && bodyGapPct >= minBodyGapPct;
    const ruleBBelowCostDumping =
      effectiveCost > 0 &&
      lowest.price <= effectiveCost &&
      stepGapPct >= 3.5 &&
      bodyMed > effectiveCost * 1.03;

    if (!ruleADeepIsolated && !ruleBBelowCostDumping) break;

    const reason = ruleBBelowCostDumping && !ruleADeepIsolated
      ? `فروشنده منفرد نقدکننده انبار / زیر قیمت خرید (${stepGapPct.toFixed(1)}٪ زیر نفر بعدی و ${bodyGapPct.toFixed(1)}٪ زیر میانه بازار، بدون همراه)`
      : `فروشنده منفرد نقدکننده انبار / حراج غیرعادی (${stepGapPct.toFixed(1)}٪ زیر نفر بعدی و ${bodyGapPct.toFixed(1)}٪ زیر میانه بازار، بدون همراه)`;

    for (const o of bottomCluster) {
      o.included = false;
      o.weight = 0;
      o.cls = "liquidation_low";
      o.excludeReason = reason;
      excluded.push({
        shopName: o.shopName,
        price: o.price,
        stepGapPct: Math.round(stepGapPct * 10) / 10,
        bodyGapPct: Math.round(bodyGapPct * 10) / 10,
        reason,
        belowCostDumping: ruleBBelowCostDumping,
      });
    }
  }

  return {
    excluded,
    bodyMedian: lastBodyMedian,
  };
}
