"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calibrateCeilingForExactFloor = calibrateCeilingForExactFloor;
exports.calibrateBaseForPct = calibrateBaseForPct;
exports.marketReferenceP75 = marketReferenceP75;
exports.pickDiscountReference = pickDiscountReference;
exports.buildDiscount = buildDiscount;
const stats_1 = require("./stats");
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
            exactFloorRestored: floor,
        };
    }
    const rawPct = preferredDiscountPct != null && preferredDiscountPct > 0
        ? preferredDiscountPct
        : ((rawCeilingPrice - floor) / rawCeilingPrice) * 100;
    const discountPct = (0, stats_1.clamp)(Math.round(rawPct), 1, 95);
    const factor = (100 - discountPct) / 100;
    if (factor <= 0) {
        return {
            calibratedCeiling: floor,
            discountPct: 0,
            exactFloorRestored: floor,
        };
    }
    // ۱) اگر خود سقف فعلی (که ممکن است رُند به ۱۰۰۰ تومان باشد) دقیقاً همان کف را تولید کند، تغییرش نده
    const roundedRaw = Math.round(rawCeilingPrice);
    if (Math.round(roundedRaw * factor) === floor) {
        return {
            calibratedCeiling: roundedRaw,
            discountPct,
            exactFloorRestored: floor,
        };
    }
    // ۲) نزدیک‌ترین عدد صحیح سقف که پس از اعمال discountPct% دقیقاً برابر floor شود را پیدا کن
    const approxCeiling = Math.round(floor / factor);
    for (let delta = 0; delta <= 25; delta++) {
        for (const sign of [1, -1]) {
            const candidate = approxCeiling + delta * sign;
            if (candidate <= floor)
                continue;
            if (Math.round(candidate * factor) === floor) {
                return {
                    calibratedCeiling: candidate,
                    discountPct,
                    exactFloorRestored: floor,
                };
            }
        }
    }
    const safeCeiling = Math.ceil(floor / factor);
    const restored = Math.max(floor, Math.round(safeCeiling * factor));
    return {
        calibratedCeiling: Math.max(floor + 1, safeCeiling),
        discountPct,
        exactFloorRestored: restored,
    };
}
/**
 * کوچک‌ترین سقف صحیح `base` که `Math.round(base * (1 - pct / 100)) === final`
 * (نسخه ۴.۱) — پایه‌ی حکمت جدید: درصد تعیین می‌شود و «کوچک‌ترین سقف ممکن» از آن نتیجه می‌شود تا
 * سقف هرگز بالاتر از مرجع برود.
 */
