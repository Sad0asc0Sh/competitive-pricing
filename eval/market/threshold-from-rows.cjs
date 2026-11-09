#!/usr/bin/env node
'use strict'
/**
 * انتخاب آستانهٔ `estimator.minCalibratedConfidence` از روی «ممیزی واقعی» (۴.۲.۰)
 *
 *   node eval/market/threshold-from-rows.cjs --data calibration-rows.json [--model model.json]
 *        [--target-error 0.03] [--min-n 30] [--test-frac 0.3] [--include-review] [--write threshold.json]
 *
 * چرا این ابزار؟  eval/market/risk.cjs منحنی ریسک–پوشش را فقط روی «شبیه‌ساز» می‌سازد. اینجا همان کار با «برچسب‌های واقعی»
 * انجام می‌شود: برای هر آستانه t، از میان قیمت‌هایی که اعتماد کالیبره‌شان ≥ t است، چند درصد واقعاً درست نبوده‌اند؟
 *
 * اصول (برای اینکه عدد قابل‌اعتماد بماند):
 *  - به‌طور پیش‌فرض فقط ردیف‌های «ممیزی تصادفی» به‌کار می‌روند. ردیف‌های «بازبینی انسانی» سوگیردارند (فقط تصمیم‌های کم‌اعتماد
 *    به صف می‌روند و بازبین ممکن است بی‌دقت تأیید کند) و ناحیهٔ بالای اعتماد را اصلاً نمی‌بینند؛ فقط با --include-review (و هشدار).
 *  - انتخاب آستانه و راستی‌آزمایی روی دو بخش جدا (زمانیِ قدیمی‌تر/جدیدتر) است؛ انتخاب و گزارش روی یک نمونه خوش‌بینانه است.
 *  - معیار انتخاب «کران بالای بازهٔ اطمینان ویلسون ۹۵٪ برای نرخ خطا ≤ هدف» است، نه نرخ نقطه‌ای؛ با نمونهٔ کم کران بالا بزرگ
 *    می‌شود و ابزار آستانه‌ای پیشنهاد نمی‌کند (به‌جای اینکه با چند نمونهٔ خوش‌شانس آستانه را پایین بیاورد).
 *  - دروازه‌های دیگر (هویت، ناظر، کف سود) در این برآورد نیستند؛ آن‌ها معمولاً فقط موارد پرخطرتر را بیشتر به بازبینی می‌برند،
 *    پس خطای واقعیِ خودکارها معمولاً کمتر از این برآورد است — ولی تضمین ریاضی نیست.
 *  - فقط خطای «قیمت نادرست» را می‌سنجد (برچسب = |قیمت ما − قیمت درستِ ممیز| ≤ ۲٪)؛ هزینهٔ «ارزان‌تر از لازم» در برابر «غیررقابتی»
 *    را نمی‌سنجد (آن را دستگیرهٔ competitivenessCostRatio تنظیم می‌کند).
 *
 * خروجی --write: { estimator: { minCalibratedConfidence }, meta } — قابل‌دادن مستقیم به scripts/apply-estimator-config.cjs.
 * کد خروج: ۳ = داده کافی نیست؛ ۴ = هیچ آستانه‌ای هدف را با اطمینان برآورده نکرد (یا آزمون تأیید نکرد) و فایلی نوشته نشد.
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const flag = (name) => process.argv.includes('--' + name)

/** بازهٔ اطمینان ویلسون برای نسبت k/n (z=1.96 ⇒ ۹۵٪)؛ n=0 ⇒ بازهٔ کاملاً نامعلوم [0,1] */
function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return { p: null, lo: 0, hi: 1 }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

let _conf = null
/** تابع اعتماد کالیبره دقیقاً همان است که موتور به‌کار می‌برد (منبع حقیقتِ واحد) */
function loadCalibrated() {
  if (_conf) return _conf
  const { loadTsModule } = require(path.join(ROOT, 'tests', 'helpers', 'ts-loader.cjs'))
  _conf = loadTsModule('src/lib/pricing/robustness.ts').calibratedConfidence
  return _conf
}

const isRow = (r) => r && Number.isFinite(r.pRight) && (r.label === 0 || r.label === 1)

/** هر ردیف را با اعتماد کالیبره‌ٔ «مدل داده‌شده» امتیاز می‌دهد (مدل تهی/undefined ⇒ پیش‌فرض: هویت روی pRight) */
function scoreRows(rows, model, conf = loadCalibrated()) {
  return rows.filter(isRow).map((r) => ({
    ...r,
    score: conf(model, { pRight: r.pRight, heuristic: r.heuristic == null ? 0 : r.heuristic, pNoneValid: r.pNone == null ? 0 : r.pNone, floorBound: Boolean(r.floorBound) }),
  }))
}

