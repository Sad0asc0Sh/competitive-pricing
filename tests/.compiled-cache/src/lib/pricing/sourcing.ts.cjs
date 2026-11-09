"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeFaText = normalizeFaText;
exports.isMatchingCity = isMatchingCity;
exports.parsePriceToToman = parsePriceToToman;
exports.parseColleaguePriceListText = parseColleaguePriceListText;
exports.resolveSupplyCost = resolveSupplyCost;
exports.computeHardFloorPrice = computeHardFloorPrice;
const stats_1 = require("./stats");
const DIGIT_MAP = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
function normalizeFaText(v) {
    if (v == null)
        return "";
    return String(v)
        .replace(/[\u200B-\u200D\uFEFF]/g, " ")
        .replace(/ي/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/ة/g, "ه")
        .replace(/[آأإ]/g, "ا")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function isMatchingCity(city, defaultCity, aliases = []) {
    if (!city)
        return false;
    const normCity = normalizeFaText(city);
    if (!normCity)
        return false;
    const targets = [defaultCity, ...aliases].map(normalizeFaText).filter(Boolean);
    return targets.some((t) => normCity === t ||
        normCity.includes(t) ||
        t.includes(normCity) ||
        normCity.replace(/\s+/g, "") === t.replace(/\s+/g, ""));
}
function parsePriceToToman(raw, currency = "auto", referenceHintToman) {
    if (raw == null || raw === "")
        return 0;
    if (typeof raw === "number") {
        if (!Number.isFinite(raw) || raw <= 0)
            return 0;
        if (currency === "rial")
            return Math.round(raw / 10);
        if (currency === "auto" &&
            referenceHintToman &&
            referenceHintToman > 0 &&
            raw >= referenceHintToman * 6 &&
            raw <= referenceHintToman * 14) {
            return Math.round(raw / 10);
        }
        return Math.round(raw);
    }
    let s = String(raw).replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d).trim();
    const hasExplicitRial = /(ریال|ريال|\brial\b|\birr\b)/i.test(s);
    const hasExplicitToman = /(تومان|تومن|\btoman\b|\btmn\b)/i.test(s);
    const millionMatch = s.match(/^(\d+(?:[.,/]\d+)?)\s*(میلیون|ملیون|م)(?=\s|$)/i);
    if (millionMatch) {
        const numPart = Number(millionMatch[1].replace(/[,/]/g, "."));
        if (Number.isFinite(numPart) && numPart > 0) {
            return Math.round(numPart * 1_000_000);
        }
    }
    s = s.replace(/(تومان|تومن|ریال|ريال|IRR|TOMAN|TMN|RIAL)/gi, "").trim();
    s = s.replace(/[\s\u00A0\u200B-\u200D\uFEFF٬]/g, "");
    s = s.replace(/٫/g, ".");
    if (s.includes(",") && s.includes(".")) {
        if (s.indexOf(",") < s.indexOf(".")) {
            s = s.replace(/,/g, "");
        }
        else {
            s = s.replace(/\./g, "").replace(/,/g, ".");
        }
    }
    else if (s.includes(".")) {
        const parts = s.split(".");
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1)) {
            s = s.replace(/\./g, "");
        }
    }
    else if (s.includes(",")) {
        const parts = s.split(",");
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1)) {
            s = s.replace(/,/g, "");
        }
        else {
            s = s.replace(/,/g, "");
        }
    }
    const cleaned = s.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    const effectiveCurrency = currency === "rial" || (currency === "auto" && hasExplicitRial && !hasExplicitToman)
        ? "rial"
        : "toman";
    if (effectiveCurrency === "rial") {
        return Math.round(n / 10);
    }
    if (currency === "auto" &&
        !hasExplicitToman &&
        referenceHintToman &&
        referenceHintToman > 0 &&
        n >= referenceHintToman * 6 &&
        n <= referenceHintToman * 14) {
        return Math.round(n / 10);
    }
    return Math.round(n);
}
function parseColleaguePriceListText(text, defaultCurrency = "auto", now = new Date()) {
    if (!text || !text.trim())
        return [];
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
    const out = [];
    for (const line of lines) {
        const parts = line.split(/[,;\t|]+/).map((p) => p.trim());
        if (parts.length < 2)
            continue;
        if (/^(نام همکار|همکار|supplier|name)$/i.test(parts[0]))
            continue;
        const supplierName = parts[0] || "همکار";
        const rawPrice = parts[1];
        const supplierCity = parts[2] || null;
        const priorityNum = parts[3] !== undefined && parts[3] !== "" ? Number(parts[3]) : 5;
        const stockToken = (parts[4] ?? "in").toLowerCase();
        const inStock = !["out", "0", "false", "ناموجود", "خیر", "no"].includes(stockToken);
        const ageDays = parts[5] !== undefined && parts[5] !== "" ? Number(parts[5]) : 0;
        const shippingOverheadToman = parts[6] !== undefined && parts[6] !== "" ? parsePriceToToman(parts[6], defaultCurrency) : undefined;
        const updatedAt = Number.isFinite(ageDays) && ageDays >= 0
            ? new Date(now.getTime() - ageDays * 86_400_000)
            : now;
        out.push({
            supplierName,
            rawPrice,
            currency: defaultCurrency,
            supplierCity,
            priority: Number.isFinite(priorityNum) ? Math.min(10, Math.max(1, priorityNum)) : 5,
            inStock,
            updatedAt,
            shippingOverheadToman,
        });
    }
    return out;
}
function resolveSupplyCost(input) {
    const { config } = input;
    const now = input.now ?? new Date();
    const sCfg = config.sourcing;
    const mCfg = config.margin;
    const rCfg = config.rounding;
    const rankCfg = config.rank1;
    const minMarginPct = input.minMarginPctOverride != null && Number.isFinite(input.minMarginPctOverride)
        ? Math.max(0, Number(input.minMarginPctOverride))
        : Math.max(0, mCfg.minPct);
    const minProfitAmount = input.minProfitAmountOverride != null && Number.isFinite(input.minProfitAmountOverride)
        ? Math.max(0, Number(input.minProfitAmountOverride))
        : Math.max(0, mCfg.minProfitAmountToman);
    const manualCost = Math.max(0, Math.round(Number(input.manualCostPrice) || 0));
    const rawQuotes = Array.isArray(input.supplierQuotes) ? input.supplierQuotes : [];
    const warnings = [];
    const evaluatedQuotes = rawQuotes.map((q) => {
        const buyPriceToman = q.buyPriceToman && q.buyPriceToman > 0
            ? Math.round(q.buyPriceToman)
            : parsePriceToToman(q.rawPrice, q.currency ?? "auto", manualCost || null);
        const isLocalCity = isMatchingCity(q.supplierCity, rankCfg.defaultCity, rankCfg.localCityAliases);
        const shippingOverhead = q.shippingOverheadToman != null
            ? Math.max(0, Math.round(q.shippingOverheadToman))
            : isLocalCity
                ? 0
                : Math.max(0, Math.round(sCfg.defaultNonLocalShippingToman));
        const overheadPct = q.otherOverheadPct != null ? Math.max(0, Number(q.otherOverheadPct)) : Math.max(0, sCfg.defaultOverheadPct);
        const pctOverheadAmount = Math.ceil((buyPriceToman * overheadPct) / 100);
        const overheadAmountToman = shippingOverhead + pctOverheadAmount;
        const effectiveSupplyCost = buyPriceToman > 0 ? buyPriceToman + overheadAmountToman : 0;
        let ageDays = null;
        if (q.updatedAt) {
            const d = q.updatedAt instanceof Date ? q.updatedAt : new Date(q.updatedAt);
            if (!Number.isNaN(d.getTime())) {
                ageDays = Math.max(0, (now.getTime() - d.getTime()) / 86_400_000);
            }
        }
        const priority = Math.min(10, Math.max(1, Number(q.priority ?? 5) || 5));
        const ev = {
            ...q,
            buyPriceToman,
            overheadAmountToman,
            effectiveSupplyCost,
            isLocalCity,
            ageDays,
            priority,
            included: true,
            selectionScore: priority + (isLocalCity && sCfg.preferLocalCitySuppliers ? 2 : 0),
        };
        if (buyPriceToman <= 0) {
            ev.included = false;
            ev.excludeReason = "قیمت خرید همکار نامعتبر یا صفر";
            return ev;
        }
        if (q.inStock === false || (q.stockQty != null && q.stockQty <= 0)) {
            ev.included = false;
            ev.excludeReason = "ناموجود در لیست همکار";
            return ev;
        }
        if (ageDays != null && sCfg.maxQuoteAgeDays > 0 && ageDays > sCfg.maxQuoteAgeDays) {
            ev.included = false;
            ev.excludeReason = `لیست قیمت همکار قدیمی است (${Math.round(ageDays)} روز پیش > حداکثر ${sCfg.maxQuoteAgeDays} روز)`;
            return ev;
        }
        return ev;
    });
    const validQuotes = evaluatedQuotes
        .filter((q) => q.included)
        .sort((a, b) => a.effectiveSupplyCost - b.effectiveSupplyCost || b.selectionScore - a.selectionScore);
    const validCosts = validQuotes.map((q) => q.effectiveSupplyCost);
    const lowestQuoteCost = validCosts.length ? Math.min(...validCosts) : null;
    const highestQuoteCost = validCosts.length ? Math.max(...validCosts) : null;
    const medianQuoteCost = validCosts.length ? Math.round((0, stats_1.median)(validCosts)) : null;
    let costSource = "none";
    let selectedQuote = null;
    let effectiveCostPrice = manualCost;
    let baseBuyPrice = manualCost;
    let overheadAmount = 0;
    let usedFallbackCost = false;
    let safetyBufferAppliedPct = 0;
    let explanation = "";
    // M2: سیاست تقاطع قیمت انبار (manualCost) و قیمت ریپلیس (لیست همکار)
    const policy = sCfg.costPolicy ?? (sCfg.neverBelowManualCost ? "legacy_never_below_manual" : "replacement_floor");
    let inventoryReplacementWarning = null;
    if (sCfg.enabled && validQuotes.length > 0) {
        costSource = "supplier_list";
        const cheapest = validQuotes[0];
        switch (sCfg.selectionMode) {
            case "lowest_valid": {
                selectedQuote = cheapest;
                effectiveCostPrice = cheapest.effectiveSupplyCost;
                baseBuyPrice = cheapest.buyPriceToman;
                overheadAmount = cheapest.overheadAmountToman;
                explanation = `ارزان‌ترین همکار معتبر: «${cheapest.supplierName}»${cheapest.supplierCity ? ` (${cheapest.supplierCity})` : ""} با قیمت خرید ${cheapest.buyPriceToman.toLocaleString("fa-IR")} و تمام‌شده تامین ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
                break;
            }
            case "conservative_high": {
                const highest = validQuotes[validQuotes.length - 1];
                selectedQuote = highest;
                effectiveCostPrice = highest.effectiveSupplyCost;
                baseBuyPrice = highest.buyPriceToman;
                overheadAmount = highest.overheadAmountToman;
                explanation = `حالت محافظه‌کارانه (پوشش ریسک نوسان): همکار «${highest.supplierName}» با تمام‌شده تامین ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
                break;
            }
            case "weighted_priority": {
                const weights = validQuotes.map((q) => Math.max(1, q.selectionScore));
                const wCost = Math.ceil((0, stats_1.weightedMean)(validCosts, weights));
                selectedQuote = cheapest;
                effectiveCostPrice = wCost;
                baseBuyPrice = cheapest.buyPriceToman;
                overheadAmount = Math.max(0, wCost - cheapest.buyPriceToman);
                explanation = `میانگین وزنی لیست همکاران معتبر (${validQuotes.length} همکار): تمام‌شده تامین ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
                break;
            }
            case "priority_then_lowest":
            default: {
                const maxAllowedForPriority = cheapest.effectiveSupplyCost * (1 + Math.max(0, sCfg.priorityTolerancePct) / 100);
                const candidatesInBand = validQuotes.filter((q) => q.effectiveSupplyCost <= maxAllowedForPriority);
                candidatesInBand.sort((a, b) => b.selectionScore - a.selectionScore ||
                    a.effectiveSupplyCost - b.effectiveSupplyCost);
                selectedQuote = candidatesInBand[0] ?? cheapest;
                effectiveCostPrice = selectedQuote.effectiveSupplyCost;
                baseBuyPrice = selectedQuote.buyPriceToman;
                overheadAmount = selectedQuote.overheadAmountToman;
                explanation = `تامین منتخب از لیست همکاران: «${selectedQuote.supplierName}»${selectedQuote.supplierCity ? ` (${selectedQuote.supplierCity})` : ""} — خرید پایه ${baseBuyPrice.toLocaleString("fa-IR")} + سربار ${overheadAmount.toLocaleString("fa-IR")} = تمام‌شده ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
                break;
            }
        }
        if (policy === "legacy_never_below_manual" && sCfg.neverBelowManualCost && manualCost > effectiveCostPrice) {
            warnings.push(`قیمت تمام‌شده ثبت‌شده در انبار (${manualCost.toLocaleString("fa-IR")}) بالاتر از لیست همکار (${effectiveCostPrice.toLocaleString("fa-IR")}) است؛ برای جلوگیری از ضرر روی موجودی فعلی، عدد بالاتر ملاک قرار گرفت`);
            effectiveCostPrice = manualCost;
            baseBuyPrice = manualCost;
            overheadAmount = 0;
            explanation += ` (ارتقا به قیمت خرید انبار: ${manualCost.toLocaleString("fa-IR")} تومان)`;
        }
        else if (policy === "max_inventory_replacement" && manualCost > effectiveCostPrice) {
            warnings.push(`سیاست max_inventory_replacement: کف فروش از بالاترین هزینه انبار (${manualCost.toLocaleString("fa-IR")}) و قیمت ریپلیس (${effectiveCostPrice.toLocaleString("fa-IR")}) تعیین شد`);
            effectiveCostPrice = manualCost;
            baseBuyPrice = manualCost;
            overheadAmount = Math.max(0, effectiveCostPrice - (selectedQuote?.buyPriceToman ?? 0));
            explanation += ` (کف از هزینه انبار: ${manualCost.toLocaleString("fa-IR")} تومان)`;
        }
        else if (policy === "replacement_floor" && manualCost > effectiveCostPrice) {
            inventoryReplacementWarning =
                `قیمت فروش ممکن است زیر هزینه‌ی موجودی انبار (${manualCost.toLocaleString("fa-IR")}) تعیین شود؛ ملاک ریپلیس ارزان‌تر (${effectiveCostPrice.toLocaleString("fa-IR")}) است`;
            warnings.push(inventoryReplacementWarning);
            explanation += ` (قیمت ریپلیس ملاک است؛ انبار گران‌تر: ${manualCost.toLocaleString("fa-IR")} تومان)`;
        }
    }
    else if (rawQuotes.length > 0 && validQuotes.length === 0) {
        usedFallbackCost = true;
        const inStockStale = evaluatedQuotes
            .filter((q) => q.buyPriceToman > 0 && q.inStock !== false)
            .sort((a, b) => b.effectiveSupplyCost - a.effectiveSupplyCost);
        const baseFallback = Math.max(manualCost, inStockStale[0]?.effectiveSupplyCost ?? 0);
        if (baseFallback > 0) {
            costSource = "manual_cost";
            if (sCfg.staleSafetyBufferPct > 0) {
                safetyBufferAppliedPct = sCfg.staleSafetyBufferPct;
                effectiveCostPrice = Math.ceil(baseFallback * (1 + safetyBufferAppliedPct / 100));
                baseBuyPrice = baseFallback;
                overheadAmount = effectiveCostPrice - baseFallback;
                warnings.push(`تمام پیشنهادهای لیست همکاران منقضی یا ناموجود هستند؛ از بالاترین قیمت مرجع تامین به همراه ${safetyBufferAppliedPct}% حاشیه احتیاط نوسان استفاده شد`);
                explanation = `لیست همکاران نیازمند بروزرسانی؛ قیمت تامین احتیاطی = ${effectiveCostPrice.toLocaleString("fa-IR")} تومان (شامل ${safetyBufferAppliedPct}% ضریب امنیت)`;
            }
            else {
                effectiveCostPrice = baseFallback;
                baseBuyPrice = baseFallback;
                warnings.push("هیچ پیشنهاد همکار معتبری یافت نشد؛ از قیمت تمام‌شده دستی استفاده شد");
                explanation = `استفاده از قیمت تمام‌شده دستی محصول: ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
            }
        }
    }
    else if (manualCost > 0) {
        costSource = "manual_cost";
        const ovh = sCfg.enabled && sCfg.defaultOverheadPct > 0
            ? Math.ceil((manualCost * sCfg.defaultOverheadPct) / 100)
            : 0;
        baseBuyPrice = manualCost;
        overheadAmount = ovh;
        effectiveCostPrice = manualCost + ovh;
        explanation =
            ovh > 0
                ? `قیمت خرید محصول ${manualCost.toLocaleString("fa-IR")} + سربار تامین ${ovh.toLocaleString("fa-IR")} = تمام‌شده ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`
                : `قیمت تمام‌شده محصول: ${effectiveCostPrice.toLocaleString("fa-IR")} تومان`;
    }
    else {
        costSource = "none";
        effectiveCostPrice = 0;
        baseBuyPrice = 0;
        overheadAmount = 0;
        explanation = "بدون لیست همکار و قیمت خرید اولیه — در انتظار استخراج هوشمند قیمت معیار و کف امن از بازار ترب";
    }
    const hardFloorPrice = computeHardFloorPrice({
        effectiveCostPrice,
        minMarginPct,
        minProfitAmountToman: minProfitAmount,
        fixedCostToman: mCfg.fixedCostToman ?? 0,
        finalStep: rCfg.finalStep,
        psychological: rCfg.psychological,
    });
    return {
        costSource,
        effectiveCostPrice,
        baseBuyPrice,
        overheadAmount,
        selectedQuote,
        evaluatedQuotes,
        validQuotesCount: validQuotes.length,
        lowestQuoteCost,
        highestQuoteCost,
        medianQuoteCost,
        hardFloorPrice,
        minMarginPctUsed: minMarginPct,
        minProfitAmountUsed: minProfitAmount,
        usedFallbackCost,
        usedMarketConsensusFloor: false,
        safetyBufferAppliedPct,
        explanation,
        warnings,
        costPolicyUsed: policy,
        inventoryReplacementWarning,
    };
}
function computeHardFloorPrice(opts) {
    const cost = Math.max(0, Math.round(opts.effectiveCostPrice));
    if (cost <= 0)
        return 0;
    const step = Math.max(1, opts.finalStep || 1000);
    const fixed = Math.max(0, Math.round(opts.fixedCostToman ?? 0));
    const minMarginPct = Math.max(0, opts.minMarginPct);
    const minProfitAmount = Math.max(1, Math.round(opts.minProfitAmountToman ?? 0));
    const byPct = cost * (1 + minMarginPct / 100) + fixed;
    const byAmount = cost + minProfitAmount + fixed;
    const rawMin = Math.max(byPct, byAmount, cost + 1);
    let floor = (0, stats_1.ceilToStep)(rawMin, step);
    if (opts.psychological === "x900" && step >= 1000) {
        const candidate = floor - 100;
        if (candidate >= rawMin && candidate > cost) {
            floor = candidate;
        }
        else {
            floor = floor + step - 100;
        }
    }
    if (floor <= cost) {
        floor = cost + Math.max(step, minProfitAmount);
    }
    return Math.round(floor);
}
