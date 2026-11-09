'use strict'
/**
 * ارزیابی نهایی «قبل/بعد» روی بذرهای کاملاً تازه (held-out) با فاصلهٔ اطمینان خودگردان‌سازی جفتی.
 *
 *   node eval/market/final.cjs [--seeds 9001,9002,9003] [--n 300] [--scenarios mix,clean,...]
 *                              [--ref C|S] [--boot 1000] [--out eval/results/final_heldout.json] [--root DIR] [--baseline DIR]
 *
 * اصول (برای اینکه عدد قابل‌اعتماد باشد):
 *  - بذرها هیچ‌گاه برای تنظیم پارامتر/آستانه استفاده نشده‌اند (تنظیم‌ها روی ۷ و ۱۰۱..۱۰۳ بوده است).
 *  - هر دنیا برای هر دو موتور «دقیقاً یکسان» است ⇒ آمار جفتی؛ بازه‌های اطمینان با نمونه‌گیری مجدد دنیاها (نه ردیف‌های مستقل).
 *  - مرجع پیش‌فرض oracleC (بهترین رتبهٔ شدنی با بیشترین حاشیه؛ مستقل از سیاست و موتور). oracleS (فقط خطای تخمین) هم گزارش می‌شود.
 *  - «خطا در میان خودکارها» (errAuto) به‌تنهایی گمراه‌کننده است (موتوری که کم‌تر خودکار می‌شود ظاهراً دقیق‌تر است)؛ پس خطا
 *    «در پوشش برابر» هم گزارش می‌شود: آستانهٔ اعتمادِ v2 طوری بالا می‌رود که نرخ خودکارش از baseline کمتر نشود.
 *  - سناریوهای فشار عمداً با مفروضات مدل ناهمخوان‌اند؛ نتایج بد هم گزارش می‌شود (بدون حذف).
 */