/** برای هر آستانه: پوشش، خطای نقطه‌ای و کران بالای ویلسون (خطا = برچسب ۰ = قیمت ما نادرست بود) */
function riskCoverage(scored, thresholds) {
  return thresholds.map((t) => {
    const above = scored.filter((r) => r.score >= t)
    const errors = above.filter((r) => r.label === 0).length
    const w = wilson(errors, above.length)
    return { t, n: above.length, coverage: scored.length ? above.length / scored.length : 0, errors, errRate: w.p, lo: w.lo, hi: w.hi }
  })
}

/** کم‌ترین آستانه‌ای که n ≥ minN و کران بالای ویلسونش ≤ target است؛ وگرنه null و «بهترین تلاش» (کمترین کران بالا با n ≥ minN) */
function recommend(scored, { target = 0.03, minN = 30, grid = defaultGrid() } = {}) {
  const table = riskCoverage(scored, grid)
  const ok = table.find((r) => r.n >= minN && r.hi <= target)
  if (ok) return { threshold: ok.t, row: ok, table, met: true }
  const eligible = table.filter((r) => r.n >= minN)
  const best = eligible.length ? eligible.reduce((a, b) => (b.hi < a.hi ? b : a)) : null
  return { threshold: null, row: null, best, table, met: false }
}

function defaultGrid() {
  const g = []
  for (let t = 50; t <= 99; t++) g.push(t / 100)
  return g
}

/** تقسیم زمانی: قدیمی‌ترها آموزش (انتخاب آستانه)، جدیدترها آزمون (راستی‌آزمایی)؛ بدون createdAt به ترتیب ردیف */
function splitTemporal(rows, testFrac = 0.3) {
  const sorted = rows.every((r) => r.createdAt) ? [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) : rows
  const cut = Math.max(1, Math.floor(sorted.length * (1 - testFrac)))
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) }
}

/** حکم راستی‌آزمایی روی آزمون: «تأیید» اگر خطای نقطه‌ای ≤ هدف؛ «نقض» اگر کران پایین ویلسون > هدف؛ وگرنه «نامعلوم» */
function verify(testScored, threshold, target, minTestN = 10) {
  const [row] = riskCoverage(testScored, [threshold])
  let verdict = 'unknown'
  if (row.n >= minTestN) {
    if (row.lo > target) verdict = 'violated'
    else if (row.errRate <= target) verdict = 'confirmed'
  }
  return { ...row, verdict }
}

const pct = (x, d = 1) => (x == null ? '—' : (x * 100).toFixed(d) + '٪')

function readModel(file) {
  if (!file) return { model: undefined, from: 'پیش‌فرض (هویت روی pRight)' }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const m = (j && j.estimator && j.estimator.confidenceModel) || (j && j.confidenceModel) || null
  if (!m || typeof m !== 'object') throw new Error(`در ${file} کلید estimator.confidenceModel پیدا نشد`)
  return { model: m, from: path.basename(file) }
}

