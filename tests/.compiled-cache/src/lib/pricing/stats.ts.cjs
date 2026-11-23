"use strict";
/** توابع آماری پایه (بدون وابستگی) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortAsc = sortAsc;
exports.mean = mean;
exports.median = median;
exports.percentile = percentile;
exports.mad = mad;
exports.trimmedMean = trimmedMean;
exports.weightedMean = weightedMean;
exports.weightedMedian = weightedMedian;
exports.coefficientOfVariation = coefficientOfVariation;
exports.roundToStep = roundToStep;
exports.floorToStep = floorToStep;
exports.ceilToStep = ceilToStep;
exports.clamp = clamp;
function sortAsc(xs) {
    return xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
}
function mean(xs) {
    const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
    if (!s.length)
        return NaN;
    return s.reduce((a, b) => a + b, 0) / s.length;
}
function median(xs) {
    const s = sortAsc(xs);
    if (!s.length)
        return NaN;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** صدک با درون‌یابی خطی (0..100) */
function percentile(xs, p) {
    const s = sortAsc(xs);
    if (!s.length)
        return NaN;
    if (s.length === 1)
        return s[0];
    const safeP = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 50;
    const rank = (safeP / 100) * (s.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    const frac = rank - lo;
    return s[lo] + (s[hi] - s[lo]) * frac;
}
/** انحراف مطلق میانه (MAD) */
function mad(xs) {
    const s = sortAsc(xs);
    if (!s.length)
        return NaN;
    const m = median(s);
    return median(s.map((x) => Math.abs(x - m)));
}
function trimmedMean(xs, trimPct) {
    const s = sortAsc(xs);
    if (!s.length)
        return NaN;
    const safeTrim = Number.isFinite(trimPct) ? Math.min(49.9, Math.max(0, trimPct)) : 0;
    const k = Math.floor((s.length * safeTrim) / 100);
    const body = k > 0 && k * 2 < s.length ? s.slice(k, s.length - k) : s;
    return body.length ? mean(body) : mean(s);
}
function weightedMean(xs, ws) {
    if (!xs.length)
        return NaN;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
        if (typeof x !== "number" || !Number.isFinite(x))
            return;
        const rawW = ws[i] ?? 1;
        const w = typeof rawW === "number" && Number.isFinite(rawW) ? Math.max(0, rawW) : 0;
        if (w <= 0)
            return;
        num += x * w;
        den += w;
    });
    return den > 0 ? num / den : mean(xs);
}
/** میانه وزنی: نقطه‌ای که نصف مجموع وزن از هر طرف آن قرار دارد (برای مرجع کلاس‌بندی R0/R1) */
function weightedMedian(xs, ws) {
    if (!xs.length)
        return NaN;
    const pairs = xs
        .map((x, i) => {
        const rawW = ws[i] ?? 1;
        const w = typeof rawW === "number" && Number.isFinite(rawW) ? Math.max(0, rawW) : 0;
        return { x, w };
    })
        .filter((p) => p.w > 0 && typeof p.x === "number" && Number.isFinite(p.x))
        .sort((a, b) => a.x - b.x);
    if (!pairs.length)
        return median(xs);
    if (pairs.length === 1)
        return pairs[0].x;
    const total = pairs.reduce((s, p) => s + p.w, 0);
    let acc = 0;
    for (const p of pairs) {
        acc += p.w;
        if (acc >= total / 2 && acc - p.w <= total / 2) {
            return p.x;
        }
    }
    return pairs[pairs.length - 1].x;
}
/** ضریب پراکندگی نسبی (برای اعتماد) */
function coefficientOfVariation(xs) {
    const s = sortAsc(xs);
    if (s.length < 2)
        return 0;
    const m = mean(s);
    if (!Number.isFinite(m) || m <= 0)
        return 0;
    const v = s.reduce((a, x) => a + (x - m) ** 2, 0) / (s.length - 1);
    return Math.sqrt(Math.max(0, v)) / m;
}
function roundToStep(x, step) {
    if (!Number.isFinite(x))
        return 0;
    const s = Number.isFinite(step) ? Math.round(step) : 1;
    if (!s || s <= 1)
        return Math.round(x);
    return Math.round(x / s) * s;
}
function floorToStep(x, step) {
    if (!Number.isFinite(x))
        return 0;
    const s = Number.isFinite(step) ? Math.round(step) : 1;
    if (!s || s <= 1)
        return Math.floor(x);
    return Math.floor(x / s) * s;
}
function ceilToStep(x, step) {
    if (!Number.isFinite(x))
        return 0;
    const s = Number.isFinite(step) ? Math.round(step) : 1;
    if (!s || s <= 1)
        return Math.ceil(x);
    return Math.ceil(x / s) * s;
}
function clamp(x, lo, hi) {
    const minVal = Math.min(lo, hi);
    const maxVal = Math.max(lo, hi);
    if (!Number.isFinite(x))
        return minVal;
    return Math.min(maxVal, Math.max(minVal, x));
}