function calibrateBaseForPct(final, pct) {
    const factor = (100 - pct) / 100;
    if (factor <= 0)
        return final + 1;
    const approx = Number.isFinite(final / factor) ? Math.round(final / factor) : final;
    for (let delta = 0; delta <= 60; delta++) {
        for (const b of [approx + delta, approx - delta]) {
            if (b <= final)
                continue;
            if (Math.round(b * factor) === final)
                return b;
            if (b > final && b - final > final * 0.2)
                break;
        }
    }
    return Math.max(final + 1, Math.ceil(final / factor));
}
/** صدک ۷۵ پول معتبر و سقف-دار: min(صدک ۷۵، بالاترین credible) — نمایشگر بازارِ «پایین رو به مرجع کشوند» */
function marketReferenceP75(offers) {
    const included = offers.filter((o) => o.included && o.price > 0);
    const credible = included.filter((o) => o.credible);
    const pool = credible.length >= 3 ? credible : included;
    if (!pool.length)
        return null;
    const prices = pool.map((o) => o.price).sort((a, b) => a - b);
    const p75 = (0, stats_1.percentile)(prices, 75);
    const highest = prices[prices.length - 1];
    return Math.min(p75, highest);
}
function pickDiscountReference(finalPrice, offers, cfg, opts = {}) {
    const ownHigh = Math.round(Math.max(0, Number(opts.ownStableHigh7d ?? 0)));
    const hasOwn = opts.hasOwnPriceHistory &&
        Number.isFinite(ownHigh) &&
        ownHigh > 0 &&
        ownHigh > Math.ceil(finalPrice * 1.01);
    if (hasOwn)
        return { kind: "own_price_7d", refPrice: ownHigh };
    const p75 = marketReferenceP75(offers);
    if (p75 != null && p75 > finalPrice)
        return { kind: "market_p75", refPrice: p75 };
    return { kind: "none", refPrice: null };
}
function noDiscountOutcome(finalPrice, offers, reason, reference) {
    const included = offers.filter((o) => o.included && o.price > 0);
    const validPrices = (0, stats_1.sortAsc)(included.map((o) => o.price));
    const floorCeiling = {
        rawLowestPrice: offers.filter((o) => o.price > 0).map((o) => o.price).length
            ? Math.min(...offers.filter((o) => o.price > 0).map((o) => o.price))
            : null,
        rawHighestPrice: offers.filter((o) => o.price > 0).map((o) => o.price).length
            ? Math.max(...offers.filter((o) => o.price > 0).map((o) => o.price))
            : null,
        monitoredSellersCount: validPrices.length,
        excludedOutliersCount: offers.filter((o) => !o.included).length,
        monitoredMarketFloor: validPrices[0] ?? null,
        monitoredMarketMedian: validPrices.length ? Math.round((0, stats_1.median)(validPrices)) : null,
        monitoredMarketCeiling: finalPrice,
        calibratedCeilingPrice: finalPrice,
        ceilingBasePrice: finalPrice,
        targetFloorPrice: finalPrice,
        discountPct: 0,
        appliedDiscountPct: 0,
        discountAmountToman: 0,
        exactFloorRestored: finalPrice,
        ceilingMethodUsed: "no_discount",
        discoveryModeUsed: "no_discount",
        explanation: reason,
    };
    return {
        basePrice: finalPrice,
        finalPrice,
        discountPct: 0,
        explanation: reason,
        referenceKind: reference?.kind ?? "none",
        referencePrice: reference?.refPrice ?? null,
        floorConfirmed: false,
        floorCeiling,
    };
}
/**
 * مرحله ۸ (نسخه ۴.۱) — ساخت سقف معیار و تخفیف:
 *  ۱) مرجع خارجی: `own_price_7d` (بالاترین قیمت خودیِ ثبات‌یافته در پنجره ۷ روزی) یا `market_p75`
 *     (کمینه صدک ۷۵ معتبر و بالاترین credible). بدون مرجع → بدون تخفیف.
 *  ۲) درصد واقعی = floor((مرجع − کف) / مرجع × ۱۰۰)؛ درصد «نمایشی» ساختگی وجود ندارد.
 *  ۳) اگر درصد < minDiscountPct یا > maxDiscountPct → بدون تخفیف (شرط ورود به کمپین، نه اجبار).
 *  ۴) کوچک‌ترین سقف ممکن از `calibrateBaseForPct`؛ اگر سقف بالاتر از مرجع شد، درصد کمتر می‌شود
 *     و اگر باز ممکن نشد → بدون تخفیف. سقف فقط «نمایشگر» است.
 */
