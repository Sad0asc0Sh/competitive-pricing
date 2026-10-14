import { percentile, roundToStep, clamp } from "./stats";
import type { OfferEvaluation, PricingProfileConfig } from "./types";

export interface DiscountOutcome {
  basePrice: number;
  finalPrice: number;
  discountPct: number;
  explanation: string;
}

/**
 * مرحله ۶: ساخت «قیمت اصلی + تخفیف»
 *
 * فلسفه: قیمت رقابتی نهایی هرگز به‌عنوان قیمت عادی نمایش داده نمی‌شود.
 * قیمت اصلی = یک قیمت واقعی و قابل دفاع از بازار (صدک بالای قیمت‌های معتبر رقبا)،
 * و قیمت نهایی رقابتی به شکل «تخفیف» روی آن نشان داده می‌شود.
 *
 * - basePriceMode = market_upper → base = percentile(validPrices, P) (پیش‌فرض ۸۰)
 * - basePriceMode = markup      → base = final × (1 + markupPct)
 * سپس تخفیف بین min و max محدود می‌شود؛ اگر تخفیف طبیعی کمتر از min بود، base بالا می‌رود،
 * و اگر بیشتر از max بود (غیرواقعی)، base پایین می‌آید تا تخفیف باورپذیر بماند.
 */
export function buildDiscount(
  finalPrice: number,
  offers: OfferEvaluation[],
  cfg: PricingProfileConfig["discount"],
  rounding: PricingProfileConfig["rounding"],
): DiscountOutcome {
  const valid = offers.filter((o) => o.included).map((o) => o.price);
  let base: number;
  let how: string;

  if (cfg.basePriceMode === "market_upper" && valid.length >= 2) {
    base = percentile(valid, cfg.marketUpperPercentile);
    how = `صدک ${cfg.marketUpperPercentile} قیمت‌های معتبر بازار`;
  } else {
    base = finalPrice * (1 + cfg.markupPct / 100);
    how = `قیمت نهایی + ${cfg.markupPct}%`;
  }

  // حداقل و حداکثر تخفیف
  const minBase = finalPrice / (1 - cfg.minDiscountPct / 100);
  const maxBase = finalPrice / (1 - cfg.maxDiscountPct / 100);
  const before = base;
  base = clamp(base, minBase, maxBase);
  if (base !== before) {
    how += before < minBase ? ` (افزایش تا حداقل تخفیف ${cfg.minDiscountPct}%)` : ` (کاهش تا حداکثر تخفیف ${cfg.maxDiscountPct}%)`;
  }

  base = roundToStep(base, rounding.baseStep);
  if (base <= finalPrice) base = finalPrice + rounding.baseStep;

  const discountPct = ((base - finalPrice) / base) * 100;

  return {
    basePrice: base,
    finalPrice,
    discountPct: Math.round(discountPct * 10) / 10,
    explanation: `قیمت اصلی = ${how} → ${base.toLocaleString("fa-IR")} تومان؛ تخفیف نمایشی ${discountPct.toFixed(1)}%`,
  };
}