const fs = require('fs')
const path = require('path')
const R = require('./run.cjs')
const { makeRng } = require('../lib/rng.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
const seeds = arg('seeds', '9001,9002,9003').split(',').map(Number)
const n = Number(arg('n', 300))
const names = arg('scenarios', 'mix,clean,bait,variant,legit,volatile,thin,big,wide,stress_ghost,stress_noghost,stress_norep,stress_all').split(',')
const refLetter = arg('ref', 'C')
const refKey = 'o' + refLetter
const BOOT = Number(arg('boot', 1000))
const outFile = arg('out', path.join(__dirname, '..', 'results', 'final_heldout.json'))

// ---- ابزارهای آماری
// بوت‌استرپ با همان مولد Mulberry32 بقیهٔ ارزیابی (مولد LCG ساده چرخهٔ کوتاه/ساختار بیت‌های پایین دارد)
function bootRng(seed) {
  return makeRng(seed).next
}
function ci(xs) {
  const s = [...xs].filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return [null, null]
  return [s[Math.floor(0.025 * (s.length - 1))], s[Math.ceil(0.975 * (s.length - 1))]]
}

const METRICS = [
  ['errAuto', 'silentGivenAuto', 'خطای >۲٪ در میان خودکارها'],
  ['within2', 'within2', 'درصد در ±۲٪ مرجع'],
  ['p90APE', 'p90APE', 'صدک ۹۰ خطای مطلق'],
  ['autoRate', 'autoRate', 'نرخ اعمال خودکار'],
  ['giveaway2', 'giveaway2', 'ارزان‌تر از لازم >۲٪'],
  ['uncomp2', 'uncompetitive2', 'گران‌تر از لازم >۲٪'],
  ['rankHit', 'rankHit', 'رتبهٔ بهینه (بدون افت رتبه)'],
  ['silentErr', 'silentErr', 'خطای بی‌صدا (سهم از کل)'],
  ['mdAPE', 'mdAPE', 'میانهٔ خطای مطلق'],
  ['meanAPE', 'meanAPE', 'میانگین خطای مطلق'],
  ['meanOver', 'meanOver', 'میانگین گران‌تر از لازم'],
  ['meanUnder', 'meanUnder', 'میانگین ارزان‌تر از لازم (حاشیهٔ از دست رفته)'],
]

function metricVec(rows, key) {
  const a = R.aggregate(rows, key)
  const out = {}
  for (const [name, field] of METRICS) out[name] = a[field]
  out.confAUC = a.confAUC
  out.coverage = a.coverage
  return out
}

/** خطای >۲٪ در میان خودکارها وقتی آستانهٔ اعتماد را تا رسیدن به «پوشش برابر با baseline» بالا ببریم */
function matchedCoverage(rowsV2, key, targetAuto) {
  const prod = rowsV2.filter((r) => r.final != null && r[key] != null)
  if (!prod.length) return null
  let best = null
  for (let t = 0; t <= 0.995; t += 0.005) {
    const auto = prod.filter((r) => !r.reviewNoConf && (r.conf == null || r.conf >= t))
    const autoRate = auto.length / prod.length
    if (autoRate + 1e-9 < targetAuto) break
    const bad = auto.filter((r) => Math.abs((r.final - r[key]) / r[key]) > 0.02)
    best = { threshold: t, autoRate, errAuto: auto.length ? bad.length / auto.length : null }
  }
  return best
}

function pairedBootstrap(rowsB, rowsV, key, seed) {
  const rand = bootRng(seed)
  const N = rowsB.length
  const deltas = Object.fromEntries(METRICS.map(([m]) => [m, []]))
  for (let b = 0; b < BOOT; b++) {
    const idx = Array.from({ length: N }, () => Math.floor(rand() * N))
    const mb = metricVec(idx.map((i) => rowsB[i]), key)
    const mv = metricVec(idx.map((i) => rowsV[i]), key)
    for (const [m] of METRICS) deltas[m].push(mv[m] == null || mb[m] == null ? null : mv[m] - mb[m])
  }
  return Object.fromEntries(METRICS.map(([m]) => [m, ci(deltas[m])]))
}

const fmt = (x, d = 1) => (x == null ? ' n/a ' : (x * 100).toFixed(d) + '%')
const fmtCI = (c) => (c[0] == null ? '[n/a]' : `[${(c[0] * 100).toFixed(1)}, ${(c[1] * 100).toFixed(1)}]`)

function main() {
  const eng = R.loadEngine(root)
  const base = root === baseRoot ? eng : R.loadEngine(baseRoot)
  const result = { meta: { seeds, nPerSeed: n, ref: refLetter, boot: BOOT, createdBy: 'eval/market/final.cjs' }, scenarios: {} }
  const t0 = Date.now()
  for (const sc of names) {
    const rowsB = []
    const rowsV = []
    for (const seed of seeds) {
      const worlds = R.buildWorlds(seed, sc, n)
      rowsB.push(...R.evalEngine(base, base, worlds, {}))
      rowsV.push(...R.evalEngine(eng, base, worlds, {}))
    }
    const out = { n: rowsB.length, perOracle: {} }
    for (const [lab, key] of [[refLetter, refKey], ...(refLetter === 'S' ? [] : [['S', 'oS']])]) {
      const mB = metricVec(rowsB, key)
      const mV = metricVec(rowsV, key)
      const deltaCI = pairedBootstrap(rowsB, rowsV, key, 12345 + lab.charCodeAt(0))
      const matched = matchedCoverage(rowsV, key, mB.autoRate ?? 0)
      out.perOracle[lab] = { baseline: mB, v2: mV, deltaCI, v2MatchedCoverage: matched, floorViolations: { baseline: R.aggregate(rowsB, key).floorViolations, v2: R.aggregate(rowsV, key).floorViolations } }
    }
    result.scenarios[sc] = out
    const p = out.perOracle[refLetter]
    console.log(`\n=== ${sc}  (n=${out.n}, ref=oracle${refLetter})  [${((Date.now() - t0) / 1000).toFixed(0)}s]`)
    console.log('metric'.padEnd(30), 'baseline'.padEnd(10), 'v2'.padEnd(10), 'Δ(v2−base) 95%CI (pp)')
    for (const [m, , label] of METRICS) {
      console.log(label.padEnd(30), fmt(p.baseline[m]).padEnd(10), fmt(p.v2[m]).padEnd(10), fmtCI(p.deltaCI[m]))
    }
    console.log('AUC اعتماد'.padEnd(30), (p.baseline.confAUC ?? NaN).toFixed(3).padEnd(10), (p.v2.confAUC ?? NaN).toFixed(3))
    if (p.v2MatchedCoverage) console.log(`v2 در پوشش برابر با baseline (آستانه ${p.v2MatchedCoverage.threshold.toFixed(3)}): auto=${fmt(p.v2MatchedCoverage.autoRate)} errAuto=${fmt(p.v2MatchedCoverage.errAuto)}`)
    console.log(`نقض کف: baseline=${p.floorViolations.baseline} v2=${p.floorViolations.v2}`)
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log(`\nنتیجه ذخیره شد: ${path.relative(process.cwd(), outFile)}`)
}

if (require.main === module) main()
module.exports = { metricVec, matchedCoverage, pairedBootstrap }