function buildDiscount(finalPrice, offers, cfg, rounding, opts) {
    const allPositivePrices = offers.filter((o) => o.price > 0).map((o) => o.price);
    const rawLowestPrice = allPositivePrices.length ? Math.min(...allPositivePrices) : null;
    const rawHighestPrice = allPositivePrices.length ? Math.max(...allPositivePrices) : null;
    const validPrices = (0, stats_1.sortAsc)(offers.filter((o) => o.included && o.price > 0).map((o) => o.price));
    const excludedOutliersCount = offers.filter((o) => !o.included).length;
    const monitoredMarketFloor = validPrices.length ? validPrices[0] : null;
    const monitoredMarketMedian = validPrices.length ? Math.round((0, stats_1.median)(validPrices)) : null;
    const maxDisc = (0, stats_1.clamp)(cfg.maxDiscountPct ?? 35, 2, 95);
    const minDisc = (0, stats_1.clamp)(cfg.minDiscountPct ?? 5, 1, 90);
    // ۱) مرجع و درصد واقعی: بدون مرجع → بدون تخفیف
    const ref = pickDiscountReference(finalPrice, offers, cfg, opts);
    let refPrice = ref.refPrice;
    if (refPrice == null || refPrice <= finalPrice || ref.kind === "none") {
        return noDiscountOutcome(finalPrice, offers, "بدون مرجع معتبر بالاتر از کف (own_price_7d یا market_p75) → تخفیف اعمال نشد (بدون کمپین)", ref);
    }
    let pct = Math.floor(((refPrice - finalPrice) / refPrice) * 100);
    // ۲) پاک‌سازی باورپذیری تخفیف نسبت به مرجع
    if (pct > maxDisc) {
        return noDiscountOutcome(finalPrice, offers, `تفاوت کف با مرجع (${pct}%) از سقف تخفیف باورپذیر (${maxDisc}%) بیشتر است → تخفیف اعمال نشد (بدون کمپین)`, ref);
    }
    // ۳) آستانه تخفیف = شرط ورود به کمپین؛ اگر کمتر از آن شود فرصت واقعی نیست (تخفیف نادیده اعمال نمی‌شود!)
    if (pct < minDisc) {
        return noDiscountOutcome(finalPrice, offers, `تخفیف واقعی نسبت به مرجع (${pct}%) زیر آستانه ورود ${minDisc}% است → بدون کمپین (فرصت کوچک نمایش نمی‌یابد)`, ref);
    }
    // ۴) سقف monitored بازار برای گزارش + نهایی سقف کالیبره‌شده روی کف
    const marketCeilingOverride = opts?.ceilingOverride && opts.ceilingOverride > finalPrice
        ? Math.round(opts.ceilingOverride)
        : null;
    const maxAboveMedianPct = Math.max(5, cfg.maxCeilingAboveMedianPct ?? 18);
    const medianCeilingCap = monitoredMarketMedian != null
        ? Math.round(monitoredMarketMedian * (1 + maxAboveMedianPct / 100))
        : null;
    const monitoredMarketCeiling = marketCeilingOverride ??
        (monitoredMarketMedian != null ? Math.min(medianCeilingCap ?? Infinity, refPrice) : refPrice);
    let adjustedForRef = false;
    let base = calibrateBaseForPct(finalPrice, pct);
    // سقف هرگز نباید از مرجع بالاتر برود؛ درصد را کمتر کن تا سقف زیر مرجع بماند
    for (let guard = 0; guard < 6 && base > refPrice; guard++) {
        pct -= 1;
        adjustedForRef = true;
        if (pct < 1)
            break;
        base = calibrateBaseForPct(finalPrice, pct);
    }
    if (base <= finalPrice || pct < 1) {
        return noDiscountOutcome(finalPrice, offers, "کالیبراسیون سقف روی کف و زیر مرجع ناممکن شد → تخفیف اعمال نشد (بدون کمپین)", ref);
    }
    const discountAmountToman = base - finalPrice;
    const exactFloorRestored = Math.round(base * (1 - pct / 100));
    const floorConfirmed = exactFloorRestored === finalPrice;
    const discountExplanation = `${ref.kind === "own_price_7d" ? "مرجع: بالاترین قیمت خودیِ دوام‌یافته ۷ روزی" : "مرجع: صدک ۷۵ بازار معتبر"} (${refPrice.toLocaleString("fa-IR")} تومان) ` +
        `→ تخفیف واقعی ${pct}%${adjustedForRef ? " (درصد کاسته شد تا سقف زیر مرجع بماند)" : ""}` +
        ` → سقف کالیبره‌شده ${base.toLocaleString("fa-IR")} تومان → کف دقیق ${finalPrice.toLocaleString("fa-IR")} تومان`;
    const floorCeiling = {
        rawLowestPrice,
        rawHighestPrice,
        monitoredSellersCount: validPrices.length,
        excludedOutliersCount,
        monitoredMarketFloor,
        monitoredMarketMedian,
        monitoredMarketCeiling,
        calibratedCeilingPrice: base,
        ceilingBasePrice: base,
        targetFloorPrice: finalPrice,
        discountPct: pct,
        appliedDiscountPct: pct,
        discountAmountToman,
        exactFloorRestored,
        ceilingMethodUsed: ref.kind === "own_price_7d" ? "own_price_7d_ceiling" : "market_p75_ceiling",
        discoveryModeUsed: cfg.mode ?? cfg.basePriceMode ?? "market_percentile_ceiling",
        explanation: discountExplanation,
    };
    return {
        basePrice: base,
        finalPrice,
        discountPct: pct,
        explanation: discountExplanation,
        referenceKind: ref.kind,
        referencePrice: refPrice,
        floorConfirmed,
        floorCeiling,
    };
}
