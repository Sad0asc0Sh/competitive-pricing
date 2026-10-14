import { ceilToStep, roundToStep } from "./stats";
import type { PricingProfileConfig } from "./types";

export interface GuardOutcome {
  price: number;
  notes: string[];
  needsReview: boolean;
  reviewReasons: string[];
}

/**
 * مرحله ۵: محافظ‌ها (خطای نزدیک صفر)
 * 1. کف سود: قیمت هرگز زیر costPrice × (1 + minMargin) نمی‌رود.
 * 2. حداکثر تغییر در هر اجرا: اگر تغییر بیش از حد بود، قیمت به سقف تغییر محدود شده و برای بازبینی علامت می‌خورد.
 */
export function applyGuards(
  target: number,
  ctx: { costPrice: number; minMarginPct: number; currentPrice?: number | null },
  cfg: PricingProfileConfig["guards"],
  rounding: PricingProfileConfig["rounding"],
): GuardOutcome {
  const notes: string[] = [];
  const reviewReasons: string[] = [];
  let price = target;

  // 1) کف سود
  if (ctx.costPrice > 0) {
    const floor = ceilToStep(ctx.costPrice * (1 + ctx.minMarginPct / 100), rounding.finalStep);
    if (price < floor) {
      notes.push(
        `قیمت هدف ${Math.round(price).toLocaleString("fa-IR")} زیر کف سود (${floor.toLocaleString("fa-IR")} = تمام‌شده + ${ctx.minMarginPct}%) بود → روی کف سود قرار گرفت`,
      );
      price = floor;
      reviewReasons.push("قیمت بازار زیر کف سود ما است (احتمال تغییر قیمت خرید یا رقابت غیرمنطقی)");
    }
  }

  // 2) حداکثر تغییر نسبت به قیمت فعلی
  if (ctx.currentPrice && ctx.currentPrice > 0) {
    const changePct = ((price - ctx.currentPrice) / ctx.currentPrice) * 100;
    if (Math.abs(changePct) > cfg.maxChangePctPerRun) {
      const capped =
        changePct > 0
          ? ctx.currentPrice * (1 + cfg.maxChangePctPerRun / 100)
          : ctx.currentPrice * (1 - cfg.maxChangePctPerRun / 100);
      notes.push(
        `تغییر ${changePct.toFixed(1)}% از سقف مجاز ${cfg.maxChangePctPerRun}% بیشتر بود → به ${Math.round(capped).toLocaleString("fa-IR")} محدود شد`,
      );
      price = capped;
      reviewReasons.push(`جهش قیمت ${changePct.toFixed(1)}% نسبت به قیمت فعلی`);
    }
  }

  price = applyRounding(price, rounding.finalStep, rounding.psychological);

  return { price, notes, needsReview: reviewReasons.length > 0, reviewReasons };
}

export function applyRounding(x: number, step: number, psych: PricingProfileConfig["rounding"]["psychological"]): number {
  let p = roundToStep(x, step);
  if (psych === "x900" && step >= 1000) {
    p = p - 100; // 250,000 → 249,900
  }
  return Math.max(0, Math.round(p));
}
