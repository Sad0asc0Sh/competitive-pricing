'use strict'
/**
 * اعتبارسنجی و ادغام «فقط زیرشاخهٔ estimator» یک پروفایل قیمت‌گذاری (۴.۲.۰)
 *
 * چرا؟
 *  - تنظیمات estimator (مدل اعتماد کالیبره، پروفایل ریسک، نسبت رقابت/سود) در رابط «تنظیمات» پنل نیست.
 *  - POST /api/profiles کل config را با «پیش‌فرض‌ها» ادغام می‌کند؛ یک POST جزئی سفارشی‌سازی‌های دیگر پروفایل را پاک می‌کند.
 *  - ضریب اشتباه (مثلاً minCalibratedConfidence=9 یا anchorCumProb که لنگر را غیرممکن کند) بی‌صدا همهٔ قیمت‌ها را به
 *    «بدون داده/بازبینی» می‌برد. اینجا هر کلید با مقدار پیش‌فرضِ کد (تنها منبع حقیقت) و بازه‌های منطقی سنجیده می‌شود.
 *
 * این ماژول خالص است (بدون دیتابیس/شبکه) تا آزمون‌پذیر باشد. CLI: scripts/apply-estimator-config.cjs
 */
const path = require('node:path')

let _defaults = null
/** پیش‌فرض‌ها همیشه از خودِ کد خوانده می‌شوند (نه لیست دستی‌ای که ممکن است عقب بیفتد) */
function loadDefaults() {
  if (_defaults) return _defaults
  const { loadTsModule } = require(path.join(__dirname, '..', '..', 'tests', 'helpers', 'ts-loader.cjs'))
  const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
  const { DEFAULT_VALIDITY_PARAMS } = loadTsModule('src/lib/pricing/validity.ts')
  const { DEFAULT_SCENARIO_OPTIONS, DEFAULT_CONFIDENCE_MODEL } = loadTsModule('src/lib/pricing/robustness.ts')
  _defaults = {
    estimator: DEFAULT_PROFILE_CONFIG.estimator,
    validity: DEFAULT_VALIDITY_PARAMS,
    scenario: DEFAULT_SCENARIO_OPTIONS,
    confidenceModel: DEFAULT_CONFIDENCE_MODEL,
  }
  return _defaults
}

/** پروفایل‌های ریسک (اندازه‌گیری‌شده روی شبیه‌ساز؛ جدول در docs/ESTIMATOR_V2.md §۷) — هر پروفایل هر سه دستگیره را صریحاً مقداردهی می‌کند */
const PRESETS = {
  conservative: { conflictGateWhenCalibrated: true, supervisorMarketCalibrated: false, minCalibratedConfidence: 0.9 },
  balanced: { conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true, minCalibratedConfidence: 0.9 },
  aggressive: { conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true, minCalibratedConfidence: 0.7 },
}

/** بازه‌های مجاز (کران بسته). کلیدی که اینجا نیست فقط با «نوع» سنجیده می‌شود. */
const RANGES = {
  minCalibratedConfidence: [0.3, 0.99],
  competitivenessCostRatio: [0.05, 10],
  conflictMinProb: [0, 1],
  hardMaxOfferAgeDays: [1, 365],
}
const NESTED_RANGES = {
  confidenceModel: { intercept: [-10, 10], wLogitRight: [-10, 10], wHeuristic: [-10, 10], wNoneValid: [-10, 10], wFloorBound: [-10, 10] },
  scenario: { tolerancePct: [0.1, 20], maxScenarios: [1, 12], minScenarioP: [0, 0.5], minIncludeProb: [0, 1] },
  validity: { anchorCumProb: [0.2, 0.8], minIncludeProb: [0, 1] },
}
const NESTED_KEYS = ['validity', 'scenario', 'confidenceModel']
const isPlain = (x) => x != null && typeof x === 'object' && !Array.isArray(x)

/**
 * @param {unknown} input  فایل JSON: { estimator: {...} } (خروجی fit-confidence --write همین شکل را دارد؛ کلید meta نادیده گرفته می‌شود)
 * @returns {{ ok: boolean, errors: string[], patch: object }}
 */
