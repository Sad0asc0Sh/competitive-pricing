"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIDENCE_MODEL = exports.DEFAULT_SCENARIO_OPTIONS = void 0;
exports.analyzeDecisionScenarios = analyzeDecisionScenarios;
exports.calibratedConfidence = calibratedConfidence;
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
    for (const s of scenarios) {
        covered += s.p;
        if (s.finalPrice == null || !(s.finalPrice > 0))
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
    const w = { ...exports.DEFAULT_CONFIDENCE_MODEL, ...(m ?? {}) };
    const pr = clamp(f.pRight, 0.01, 0.99);
    const z = w.intercept +
        w.wLogitRight * Math.log(pr / (1 - pr)) +
        w.wHeuristic * clamp(f.heuristic, 0, 1) +
        w.wNoneValid * clamp(f.pNoneValid, 0, 1) +
        w.wFloorBound * (f.floorBound ? 1 : 0);
    const c = sigmoid(z);
    return Number.isFinite(c) ? Math.round(c * 1000) / 1000 : 0;
}
