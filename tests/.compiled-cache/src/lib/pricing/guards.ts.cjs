"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBelowCostAuthorization = exports.evaluateDecisionFloorSafety = exports.evaluateApproveMargin = void 0;
exports.applyGuards = applyGuards;
exports.applyCeilRounding = applyCeilRounding;
exports.applyRoundingWithFloor = applyRoundingWithFloor;
exports.applyRounding = applyRounding;
const approval_1 = require("./approval");
Object.defineProperty(exports, "evaluateApproveMargin", { enumerable: true, get: function () { return approval_1.evaluateApproveMargin; } });
Object.defineProperty(exports, "evaluateDecisionFloorSafety", { enumerable: true, get: function () { return approval_1.evaluateDecisionFloorSafety; } });
Object.defineProperty(exports, "validateBelowCostAuthorization", { enumerable: true, get: function () { return approval_1.validateBelowCostAuthorization; } });
const stats_1 = require("./stats");
const sourcing_1 = require("./sourcing");
/**
 * مرحله ۵: محافظ‌ها (خطای نزدیک صفر + تضمین مطلق اولویت اول: قیمت فروش > قیمت خرید و تامین)
 *
 * 1. خط قرمز کف خرید و سود (Hard Floor):
 *    قیمت هرگز (نه قبل از گرد کردن، نه بعد از سقف تغییر، و نه بعد از گرد کردن روانی x900/x000)
 *    زیر hardFloorPrice (یا <= costPrice) نمی‌رود!
 * 2. حداکثر تغییر در هر اجرا و سقف روزانه:
 *    اگر تغییر نسبت به قیمت فعلی بیش از حد بود، قیمت به سقف تغییر محدود می‌شود،
 *    اما اگر قیمت فعلی خودش زیر کف خرید جدید همکاران بود، اولویت با خط قرمز کف خرید است (هرگز با ضرر نمی‌فروشیم!).
 * 3. هیسترزیس (جلوگیری از نوسان بی‌مورد):
 *    اگر تغییر کمتر از hysteresisPct باشد و قیمت فعلی بالای کف سود باشد، تغییر بی‌مورد اعمال نمی‌شود.
 */
