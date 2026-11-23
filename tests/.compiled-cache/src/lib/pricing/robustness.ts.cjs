"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIDENCE_MODEL = exports.DEFAULT_SCENARIO_OPTIONS = void 0;
exports.analyzeDecisionScenarios = analyzeDecisionScenarios;
exports.calibratedConfidence = calibratedConfidence;
exports.aurocFromPairs = aurocFromPairs;
exports.computeCalibrationMetrics = computeCalibrationMetrics;
exports.computeECE = computeECE;
exports.DEFAULT_SCENARIO_OPTIONS = {
    tolerancePct: 2,
    maxScenarios: 6,
    minScenarioP: 0.03,
    minIncludeProb: 0.15,
};
/**
 * @param report   خروجی assessValidity
 * @param finalPrice قیمت نهایی تصمیم اصلی (پس از محافظ‌ها)
 * @param eligible آیا پیشنهاد می‌تواند در هر فرضی وارد بازار شود؟ (مثلاً پرتِ سمت بالا هیچ‌وقت وارد نمی‌شود)
 * @param decide   اجرای خط‌لولهٔ تصمیم روی مجموعهٔ پیشنهادهای وارد‌شده؛ قیمت نهایی را برمی‌گرداند
 */
function analyzeDecisionScenarios(report, finalPrice, eligible, decide, options) {
    const opt = { ...exports.DEFAULT_SCENARIO_OPTIONS, ...(options ?? {}) };
    const tol = Math.max(0, opt.tolerancePct) / 100;
    const sorted = report.sortedOffers;
    const picks = report.lowestDist
        .map((d, k) => ({ k, p: d.p }))
        .filter((x) => x.p >= opt.minScenarioP)
        .sort((a, b) => b.p - a.p)
        .slice(0, Math.max(1, opt.maxScenarios))
        .sort((a, b) => a.k - b.k);
    const scenarios = [];
    for (const { k, p } of picks) {
        const included = new Set();
        for (let j = k; j < sorted.length; j++) {
            const o = sorted[j];
            if (!eligible(o))
                continue;
            const pj = report.perOffer.get(o)?.p ?? 0;
            if (j === k || pj >= opt.minIncludeProb)
                included.add(o);
        }
        const out = decide(included);
        scenarios.push({
            lowestPrice: sorted[k].price,
            shopName: sorted[k].shopName,
            p,
            finalPrice: out.finalPrice,
            strategy: out.strategy,
        });
    }
    let pRight = 0;
    let pTooHigh = 0;
    let pTooLow = 0;
    let covered = 0;
    let alternative = null;
    const validFinalPrice = typeof finalPrice === "number" && Number.isFinite(finalPrice) && finalPrice > 0;
    for (const s of scenarios) {
        covered += s.p;
        if (!validFinalPrice || s.finalPrice == null || !(s.finalPrice > 0))
            continue;
        const rel = (finalPrice - s.finalPrice) / s.finalPrice;
        if (Math.abs(rel) <= tol) {
            pRight += s.p;
        }
        else {
            if (rel > 0)
                pTooHigh += s.p;
            else
                pTooLow += s.p;
            if (!alternative || s.p > alternative.p) {
                alternative = { finalPrice: s.finalPrice, p: s.p, lowestPrice: s.lowestPrice, shopName: s.shopName };
            }
        }
    }
    return {
        scenarios,
        coveredMass: Math.min(1, covered),
        pNoneValid: report.pNoneValid,
        pRight: Math.min(1, pRight),
        pTooHigh: Math.min(1, pTooHigh),
        pTooLow: Math.min(1, pTooLow),
        alternative,
    };
}
exports.DEFAULT_CONFIDENCE_MODEL = {
    intercept: 0,
    wLogitRight: 1,
    wHeuristic: 0,
    wNoneValid: 0,
    wFloorBound: 0,
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
function calibratedConfidence(m, f) {
    if (typeof f.pRight !== "number" || !Number.isFinite(f.pRight))
        return 0;
    const w = { ...exports.DEFAULT_CONFIDENCE_MODEL, ...(m ?? {}) };
    const pr = clamp(f.pRight, 0.01, 0.99);
    const heur = typeof f.heuristic === "number" && Number.isFinite(f.heuristic) ? clamp(f.heuristic, 0, 1) : 0;
    const pNone = typeof f.pNoneValid === "number" && Number.isFinite(f.pNoneValid) ? clamp(f.pNoneValid, 0, 1) : 0;
    const z = (Number.isFinite(w.intercept) ? w.intercept : 0) +
        (Number.isFinite(w.wLogitRight) ? w.wLogitRight : 1) * Math.log(pr / (1 - pr)) +
        (Number.isFinite(w.wHeuristic) ? w.wHeuristic : 0) * heur +
        (Number.isFinite(w.wNoneValid) ? w.wNoneValid : 0) * pNone +
        (Number.isFinite(w.wFloorBound) ? w.wFloorBound : 0) * (f.floorBound ? 1 : 0);
    const c = sigmoid(z);
    return Number.isFinite(c) ? Math.round(c * 1000) / 1000 : 0;
}
function normalizeCalibrationPairs(first, second, third) {
    let numBins = 10;
    const pairs = [];
    if (!Array.isArray(first)) {
        return { pairs, numBins };
    }
    if (Array.isArray(second)) {
        if (typeof third === "number" && Number.isFinite(third) && third >= 1) {
            numBins = Math.min(100, Math.max(1, Math.floor(third)));
        }
        const len = Math.min(first.length, second.length);
        for (let i = 0; i < len; i++) {
            const rawP = Number(first[i]);
            const rawY = second[i];
            const yNum = typeof rawY === "boolean" ? (rawY ? 1 : 0) : Number(rawY);
            if (!Number.isFinite(rawP) || !Number.isFinite(yNum))
                continue;
            pairs.push({
                p: Math.min(1, Math.max(0, rawP)),
                y: Math.min(1, Math.max(0, yNum)),
            });
        }
    }
    else {
        if (typeof second === "number" && Number.isFinite(second) && second >= 1) {
            numBins = Math.min(100, Math.max(1, Math.floor(second)));
        }
        for (const item of first) {
            if (!item || typeof item !== "object")
                continue;
            const rawP = Number(item.p ?? item.prob ?? item.confidence);
            const rawY = item.y ?? item.label ?? item.actual;
            const yNum = typeof rawY === "boolean" ? (rawY ? 1 : 0) : Number(rawY);
            if (!Number.isFinite(rawP) || !Number.isFinite(yNum))
                continue;
            pairs.push({
                p: Math.min(1, Math.max(0, rawP)),
                y: Math.min(1, Math.max(0, yNum)),
            });
        }
    }
    return { pairs, numBins };
}
function aurocFromPairs(pairs) {
    const pos = [];
    const neg = [];
    for (const r of pairs) {
        if (r.y >= 0.5)
            pos.push(r.p);
        else
            neg.push(r.p);
    }
    if (!pos.length || !neg.length)
        return null;
    let wins = 0;
    for (const pp of pos) {
        for (const np of neg) {
            if (pp > np)
                wins += 1;
            else if (pp === np)
                wins += 0.5;
        }
    }
    return wins / (pos.length * neg.length);
}
/**
 * محاسبه خطای کالیبراسیون مورد انتظار (ECE) و متریک‌های کالیبراسیون احتمال (Brier, MCE, AUROC).
 * ورودی می‌تواند دو آرایه `(probs, labels, numBins?)` یا آرایه‌ای از اشیاء `({ p, y }, numBins?)` باشد.
 */
function computeCalibrationMetrics(first, second, third) {
    const { pairs, numBins } = normalizeCalibrationPairs(first, second, third);
    const n = pairs.length;
    if (n === 0) {
        return { n: 0, ece: 0, mce: 0, brier: 0, auroc: null, baseRate: 0, bins: [] };
    }
    const bucketData = Array.from({ length: numBins }, (_, i) => ({
        binIndex: i,
        lower: i / numBins,
        upper: (i + 1) / numBins,
        count: 0,
        sumP: 0,
        sumY: 0,
    }));
    let brierSum = 0;
    let totalY = 0;
    for (const { p, y } of pairs) {
        const idx = Math.min(numBins - 1, Math.max(0, Math.floor(p * numBins)));
        bucketData[idx].count += 1;
        bucketData[idx].sumP += p;
        bucketData[idx].sumY += y;
        brierSum += (p - y) ** 2;
        totalY += y;
    }
    let ece = 0;
    let mce = 0;
    const bins = bucketData.map((b) => {
        if (b.count === 0) {
            return {
                binIndex: b.binIndex,
                lower: b.lower,
                upper: b.upper,
                count: 0,
                meanPred: 0,
                meanActual: 0,
                absError: 0,
            };
        }
        const meanPred = b.sumP / b.count;
        const meanActual = b.sumY / b.count;
        const absError = Math.abs(meanPred - meanActual);
        ece += (b.count / n) * absError;
        if (absError > mce)
            mce = absError;
        return {
            binIndex: b.binIndex,
            lower: b.lower,
            upper: b.upper,
            count: b.count,
            meanPred,
            meanActual,
            absError,
        };
    });
    return {
        n,
        ece,
        mce,
        brier: brierSum / n,
        auroc: aurocFromPairs(pairs),
        baseRate: totalY / n,
        bins,
    };
}
function computeECE(first, second, third) {
    return computeCalibrationMetrics(first, second, third).ece;
}
