'use strict'
/**
 * سنجش «لیستینگ اشتباه» سرتاسری (تطبیق + موتور): ترب کارتِ محصولِ دیگری (خواهرِ مدل) را برای محصول ما برمی‌گرداند.
 * در این دنیاها «هر اعمال خودکار» یک خطای واقعی است (قیمتِ محصول دیگر روی کالای ما می‌نشیند).
 *   node eval/market/wrong.cjs [--seeds 9001,9002,9003] [--n 300] [--root DIR] [--baseline DIR] [--out FILE]
 *   wronglisting : فروشگاه ما در لیستینگ اشتباه نیست  |  wrongself : ترب فروشگاه ما را هم در آن ادغام کرده (سخت‌ترین حالت)
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
const seeds = arg('seeds', '9001,9002,9003').split(',').map(Number)
const n = Number(arg('n', 300))
const out = arg('out', path.join(__dirname, '..', 'results', 'wrong_listing_heldout.json'))

const eng = R.loadEngine(root)
const base = R.loadEngine(baseRoot)
const res = {}
const wilson = (k, N) => {
  if (!N) return [null, null]
  const z = 1.96
  const p = k / N
  const d = 1 + (z * z) / N
  const c = p + (z * z) / (2 * N)
  const a = z * Math.sqrt((p * (1 - p)) / N + (z * z) / (4 * N * N))
  return [Math.max(0, (c - a) / d), Math.min(1, (c + a) / d)]
}
for (const sc of ['wronglisting', 'wrongself']) {
  const rowsB = []
  const rowsV = []
  for (const seed of seeds) {
    const worlds = R.buildWorlds(seed, sc, n)
    rowsB.push(...R.evalEngine(base, base, worlds, {}))
    rowsV.push(...R.evalEngine(eng, base, worlds, {}))
  }
  const stat = (rows) => {
    const priced = rows.filter((r) => r.final != null)
    const auto = priced.filter((r) => !r.review)
    const rejected = rows.filter((r) => r.rejectedBySup || r.final == null)
    return { n: rows.length, priced: priced.length, autoApplied: auto.length, autoRate: auto.length / rows.length, autoRateCI95: wilson(auto.length, rows.length), sentToReviewOrRejected: rows.length - auto.length }
  }
  res[sc] = { baseline: stat(rowsB), v2: stat(rowsV) }
  const f = (x) => (x * 100).toFixed(1) + '%'
  const ci = (c) => `[${f(c[0])}, ${f(c[1])}]`
  console.log(`\n=== ${sc}  (n=${rowsB.length}) — هر اعمال خودکار = خطا`)
  console.log(`baseline 4.1.2 : اعمال خودکارِ اشتباه ${res[sc].baseline.autoApplied}/${rowsB.length} = ${f(res[sc].baseline.autoRate)}  Wilson95%=${ci(res[sc].baseline.autoRateCI95)}`)
  console.log(`v2 (۴.۲.۰)     : اعمال خودکارِ اشتباه ${res[sc].v2.autoApplied}/${rowsV.length} = ${f(res[sc].v2.autoRate)}  Wilson95%=${ci(res[sc].v2.autoRateCI95)}`)
}
fs.writeFileSync(out, JSON.stringify({ meta: { seeds, nPerSeed: n }, ...res }, null, 2))
console.log(`\nذخیره شد: ${path.relative(process.cwd(), out)}`)
