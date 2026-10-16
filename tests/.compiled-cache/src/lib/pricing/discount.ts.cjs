"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildDiscount = buildDiscount;
exports.calibrateCeilingForExactFloor = calibrateCeilingForExactFloor;
var _stats = require("./stats");
/**
 * کالیبراسیون دقیق سقف معیار (`basePrice`) و درصد تخفیف صحیح (`1..99`)
 * به‌گونه‌ای که در فرمول قیمت‌گذاری `sgeooole` (`Math.round(basePrice * (1 - discountPct / 100))`)
 * خروجی دقیقاً برابر با کف هدف (`targetFloorPrice`) شود!
 */
function calibrateCeilingForExactFloor(rawCeilingPrice, targetFloorPrice, preferredDiscountPct) {
  const floor = Math.round(targetFloorPrice);
  if (floor <= 0 || rawCeilingPrice <= floor) {
    return {
      calibratedCeiling: floor,
      discountPct: 0,
      exactFloorRestored: floor
    };
  }
  const rawPct = preferredDiscountPct != null && preferredDiscountPct > 0 ? preferredDiscountPct : (rawCeilingPrice - floor) / rawCeilingPrice * 100;
  const discountPct = (0, _stats.clamp)(Math.round(rawPct), 1, 95);
  const factor = (100 - discountPct) / 100;
  if (factor <= 0) {
    return {
      calibratedCeiling: floor,
      discountPct: 0,
      exactFloorRestored: floor
    };
  }

  // ۱) اگر خود سقف فعلی (که ممکن است رُند به ۱۰۰۰ تومان باشد) دقیقاً همان کف را تولید کند، تغییرش نده
  const roundedRaw = Math.round(rawCeilingPrice);
  if (Math.round(roundedRaw * factor) === floor) {
    return {
      calibratedCeiling: roundedRaw,
      discountPct,
      exactFloorRestored: floor
    };
  }

  // ۲) نزدیک‌ترین عدد صحیح سقف که پس از اعمال discountPct% دقیقاً برابر floor شود را پیدا کن
  const approxCeiling = Math.round(floor / factor);
  for (let delta = 0; delta <= 25; delta++) {
    for (const sign of [1, -1]) {
      const candidate = approxCeiling + delta * sign;
      if (candidate <= floor) continue;
      if (Math.round(candidate * factor) === floor) {
        return {
          calibratedCeiling: candidate,
          discountPct,
          exactFloorRestored: floor
        };
      }
    }
  }
  const safeCeiling = Math.ceil(floor / factor);
  const restored = Math.max(floor, Math.round(safeCeiling * factor));
  return {
    calibratedCeiling: Math.max(floor + 1, safeCeiling),
    discountPct,
    exactFloorRestored: restored
  };
}

/**
 * مرحله ۸: کشف اصولی «کف و سقف واقعی بازار تحت رصد» (بدون قیمت‌های پرت ترب)
 * و قرار دادن «قیمت سقف» به عنوان معیار تخفیف و اعمال درصد تخفیف برای رسیدن دقیق به «قیمت کف».
 */
