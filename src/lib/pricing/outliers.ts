import { mad, median, percentile } from "./stats";
import type { OfferEvaluation, PricingProfileConfig } from "./types";

export interface OutlierReport {
  method: string;
  lowerBound: number | null;
  upperBound: number | null;
  removed: number;
}

/**
 * مرحله ۲: حذف داده‌های پرت
 * ابتدا «باند سخت» حول میانه اعمال می‌شود (مثلاً ±۲۵٪)، سپس روش آماری انتخابی (IQR یا MAD).
 * چرا دو مرحله؟ چون اگر ۳ فروشگاه قیمت خیلی پایین (اشتباه/قدیمی) داشته باشند،
 * IQR تنها ممکن است آنها را نگه دارد؛ باند سخت جلوی این را می‌گیرد.
 */
export function removeOutliers(
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["outliers"],
): OutlierReport {
  const included = offers.filter((o) => o.included);
  let removed = 0;
  if (included.length < 2) return { method: cfg.method, lowerBound: null, upperBound: null, removed };

  // --- باند سخت
  const med = median(included.map((o) => o.price));
  const bandLo = med * (1 - cfg.hardBandPct / 100);
  const bandHi = med * (1 + cfg.hardBandPct / 100);
  for (const o of included) {
    if (o.price < bandLo || o.price > bandHi) {
      o.included = false;
      o.weight = 0;
      const pct = (((o.price - med) / med) * 100).toFixed(1);
      o.excludeReason = `اختلاف زیاد با میانه بازار (${pct}%)`;
      removed++;
    }
  }

  const rest = offers.filter((o) => o.included);
  if (rest.length < cfg.minSamples) {
    return { method: `band(${cfg.hardBandPct}%)`, lowerBound: bandLo, upperBound: bandHi, removed };
  }

  let lo = bandLo;
  let hi = bandHi;
  const prices = rest.map((o) => o.price);

  if (cfg.method === "iqr") {
    const q1 = percentile(prices, 25);
    const q3 = percentile(prices, 75);
    const iqr = q3 - q1;
    lo = Math.max(lo, q1 - cfg.iqrK * iqr);
    hi = Math.min(hi, q3 + cfg.iqrK * iqr);
  } else if (cfg.method === "mad") {
    const m = median(prices);
    const d = mad(prices) * 1.4826; // نرمال‌سازی MAD به انحراف معیار
    if (d > 0) {
      lo = Math.max(lo, m - cfg.madK * d);
      hi = Math.min(hi, m + cfg.madK * d);
    }
  }

  for (const o of rest) {
    if (o.price < lo || o.price > hi) {
      o.included = false;
      o.weight = 0;
      o.excludeReason = `داده پرت آماری (${cfg.method.toUpperCase()})`;
      removed++;
    }
  }

  return { method: cfg.method === "band" ? `band(${cfg.hardBandPct}%)` : `band+${cfg.method}`, lowerBound: lo, upperBound: hi, removed };
}
