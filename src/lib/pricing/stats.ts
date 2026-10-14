/** توابع آماری پایه (بدون وابستگی) */

export function sortAsc(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** صدک با درون‌یابی خطی (0..100) */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  if (s.length === 1) return s[0];
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return s[lo] + (s[hi] - s[lo]) * frac;
}

/** انحراف مطلق میانه (MAD) */
export function mad(xs: number[]): number {
  if (!xs.length) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export function trimmedMean(xs: number[], trimPct: number): number {
  if (!xs.length) return NaN;
  const s = sortAsc(xs);
  const k = Math.floor((s.length * trimPct) / 100);
  const body = s.slice(k, s.length - k);
  return body.length ? mean(body) : mean(s);
}

export function weightedMean(xs: number[], ws: number[]): number {
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
export function coefficientOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return m > 0 ? Math.sqrt(v) / m : 0;
}

export function roundToStep(x: number, step: number): number {
  if (!step || step <= 1) return Math.round(x);
  return Math.round(x / step) * step;
}

export function floorToStep(x: number, step: number): number {
  if (!step || step <= 1) return Math.floor(x);
  return Math.floor(x / step) * step;
}

export function ceilToStep(x: number, step: number): number {
  if (!step || step <= 1) return Math.ceil(x);
  return Math.ceil(x / step) * step;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
