"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyGuards = applyGuards;
exports.applyRounding = applyRounding;
exports.applyRoundingWithFloor = applyRoundingWithFloor;
var _stats = require("./stats");
var _sourcing = require("./sourcing");
/**
 * مرحله ۵: محافظ‌ها (خطای نزدیک صفر + تضمین مطلق اولویت اول: قیمت فروش > قیمت خرید و تامین)
 *
 * 1. خط قرمز کف خرید و سود (Hard Floor):
 *    قیمت هرگز (نه قبل از گرد کردن، نه بعد از سقف تغییر، و نه بعد از گرد کردن روانی x900/x000)
 *    زیر hardFloorPrice (یا <= costPrice) نمی‌رود!
 * 2. حداکثر تغییر در هر اجرا:
 *    اگر تغییر نسبت به قیمت فعلی بیش از حد بود، قیمت به سقف تغییر محدود می‌شود،
 *    اما اگر قیمت فعلی خودش زیر کف خرید جدید همکاران بود، اولویت با خط قرمز کف خرید است (هرگز با ضرر نمی‌فروشیم!).
 * 3. هیسترزیس (جلوگیری از نوسان بی‌مورد):
 *    اگر تغییر کمتر از hysteresisPct باشد و قیمت فعلی بالای کف سود باشد، تغییر بی‌مورد اعمال نمی‌شود.
 */
function applyGuards(target, ctx, cfg, rounding) {
  const notes = [];
  const reviewReasons = [];
  let price = target;
  let floorEnforced = false;
  const hardFloor = ctx.hardFloorPriceOverride != null && ctx.hardFloorPriceOverride > 0 ? ctx.hardFloorPriceOverride : (0, _sourcing.computeHardFloorPrice)({
    effectiveCostPrice: ctx.costPrice,
    minMarginPct: ctx.minMarginPct,
    minProfitAmountToman: ctx.minProfitAmountToman ?? 0,
    fixedCostToman: ctx.fixedCostToman ?? 0,
    finalStep: rounding.finalStep,
    psychological: rounding.psychological
  });

  // ۱) اعمال اولیه خط قرمز کف خرید و سود
  if (hardFloor > 0 && price < hardFloor) {
    notes.push(`قیمت هدف ${Math.round(price).toLocaleString("fa-IR")} زیر خط قرمز تامین + حداقل سود (${hardFloor.toLocaleString("fa-IR")} تومان) بود → روی کف مجاز قرار گرفت`);
    price = hardFloor;
    floorEnforced = true;
  }

  // ۲) حداکثر تغییر نسبت به قیمت فعلی (مشروط بر اینکه هرگز زیر خط قرمز کف خرید نماند!)
  if (ctx.currentPrice && ctx.currentPrice > 0) {
    const changePct = (price - ctx.currentPrice) / ctx.currentPrice * 100;

    // هیسترزیس: تغییر بسیار جزئی (مثلاً کمتر از ۰.۱۵٪) در حالی که بالای کف سود هستیم
    const hyst = cfg.hysteresisPct ?? 0;
    if (hyst > 0 && Math.abs(changePct) > 0 && Math.abs(changePct) < hyst && ctx.currentPrice >= hardFloor && ctx.currentPrice <= price) {
      price = ctx.currentPrice;
      notes.push(`تغییر جزئی (${changePct.toFixed(2)}% < ${hyst}%) نادیده گرفته شد تا ثبات قیمت حفظ شود`);
    } else if (Math.abs(changePct) > cfg.maxChangePctPerRun) {
      const capped = changePct > 0 ? ctx.currentPrice * (1 + cfg.maxChangePctPerRun / 100) : ctx.currentPrice * (1 - cfg.maxChangePctPerRun / 100);
      if (hardFloor > 0 && capped < hardFloor) {
        // اولویت اول سیستم: اگر قیمت قبلی ما از قیمت خرید جدید همکاران کمتر بوده،
        // سقف تغییر نباید مانع بالا رفتن قیمت تا خط قرمز کف خرید شود!
        notes.push(`قیمت فعلی (${ctx.currentPrice.toLocaleString("fa-IR")}) زیر کف جدید لیست همکاران (${hardFloor.toLocaleString("fa-IR")}) بود؛ اولویت اول با جلوگیری از فروش زیر قیمت خرید است (جهش ${changePct.toFixed(1)}% به کف مجاز اعمال شد)`);
        price = hardFloor;
        floorEnforced = true;
        reviewReasons.push(`افزایش فوری قیمت (${changePct.toFixed(1)}%) به دلیل بالا رفتن قیمت خرید در لیست همکاران`);
      } else {
        notes.push(`تغییر ${changePct.toFixed(1)}% از سقف مجاز ${cfg.maxChangePctPerRun}% بیشتر بود → به ${Math.round(capped).toLocaleString("fa-IR")} محدود شد`);
        price = capped;
        reviewReasons.push(`جهش قیمت ${changePct.toFixed(1)}% نسبت به قیمت فعلی`);
      }
    }
  }

  // ۳) گرد کردن نهایی با تضمین ریاضی عدم عبور از خط قرمز کف خرید و سود
  price = applyRoundingWithFloor(price, rounding.finalStep, rounding.psychological, hardFloor, ctx.costPrice);
  return {
    price,
    notes,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    floorEnforced
  };
}

/**
 * گرد کردن قیمت همراه با بررسی سخت‌گیرانه کف قیمت (Fix باگ گرد کردن روانی x900 به زیر کف سود)
 */
function applyRoundingWithFloor(x, step, psych, hardFloor = 0, costPrice = 0) {
  const effectiveStep = Math.max(1, step || 1000);
  let p = applyRounding(x, effectiveStep, psych);

  // اگر گرد کردن یا کسر ۱۰۰ تومان در حالت x900 باعث شد قیمت زیر خط قرمز برود، یک پله به بالا ببر!
  while (hardFloor > 0 && p < hardFloor || costPrice > 0 && p <= costPrice) {
    const bumpedBase = (0, _stats.ceilToStep)(Math.max(p + 100, hardFloor, costPrice + 1), effectiveStep);
    if (psych === "x900" && effectiveStep >= 1000) {
      const candidate = bumpedBase - 100;
      p = candidate >= hardFloor && candidate > costPrice ? candidate : bumpedBase + effectiveStep - 100;
    } else {
      p = bumpedBase;
    }
    break;
  }
  return Math.max(0, Math.round(p));
}
function applyRounding(x, step, psych) {
  let p = (0, _stats.roundToStep)(x, step);
  if (psych === "x900" && step >= 1000) {
    p = p - 100; // 250,000 → 249,900
  }

  return Math.max(0, Math.round(p));
}