function applyGuards(target, ctx, cfg, rounding, opts) {
    const notes = [];
    const reviewReasons = [];
    let floorEnforced = false;
    let heldByHysteresis = false;
    const rawCost = Math.max(0, Math.round(Number(ctx.costPrice) || 0));
    const invCost = Math.max(0, Math.round(Number(ctx.inventoryCost) || 0));
    const repCost = Math.max(0, Math.round(Number(ctx.replacementCost) || 0));
    const effectiveCost = ctx.costPolicy === "replacement_floor"
        ? Math.max(rawCost, repCost)
        : Math.max(rawCost, invCost, repCost);
    const strictAboveCost = ctx.strictAboveCost !== false;
    const computedFloor = effectiveCost > 0
        ? (0, sourcing_1.computeHardFloorPrice)({
            effectiveCostPrice: effectiveCost,
            minMarginPct: Math.max(0, Number(ctx.minMarginPct) || 0),
            minProfitAmountToman: Math.max(0, Number(ctx.minProfitAmountToman) || 0),
            fixedCostToman: Math.max(0, Number(ctx.fixedCostToman) || 0),
            finalStep: rounding.finalStep,
            psychological: rounding.psychological,
            strictAboveCost,
        })
        : 0;
    const overrideFloor = ctx.hardFloorPriceOverride != null && Number.isFinite(ctx.hardFloorPriceOverride) && ctx.hardFloorPriceOverride > 0
        ? Math.round(ctx.hardFloorPriceOverride)
        : 0;
    // هرگز اجازه ندهیم hardFloorPriceOverride پایین‌تر از کف واقعی محاسبه‌شده از قیمت تمام‌شده باشد
    const hardFloor = Math.max(overrideFloor, computedFloor);
    const minAllowedPrice = Math.max(hardFloor, effectiveCost > 0 ? (strictAboveCost ? effectiveCost + 1 : effectiveCost) : 0);
    let price = Number.isFinite(target) && target > 0 ? target : minAllowedPrice > 0 ? minAllowedPrice : Math.max(0, Number(ctx.currentPrice) || 0);
    // ۱) اعمال اولیه خط قرمز کف خرید و سود
    if (minAllowedPrice > 0 && price < minAllowedPrice) {
        notes.push(`قیمت هدف ${Math.round(price).toLocaleString("fa-IR")} زیر خط قرمز تامین + حداقل سود (${minAllowedPrice.toLocaleString("fa-IR")} تومان) بود → روی کف مجاز قرار گرفت`);
        price = minAllowedPrice;
        floorEnforced = true;
    }
    // ۲) حداکثر تغییر نسبت به قیمت فعلی (مشروط بر اینکه هرگز زیر خط قرمز کف خرید نماند!)
    const curPrice = ctx.currentPrice != null && Number.isFinite(ctx.currentPrice) && ctx.currentPrice > 0 ? ctx.currentPrice : null;
    if (curPrice != null) {
        const changePct = ((price - curPrice) / curPrice) * 100;
        const hyst = Math.max(0, Number(cfg.hysteresisPct) || 0);
        const maxUpPct = cfg.maxIncreasePct != null && Number.isFinite(cfg.maxIncreasePct) && cfg.maxIncreasePct > 0
            ? cfg.maxIncreasePct
            : Math.max(0, Number(cfg.maxChangePctPerRun) || 0);
        const maxDownPct = cfg.maxDecreasePct != null && Number.isFinite(cfg.maxDecreasePct) && cfg.maxDecreasePct > 0
            ? cfg.maxDecreasePct
            : Math.max(0, Number(cfg.maxChangePctPerRun) || 0);
        // هیسترزیس یک‌طرفه (۴.۱.۱): فقط افزایش‌های بسیار جزئی نادیده گرفته می‌شوند.
        // کاهش جزئی هرگز مسدود نمی‌شود؛ وگرنه رقیب با یک پله کاهش، جای ما را در رتبه ۱ می‌گیرد.
        // — مگر آنکه قیمت فعلی زیر کف قرمز باشد؛ آنجا هر نوسانی اهمیت دارد.
        if (hyst > 0 && changePct >= 0 && changePct < hyst && curPrice >= minAllowedPrice) {
            price = curPrice;
            heldByHysteresis = changePct > 0;
            if (changePct > 0) {
                notes.push(`افزایش جزئی (${changePct.toFixed(2)}% < ${hyst}%) نادیده گرفته شد تا ثبات قیمت حفظ شود (هیسترزیس یک‌طرفه)`);
            }
        }
        else if (changePct > 0 && maxUpPct > 0 && changePct > maxUpPct) {
            const capped = curPrice * (1 + maxUpPct / 100);
            if (minAllowedPrice > 0 && capped < minAllowedPrice) {
                // اولویت اول سیستم: اگر قیمت قبلی ما از قیمت خرید جدید همکاران کمتر بوده،
                // سقف تغییر نباید مانع بالا رفتن قیمت تا خط قرمز کف خرید شود!
                notes.push(`قیمت فعلی (${curPrice.toLocaleString("fa-IR")}) زیر کف جدید لیست همکاران (${minAllowedPrice.toLocaleString("fa-IR")}) بود؛ اولویت اول با جلوگیری از فروش زیر قیمت خرید است (جهش ${changePct.toFixed(1)}% به کف مجاز اعمال شد)`);
                price = minAllowedPrice;
                floorEnforced = true;
                reviewReasons.push(`جهش قیمت ${changePct.toFixed(1)}% به دلیل به‌روزرسانی کف خرید همکاران (قیمت فعلی زیر کف بود)`);
            }
            else {
                notes.push(`تغییر ${changePct.toFixed(1)}% از سقف مجاز ${maxUpPct}% بیشتر بود → به ${Math.round(capped).toLocaleString("fa-IR")} محدود شد`);
                price = capped;
                reviewReasons.push(`جهش قیمت ${changePct.toFixed(1)}% نسبت به قیمت فعلی`);
            }
        }
        else if (changePct < 0 && maxDownPct > 0 && Math.abs(changePct) > maxDownPct) {
            const capped = curPrice * (1 - maxDownPct / 100);
            if (minAllowedPrice > 0 && capped < minAllowedPrice) {
                price = minAllowedPrice;
                floorEnforced = true;
                notes.push(`کاهش قیمت به خط قرمز کف سود (${minAllowedPrice.toLocaleString("fa-IR")} تومان) محدود شد`);
            }
            else {
                notes.push(`تغییر ${changePct.toFixed(1)}% از سقف مجاز ${maxDownPct}% بیشتر بود → به ${Math.round(capped).toLocaleString("fa-IR")} محدود شد`);
                price = capped;
                reviewReasons.push(`جهش قیمت ${changePct.toFixed(1)}% نسبت به قیمت فعلی`);
            }
        }
    }
    // ۲-ب) سقف تغییرات روزانه (maxDailyChangePct نسبت به قیمت ۲۴ ساعت قبل)
    const price24h = ctx.price24hAgo != null && Number.isFinite(ctx.price24hAgo) && ctx.price24hAgo > 0 ? ctx.price24hAgo : null;
    const maxDailyPct = cfg.maxDailyChangePct != null && Number.isFinite(cfg.maxDailyChangePct) && cfg.maxDailyChangePct > 0
        ? cfg.maxDailyChangePct
        : 0;
    if (price24h != null && maxDailyPct > 0) {
        const dailyChangePct = ((price - price24h) / price24h) * 100;
        if (Math.abs(dailyChangePct) > maxDailyPct) {
            const dailyCapped = dailyChangePct > 0
                ? price24h * (1 + maxDailyPct / 100)
                : price24h * (1 - maxDailyPct / 100);
            if (minAllowedPrice > 0 && dailyCapped < minAllowedPrice) {
                price = minAllowedPrice;
                floorEnforced = true;
                notes.push(`محدودیت سقف نوسان روزانه در برابر کف سود؛ قیمت روی کف مجاز (${minAllowedPrice.toLocaleString("fa-IR")}) تثبیت شد`);
            }
            else {
                price = dailyCapped;
                notes.push(`تغییر روزانه (${dailyChangePct.toFixed(1)}%) به سقف ۲۴ ساعته (${maxDailyPct}%) محدود شد`);
                reviewReasons.push(`برخورد با سقف نوسان روزانه (${maxDailyPct}%)`);
            }
        }
    }
    // ۳) گرد کردن نهایی با تضمین ریاضی عدم عبور از خط قرمز کف خرید و سود
    const effectiveStep = Math.max(1, Math.round(Number(rounding.finalStep) || 1000));
    if (heldByHysteresis && curPrice != null && curPrice >= minAllowedPrice) {
        price = Math.round(curPrice);
    }
    else if (floorEnforced || opts?.direction === "ceil") {
        const ceilTarget = Math.max(price, minAllowedPrice);
        price = applyCeilRounding(ceilTarget, effectiveStep, rounding.psychological, minAllowedPrice, effectiveCost, strictAboveCost);
    }
    else if (opts?.direction === "floor") {
        // undercut-anchor: به پایین گرد کن تا بالای رقیب/انکر نرویم، اما هرگز زیر خط قرمز کف نرو!
        let floored = (0, stats_1.floorToStep)(price, effectiveStep);
        if (rounding.psychological === "x900" && effectiveStep >= 1000) {
            const candidateHigh = floored + effectiveStep - 100;
            floored = candidateHigh <= price ? candidateHigh : Math.max(0, floored - 100);
        }
        if (minAllowedPrice > 0 && floored < minAllowedPrice) {
            floorEnforced = true;
            price = applyCeilRounding(minAllowedPrice, effectiveStep, rounding.psychological, minAllowedPrice, effectiveCost, strictAboveCost);
        }
        else {
            price = Math.max(0, Math.round(floored));
        }
    }
    else {
        price = applyRoundingWithFloor(price, effectiveStep, rounding.psychological, minAllowedPrice, effectiveCost, strictAboveCost);
    }
    return {
        price,
        notes,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        floorEnforced,
    };
}
/**
 * گرد کردن رو به بالا (سقف پله) برای مواقعی که قیمت روی کف سود/خرید قفل شده یا جهت ceil خواسته شده است.
 * تضمین می‌کند که گرد کردن هرگز قیمت را حتی ۱ تومان زیر کف مجاز نبرد.
 */