function main() {
  const dataFile = arg('data', null)
  if (!dataFile) throw new Error('--data calibration-rows.json لازم است (خروجی scripts/export-calibration-data.cjs)')
  const target = Number(arg('target-error', 0.03))
  const minN = Number(arg('min-n', 30))
  const testFrac = Number(arg('test-frac', 0.3))
  const minRows = Number(arg('min-rows', 100))
  if (!(target > 0 && target < 1)) throw new Error('--target-error باید بین ۰ و ۱ باشد (مثلاً 0.03)')
  if (!(testFrac > 0 && testFrac < 1)) throw new Error('--test-frac باید بین ۰ و ۱ باشد')

  const payload = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  const all = (Array.isArray(payload) ? payload : payload.rows || []).filter(isRow)
  const includeReview = flag('include-review')
  const pop = all.filter((r) => includeReview || r.labelSource !== 'review')
  const nReview = all.filter((r) => r.labelSource === 'review').length
  const { model, from } = readModel(arg('model', null))

  console.log(`ردیف‌ها: ${all.length} | به‌کار رفته: ${pop.length}${includeReview ? ' (شامل برچسب‌های بازبینی — سوگیردار!)' : ` (برچسب‌های بازبینی: ${nReview} کنار گذاشته شد)`}`)
  console.log(`مدل اعتماد: ${from} | هدف: خطا ≤ ${pct(target)} (کران بالای ویلسون ۹۵٪) | حداقل نمونه در هر آستانه: ${minN}`)
  if (includeReview) console.warn('هشدار: برچسب‌های بازبینی فقط تصمیم‌های کم‌اعتماد را دیده‌اند؛ نتیجه برای آستانه‌های بالا خوش‌بینانه است.')
  if (pop.length < minRows) {
    console.error(`داده کافی نیست: ${pop.length} ردیف (حداقل ${minRows}). ممیزی تصادفی را ادامه دهید؛ آستانه را تغییر ندهید.`)
    process.exit(3)
  }

  const { train, test } = splitTemporal(pop, testFrac)
  const trainS = scoreRows(train, model)
  const testS = scoreRows(test, model)
  const allS = scoreRows(pop, model)

  console.log(`\nتقسیم زمانی: آموزش (قدیمی‌تر)=${trainS.length} | آزمون (جدیدتر)=${testS.length}`)
  console.log('\nمنحنی ریسک–پوشش روی کل نمونه (توصیفی):')
  console.log('  آستانه   پوشش    n   خطا   نرخ خطا   کران بالای ویلسون')
  for (const r of riskCoverage(allS, [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99])) {
    console.log(`  ${r.t.toFixed(2)}   ${pct(r.coverage).padStart(6)}  ${String(r.n).padStart(4)}  ${String(r.errors).padStart(4)}   ${pct(r.errRate).padStart(7)}   ${pct(r.hi).padStart(7)}`)
  }

  const rec = recommend(trainS, { target, minN })
  let exitCode = 0
  let outThreshold = null
  if (!rec.met) {
    console.log(`\nنتیجه: روی دادهٔ آموزش هیچ آستانه‌ای با n≥${minN} کران بالای ویلسونِ ≤ ${pct(target)} ندارد.`)
    if (rec.best) console.log(`  نزدیک‌ترین: آستانه ${rec.best.t.toFixed(2)} با کران بالا ${pct(rec.best.hi)} (n=${rec.best.n}، خطا=${rec.best.errors}). نمونهٔ ممیزی را بزرگ‌تر کنید یا هدف را (آگاهانه) سست‌تر بگیرید.`)
    else console.log('  حتی در بالاترین آستانه‌ها نمونهٔ کافی نیست.')
    exitCode = 4
  } else {
    const r = rec.row
    console.log(`\nپیشنهاد (از روی آموزش): minCalibratedConfidence = ${rec.threshold.toFixed(2)}  (پوشش ${pct(r.coverage)}، خطا ${pct(r.errRate)}، کران بالا ${pct(r.hi)}، n=${r.n})`)
    if (testS.length < 20) {
      console.log('راستی‌آزمایی: دادهٔ آزمون کمتر از ۲۰ ردیف است؛ راستی‌آزمایی بی‌طرف ممکن نیست.')
      exitCode = 4
    } else {
      const v = verify(testS, rec.threshold, target)
      const label = { confirmed: 'تأیید شد', violated: 'نقض شد', unknown: 'نامعلوم (نمونهٔ آزمون در این آستانه کم است)' }[v.verdict]
      console.log(`راستی‌آزمایی روی آزمون: n=${v.n} خطا=${v.errors} نرخ=${pct(v.errRate)} (بازه ${pct(v.lo)}–${pct(v.hi)}) ⇒ ${label}`)
      if (v.verdict === 'confirmed') outThreshold = rec.threshold
      else exitCode = 4
    }
  }

  const out = arg('write', null)
  if (out && outThreshold != null) {
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          estimator: { minCalibratedConfidence: outThreshold },
          meta: { source: path.basename(dataFile), model: from, targetError: target, minN, rowsUsed: pop.length, includeReview, createdAt: new Date().toISOString() },
        },
        null,
        2,
      ),
    )
    console.log(`\nنوشته شد: ${out}  →  node scripts/apply-estimator-config.cjs --file ${out} --default   (dry-run؛ برای اعمال --apply)`)
  } else if (out) {
    console.log('\nفایل نوشته نشد (آستانه‌ای با اطمینان کافی تأیید نشد). آستانهٔ فعلی را نگه دارید.')
  }
  process.exit(exitCode)
}

module.exports = { wilson, scoreRows, riskCoverage, recommend, splitTemporal, verify, defaultGrid }

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(e && e.message ? e.message : e)
    process.exit(1)
  }
}
