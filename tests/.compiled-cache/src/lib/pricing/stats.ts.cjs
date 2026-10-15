"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ceilToStep = ceilToStep;
exports.clamp = clamp;
exports.coefficientOfVariation = coefficientOfVariation;
exports.floorToStep = floorToStep;
exports.mad = mad;
exports.mean = mean;
exports.median = median;
exports.percentile = percentile;
exports.roundToStep = roundToStep;
exports.sortAsc = sortAsc;
exports.trimmedMean = trimmedMean;
exports.weightedMean = weightedMean;
/** توابع آماری پایه (بدون وابستگی) */

function sortAsc(xs) {
  return [...xs].sort((a, b) => a - b);
}
function mean(xs) {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs) {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** صدک با درون‌یابی خطی (0..100) */
function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  if (s.length === 1) return s[0];
  const rank = Math.min(100, Math.max(0, p)) / 100 * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return s[lo] + (s[hi] - s[lo]) * frac;
}

/** انحراف مطلق میانه (MAD) */
function mad(xs) {
  if (!xs.length) return NaN;
  const m = median(xs);
  return median(xs.map(x => Math.abs(x - m)));
}
function trimmedMean(xs, trimPct) {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  const k = Math.floor(s.length * trimPct / 100);
  const body = s.slice(k, s.length - k);
  return body.length ? mean(body) : mean(s);
}
function weightedMean(xs, ws) {
  if (!xs.length) return NaN;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    const w = ws[i] ?? 1;
    num += x * w;
    den += w;
  });
  return den > 0 ? num / den : mean(xs);
}

/** ضریب پراکندگی نسبی (برای اعتماد) */
function coefficientOfVariation(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return m > 0 ? Math.sqrt(v) / m : 0;
}
function roundToStep(x, step) {
  if (!step || step <= 1) return Math.round(x);
  return Math.round(x / step) * step;
}
function floorToStep(x, step) {
  if (!step || step <= 1) return Math.floor(x);
  return Math.floor(x / step) * step;
}
function ceilToStep(x, step) {
  if (!step || step <= 1) return Math.ceil(x);
  return Math.ceil(x / step) * step;
}
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}