function applyCeilRounding(x, step, psych, hardFloor = 0, costPrice = 0, strictAboveCost = true) {
    const effectiveStep = Math.max(1, Math.round(Number(step) || 1000));
    const safeCost = Number.isFinite(costPrice) ? Math.max(0, Math.round(costPrice)) : 0;
    const safeFloor = Number.isFinite(hardFloor) ? Math.max(0, Math.round(hardFloor)) : 0;
    const minAllowed = Math.max(Number.isFinite(x) ? Math.max(0, x) : 0, safeFloor, safeCost > 0 ? (strictAboveCost ? safeCost + 1 : safeCost) : 0);
    let base = (0, stats_1.ceilToStep)(minAllowed, effectiveStep);
    if (psych === "x900" && effectiveStep >= 1000) {
        const candidate = base - 100;
        if (candidate >= minAllowed && (safeCost <= 0 || (strictAboveCost ? candidate > safeCost : candidate >= safeCost))) {
            base = candidate;
        }
        else {
            base = base + effectiveStep - 100;
        }
    }
    if (base < minAllowed) {
        base = (0, stats_1.ceilToStep)(minAllowed, effectiveStep);
    }
    return Math.max(0, Math.round(base));
}
/**
 * گرد کردن قیمت همراه با بررسی سخت‌گیرانه کف قیمت (Fix باگ گرد کردن روانی x900 یا گرد کردن به نزدیک‌ترین پله زیر کف سود)
 */
