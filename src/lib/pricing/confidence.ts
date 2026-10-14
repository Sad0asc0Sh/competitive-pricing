import type { MarketSummary } from "./aggregate";
import type { PricingProfileConfig } from "./types";

/**
 * امتیاز اعتماد (0..1) — ترکیب چند سیگنال:
 *  - تعداد فروشنده کل (لیستینگ ادغام‌شده؟)
 *  - تعداد پیشنهاد معتبر بعد از فیلترها
 *  - پراکندگی قیمت‌ها (هرچه کمتر، مطمئن‌تر)
 *  - نسبت داده حذف‌شده (اگر بیش از نیمی حذف شده، داده مشکوک است)
 */
export function computeConfidence(
  market: MarketSummary,
  totals: { totalSellerCount: number; offersTotal: number },
  cfg: PricingProfileConfig,
): { score: number; breakdown: Record<string, number> } {
  const sellerScore = Math.min(1, totals.totalSellerCount / Math.max(1, cfg.filters.minSellerCount * 2));
  const validScore = Math.min(1, market.count / Math.max(1, cfg.guards.minValidOffers * 2));
  const dispersionScore = Math.max(0, 1 - market.dispersion / 0.15); // CV 15% → صفر
  const keepRatio = totals.offersTotal ? market.count / totals.offersTotal : 0;
  const keepScore = Math.min(1, keepRatio / 0.5); // اگر ≥۵۰٪ داده‌ها نگه داشته شد → کامل

  const score = 0.3 * sellerScore + 0.3 * validScore + 0.25 * dispersionScore + 0.15 * keepScore;
  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      sellerScore: r(sellerScore),
      validScore: r(validScore),
      dispersionScore: r(dispersionScore),
      keepScore: r(keepScore),
    },
  };
}

const r = (x: number) => Math.round(x * 100) / 100;