function buildDiscount(finalPrice, offers, cfg, rounding) {
  const allPositivePrices = offers.filter(o => o.price > 0).map(o => o.price);
  const rawLowestPrice = allPositivePrices.length ? Math.min(...allPositivePrices) : null;
  const rawHighestPrice = allPositivePrices.length ? Math.max(...allPositivePrices) : null;
  const validPrices = (0, _stats.sortAsc)(offers.filter(o => o.included && o.price > 0).map(o => o.price));
  const excludedOutliersCount = offers.filter(o => !o.included).length;
  const monitoredMarketFloor = validPrices.length ? validPrices[0] : null;
  const monitoredMarketMedian = validPrices.length ? Math.round((0, _stats.median)(validPrices)) : null;

  // محاسبه سقف واقعی بازار تحت رصد (بدون قیمت‌های پرت ترب)
  const maxAboveMedianPct = Math.max(5, cfg.maxCeilingAboveMedianPct ?? 18);
  const medianCeilingCap = monitoredMarketMedian != null ? Math.round(monitoredMarketMedian * (1 + maxAboveMedianPct / 100)) : null;
  const mode = cfg.mode ?? cfg.basePriceMode ?? "market_percentile_ceiling";
  let monitoredMarketCeiling = null;
  let rawBase;
  let how;
  if (validPrices.length >= 2 && mode !== "markup") {
    let candidateCeiling;
    if (mode === "highest_valid_seller") {
      candidateCeiling = validPrices[validPrices.length - 1];
      how = `بالاترین فروشنده معتبر بازار تحت رصد (حذف ${excludedOutliersCount} قیمت پرت/قدیمی)`;
    } else if (mode === "trimmed_upper_cluster" || mode === "cluster_ceiling") {
      const halfIdx = Math.floor(validPrices.length / 2);
      const upperHalf = validPrices.slice(halfIdx);
      candidateCeiling = upperHalf.reduce((s, x) => s + x, 0) / Math.max(1, upperHalf.length);
      how = `میانگین خوشه بالایی فروشندگان معتبر بازار تحت رصد`;
    } else {
      const pctUsed = (0, _stats.clamp)(cfg.marketUpperPercentile ?? 85, 55, 98);
      candidateCeiling = (0, _stats.percentile)(validPrices, pctUsed);
      how = `سقف واقعی بازار تحت رصد (صدک ${pctUsed} از ${validPrices.length} فروشنده معتبر، بدون ${excludedOutliersCount} قیمت پرت)`;
    }
    if (medianCeilingCap != null && candidateCeiling > medianCeilingCap) {
      candidateCeiling = medianCeilingCap;
      how += ` [محدود به سپر ضدپرت +${maxAboveMedianPct}% میانه بازار]`;
    }
    monitoredMarketCeiling = Math.round(candidateCeiling);
    rawBase = monitoredMarketCeiling;
  } else {
    rawBase = Math.round(finalPrice * (1 + (cfg.markupPct || 12) / 100));
    monitoredMarketCeiling = validPrices.length === 1 ? validPrices[0] : rawBase;
    how = `کف رقابتی + ${cfg.markupPct || 12}%`;
  }

  // اطمینان از اینکه فاصله سقف و کف در بازه تخفیف مجاز [minDiscountPct, maxDiscountPct] قرار دارد
  const minDisc = (0, _stats.clamp)(cfg.minDiscountPct ?? 5, 1, 90);
  const maxDisc = (0, _stats.clamp)(cfg.maxDiscountPct ?? 35, minDisc + 1, 95);
  const minBase = finalPrice / (1 - minDisc / 100);
  const maxBase = finalPrice / (1 - maxDisc / 100);
  const beforeClamp = rawBase;
  let base = (0, _stats.clamp)(rawBase, minBase, maxBase);
  if (base !== beforeClamp) {
    how += beforeClamp < minBase ? ` (تنظیم روی حداقل تخفیف استاندارد ${minDisc}%)` : ` (محدودسازی به سقف تخفیف باورپذیر ${maxDisc}% برای جلوگیری از قیمت پرت)`;
  }
  const step = Math.max(1, rounding.baseStep || 1000);
  base = (0, _stats.roundToStep)(base, step);
  if (base <= finalPrice) base = finalPrice + step;
  let discountPct;
  let exactFloorRestored = finalPrice;
  if (cfg.calibrateCeilingForExactFloor !== false) {
    const naturalPct = (base - finalPrice) / base * 100;
    const targetIntPct = (0, _stats.clamp)(Math.round(naturalPct), Math.ceil(minDisc), Math.floor(maxDisc));
    const cal = calibrateCeilingForExactFloor(base, finalPrice, targetIntPct);
    base = cal.calibratedCeiling;
    discountPct = cal.discountPct;
    exactFloorRestored = cal.exactFloorRestored;
  } else {
    discountPct = Math.round((base - finalPrice) / base * 1000) / 10;
    exactFloorRestored = Math.round(base * (1 - discountPct / 100));
  }
  const discountAmountToman = Math.max(0, base - finalPrice);
  const floorCeiling = {
    rawLowestPrice,
    rawHighestPrice,
    monitoredSellersCount: validPrices.length,
    excludedOutliersCount,
    monitoredMarketFloor,
    monitoredMarketMedian,
    monitoredMarketCeiling: monitoredMarketCeiling ?? base,
    calibratedCeilingPrice: base,
    ceilingBasePrice: base,
    targetFloorPrice: finalPrice,
    discountPct,
    appliedDiscountPct: discountPct,
    discountAmountToman,
    exactFloorRestored,
    ceilingMethodUsed: mode,
    discoveryModeUsed: mode,
    explanation: how
  };
  return {
    basePrice: base,
    finalPrice,
    discountPct,
    floorCeiling,
    explanation: `رصد بازار معتبر (کف بازار: ${(monitoredMarketFloor ?? finalPrice).toLocaleString("fa-IR")} | سقف بازار: ${(monitoredMarketCeiling ?? base).toLocaleString("fa-IR")} تومان) → ` + `قیمت سقف معیار = ${base.toLocaleString("fa-IR")} تومان (${how}) با اعمال ${discountPct}% تخفیف (${discountAmountToman.toLocaleString("fa-IR")} تومان کسر از سقف) → قیمت کف نهایی: ${finalPrice.toLocaleString("fa-IR")} تومان`
  };
}