function applyRoundingWithFloor(x, step, psych, hardFloor = 0, costPrice = 0, strictAboveCost = true) {
    const effectiveStep = Math.max(1, Math.round(Number(step) || 1000));
    const safeCost = Number.isFinite(costPrice) ? Math.max(0, Math.round(costPrice)) : 0;
    const safeFloor = Number.isFinite(hardFloor) ? Math.max(0, Math.round(hardFloor)) : 0;
    const minAllowed = Math.max(safeFloor, safeCost > 0 ? (strictAboveCost ? safeCost + 1 : safeCost) : 0);
    let p = applyRounding(x, effectiveStep, psych);
    // اگر گرد کردن یا کسر ۱۰۰ تومان در حالت x900 باعث شد قیمت زیر خط قرمز برود، به سقف پلهٔ مجاز ببر!
    if (minAllowed > 0 && p < minAllowed) {
        p = applyCeilRounding(minAllowed, effectiveStep, psych, safeFloor, safeCost, strictAboveCost);
    }
    return Math.max(0, Math.round(p));
}
function applyRounding(x, step, psych) {
    const effectiveStep = Math.max(1, Math.round(Number(step) || 1000));
    let p = (0, stats_1.roundToStep)(x, effectiveStep);
    if (psych === "x900" && effectiveStep >= 1000) {
        p = p - 100; // 250,000 → 249,900
    }
    return Math.max(0, Math.round(p));
}