function validateEstimatorPatch(input, defaults = loadDefaults()) {
  const errors = []
  if (!isPlain(input) || !isPlain(input.estimator)) {
    return { ok: false, errors: ['ورودی باید شیء JSON با کلید «estimator» باشد'], patch: {} }
  }
  const src = input.estimator
  const patch = {}
  for (const [key, value] of Object.entries(src)) {
    if (!(key in defaults.estimator)) {
      errors.push(`estimator.${key}: کلید ناشناخته`)
      continue
    }
    const def = defaults.estimator[key]
    if (NESTED_KEYS.includes(key)) {
      if (!isPlain(value)) {
        errors.push(`estimator.${key}: باید شیء باشد`)
        continue
      }
      const base = defaults[key]
      const nested = {}
      for (const [k, v] of Object.entries(value)) {
        if (!(k in base)) {
          errors.push(`estimator.${key}.${k}: کلید ناشناخته`)
          continue
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          errors.push(`estimator.${key}.${k}: باید عدد متناهی باشد`)
          continue
        }
        const r = (NESTED_RANGES[key] || {})[k]
        if (r && (v < r[0] || v > r[1])) {
          errors.push(`estimator.${key}.${k}=${v}: خارج از بازهٔ مجاز [${r[0]}, ${r[1]}]`)
          continue
        }
        nested[k] = v
      }
      patch[key] = nested
      continue
    }
    if (typeof value !== typeof def) {
      errors.push(`estimator.${key}: نوع نامعتبر (انتظار ${typeof def})`)
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        errors.push(`estimator.${key}: باید عدد متناهی باشد`)
        continue
      }
      const r = RANGES[key]
      if (r && (value < r[0] || value > r[1])) {
        errors.push(`estimator.${key}=${value}: خارج از بازهٔ مجاز [${r[0]}, ${r[1]}]`)
        continue
      }
    }
    if (key === 'mode' && value !== 'legacy' && value !== 'v2') {
      errors.push(`estimator.mode: فقط "legacy" یا "v2"`)
      continue
    }
    patch[key] = value
  }
  return { ok: errors.length === 0, errors, patch }
}

/** برآیند «مؤثر» (پیش‌فرض‌ها + ذخیره‌شده + وصله) برای سنجش‌های ترکیبی */
function effectiveEstimator(stored, patch, defaults = loadDefaults()) {
  const s = isPlain(stored) ? stored : {}
  const out = { ...defaults.estimator, ...s, ...patch }
  for (const k of NESTED_KEYS) out[k] = { ...defaults[k], ...(isPlain(s[k]) ? s[k] : {}), ...(patch[k] || {}) }
  return out
}

/**
 * سنجش‌های ترکیبی که از تک‌تک کلیدها دیده نمی‌شوند:
 *  - آستانهٔ تجمعی لنگر τ = clamp(1/(1+ratio), 0.2, 0.8) × (anchorCumProb / 0.5) باید در (۰٫۰۵ ، ۰٫۹۵] باشد؛ وگرنه
 *    هیچ سطح قیمتی «لنگر» نمی‌شود و همهٔ پیشنهادها کنار گذاشته می‌شوند (بی‌داده).
 */
function validateEffective(eff) {
  const errors = []
  const ratio = Math.max(0.05, Number(eff.competitivenessCostRatio) || 1)
  const tau = Math.min(0.8, Math.max(0.2, 1 / (1 + ratio))) * (Number(eff.validity.anchorCumProb) / 0.5)
  if (!(tau > 0.05 && tau <= 0.95)) {
    errors.push(`آستانهٔ تجمعی لنگر τ=${tau.toFixed(3)} (از competitivenessCostRatio و validity.anchorCumProb) باید در (۰٫۰۵ ، ۰٫۹۵] باشد؛ در غیر این صورت لنگر انتخاب نمی‌شود`)
  }
  return { ok: errors.length === 0, errors, tau }
}

/** وصله را فقط روی زیرشاخهٔ estimator پروفایل ذخیره‌شده می‌نشاند؛ بقیهٔ config دست‌نخورده می‌ماند و پیش‌فرض‌ها «پین» نمی‌شوند */
function mergeEstimatorPatch(config, patch) {
  const base = isPlain(config) ? config : {}
  const stored = isPlain(base.estimator) ? base.estimator : {}
  const next = { ...stored }
  for (const [k, v] of Object.entries(patch)) {
    next[k] = NESTED_KEYS.includes(k) ? { ...(isPlain(stored[k]) ? stored[k] : {}), ...v } : v
  }
  return { ...base, estimator: next }
}

/** تفاوت برگ‌به‌برگ دو زیرشاخهٔ estimator (برای نمایش قبل از اعمال) — مقدار «قبلی» از ذخیره‌شده یا در نبودش از پیش‌فرض کد */
function diffEstimator(storedEstimator, patch, defaults = loadDefaults()) {
  const stored = isPlain(storedEstimator) ? storedEstimator : {}
  const rows = []
  const cur = (key, sub) => {
    const a = sub ? (isPlain(stored[key]) ? stored[key][sub] : undefined) : stored[key]
    if (a !== undefined) return { v: a, from: 'ذخیره‌شده' }
    const d = sub ? defaults[key][sub] : defaults.estimator[key]
    return { v: d, from: 'پیش‌فرض' }
  }
  for (const [k, v] of Object.entries(patch)) {
    if (NESTED_KEYS.includes(k)) {
      for (const [sub, sv] of Object.entries(v)) {
        const c = cur(k, sub)
        rows.push({ path: `estimator.${k}.${sub}`, before: c.v, beforeFrom: c.from, after: sv, changed: c.v !== sv })
      }
    } else {
      const c = cur(k)
      rows.push({ path: `estimator.${k}`, before: c.v, beforeFrom: c.from, after: v, changed: c.v !== v })
    }
  }
  return rows
}

module.exports = { PRESETS, RANGES, NESTED_RANGES, loadDefaults, validateEstimatorPatch, effectiveEstimator, validateEffective, mergeEstimatorPatch, diffEstimator }
