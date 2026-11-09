'use strict'
// مولد اعداد شبه‌تصادفی قابل‌تکرار (Mulberry32) + ابزارهای نمونه‌گیری
function makeRng(seed) {
  let a = (seed >>> 0) || 1
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = {
    next,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    pickW: (pairs) => {
      // pairs: [[value, weight], ...]
      const tot = pairs.reduce((s, p) => s + p[1], 0)
      let r = next() * tot
      for (const [v, w] of pairs) {
        r -= w
        if (r <= 0) return v
      }
      return pairs[pairs.length - 1][0]
    },
    normal: (mu = 0, sd = 1) => {
      let u = 0
      let v = 0
      while (u === 0) u = next()
      while (v === 0) v = next()
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    logNormal: (mu = 0, sd = 1) => Math.exp(rng.normal(mu, sd)),
    shuffle: (arr) => {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    sample: (arr, k) => rng.shuffle(arr).slice(0, k),
    fork: (salt) => makeRng(((seed >>> 0) ^ (hashStr(String(salt)) >>> 0)) >>> 0),
  }
  return rng
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

module.exports = { makeRng, hashStr }
