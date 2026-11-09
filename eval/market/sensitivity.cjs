'use strict'
/**
 * تحلیل حساسیت: اگر «باورهای پیشین» مدل اعتبار/اعتماد (که با دادهٔ واقعی برازش نشده‌اند) غلط باشند چه می‌شود؟
 * هر پارامتر کلیدی یک‌به‌یک به پایین/بالا (تقریباً ×۰٫۵ و ×۲) جابه‌جا می‌شود و موتور روی همان دنیاهای ثابت اجرا می‌شود.
 * هدف «بهینه‌سازی» نیست؛ هدف نشان دادن این است که برتری نسبت به baseline به تنظیم دقیق ضرایب وابسته نیست.
 *
 *   node eval/market/sensitivity.cjs [--seeds 9005,9006] [--n 300] [--scenarios mix,stress_all] [--ref C] [--root DIR] [--out FILE]
 */
const fs = require('fs')
const path = require('path')
const R = require('./run.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
const seeds = arg('seeds', '9005,9006').split(',').map(Number)
const n = Number(arg('n', 300))
const names = arg('scenarios', 'mix,stress_all').split(',')
const refKey = 'o' + arg('ref', 'C')
const outFile = arg('out', path.join(__dirname, '..', 'results', 'sensitivity.json'))

const V = (patch) => (cfg) => { cfg.estimator.validity = { ...(cfg.estimator.validity || {}), ...patch } }
const E = (patch) => (cfg) => Object.assign(cfg.estimator, patch)

const GRID = [
  ['پیش‌فرض (v2)', () => {}],
  ['baseLogit ۱٫۶ (کهنگی محتمل‌تر)', V({ baseLogit: 1.6 })],
  ['baseLogit ۳٫۶ (کهنگی کم‌احتمال‌تر)', V({ baseLogit: 3.6 })],
  ['ageCoef ×۰٫۵', V({ ageCoef: 0.175 })],
  ['ageCoef ×۲', V({ ageCoef: 0.7 })],
  ['legitFractionPrior ۰٫۲۵', V({ legitFractionPrior: 0.25 })],
  ['legitFractionPrior ۰٫۶۵', V({ legitFractionPrior: 0.65 })],
  ['contaminationRate ×۰٫۵', V({ contaminationRate: 0.02 })],
  ['contaminationRate ×۲', V({ contaminationRate: 0.08 })],
  ['corrKappa ×۰٫۵', V({ corrKappa: 1.1 })],
  ['corrKappa ×۲', V({ corrKappa: 4.4 })],
  ['repHonorCoef ۰ (بدون اثر شهرت)', V({ repHonorCoef: 0 })],
  ['repHonorCoef ×۲', V({ repHonorCoef: 0.6 })],
  ['driftGapCoef ×۰٫۵', V({ driftGapCoef: 9 })],
  ['driftGapCoef ×۲', V({ driftGapCoef: 36 })],
  ['anchorCumProb ۰٫۳۵', V({ anchorCumProb: 0.35 })],
  ['anchorCumProb ۰٫۶۵', V({ anchorCumProb: 0.65 })],
  ['sigmaPrior ۰٫۰۱۵', V({ sigmaPrior: 0.015 })],
  ['sigmaPrior ۰٫۰۴', V({ sigmaPrior: 0.04 })],
  ['minCalibratedConfidence ۰٫۸', E({ minCalibratedConfidence: 0.8 })],
  ['minCalibratedConfidence ۰٫۹۵', E({ minCalibratedConfidence: 0.95 })],
  ['competitivenessCostRatio ۰٫۵', E({ competitivenessCostRatio: 0.5 })],
  ['competitivenessCostRatio ۲', E({ competitivenessCostRatio: 2 })],
]

const pc = (x, d = 1) => (x == null ? ' n/a ' : (x * 100).toFixed(d) + '%')
const results = {}
const eng = R.loadEngine(root)
const base = root === baseRoot ? eng : R.loadEngine(baseRoot)

for (const sc of names) {
  const worlds = seeds.flatMap((s) => R.buildWorlds(s, sc, n))
  const rows = []
  const baseAgg = R.aggregate(R.evalEngine(base, base, worlds, {}), refKey)
  console.log(`\n=== ${sc} (n=${worlds.length}, ref=${refKey})`)
  const head = ['پیکربندی', 'errAuto', 'within2', 'p90APE', 'rankHit', 'auto', 'giveaway>2', 'uncomp>2', 'AUC']
  console.log(head.map((h, i) => h.padEnd(i === 0 ? 38 : 11)).join(' '))
  const line = (name, a) =>
    [name, pc(a.silentGivenAuto), pc(a.within2), pc(a.p90APE, 2), pc(a.rankHit), pc(a.autoRate), pc(a.giveaway2), pc(a.uncompetitive2), a.confAUC == null ? 'n/a' : a.confAUC.toFixed(3)]
      .map((x, i) => String(x).padEnd(i === 0 ? 38 : 11))
      .join(' ')
  console.log(line('baseline 4.1.2', baseAgg))
  rows.push({ name: 'baseline', agg: baseAgg })
  for (const [name, f] of GRID) {
    const a = R.aggregate(R.evalEngine(eng, base, worlds, { cfgOverride: f }), refKey)
    console.log(line(name, a))
    rows.push({ name, agg: a })
  }
  results[sc] = rows
}
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify({ meta: { seeds, nPerSeed: n, ref: refKey }, results }, null, 2))
console.log(`\nذخیره شد: ${path.relative(process.cwd(), outFile)}`)
