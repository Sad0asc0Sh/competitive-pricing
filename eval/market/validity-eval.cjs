'use strict'
/**
 * سنجش کالیبراسیون و تفکیک‌پذیری مدل اعتبار پیشنهاد (validity.ts) روی دنیاهای شبیه‌سازی‌شده.
 *   node eval/market/validity-eval.cjs [--root DIR] [--n 600] [--seed 11] [--scenario mix] [--set key=val,...]
 * برچسب هر پیشنهاد = «قابل‌خرید با همان قیمت» (truth.offerLabels[].valid).
 */
const path = require('path')
const { makeRng, hashStr } = require('../lib/rng.cjs')
const { simulateWorld, withParams, NOW } = require('./simulate.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
const { loadTsModule } = require(path.join(root, 'tests/helpers/ts-loader.cjs'))
const V = loadTsModule('src/lib/pricing/validity.ts')
const F = loadTsModule('src/lib/pricing/filters.ts')
const T = loadTsModule('src/lib/pricing/types.ts')
const { SCENARIOS } = require('./run.cjs')

function auc(pos, neg) {
  if (!pos.length || !neg.length) return null
  const all = [...pos.map((x) => [x, 1]), ...neg.map((x) => [x, 0])].sort((a, b) => a[0] - b[0])
  let rank = 0
  let sumPos = 0
  for (let i = 0; i < all.length; ) {
    let j = i
    while (j < all.length && all[j][0] === all[i][0]) j++
    const avg = (i + j + 1) / 2
    for (let k = i; k < j; k++) if (all[k][1] === 1) sumPos += avg
    i = j
  }
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length)
}

function run({ n, seed, scenario, params }) {
  const P = withParams(SCENARIOS[scenario] || {})
  const rows = []
  for (let i = 0; i < n; i++) {
    const rng = makeRng(hashStr(`${seed}:${scenario}:${i}`))
    const w = simulateWorld(rng, P)
    const cfg = JSON.parse(JSON.stringify(T.DEFAULT_PROFILE_CONFIG))
    const offers = F.applyValidityFilters(w.offers, cfg.filters, NOW, cfg.rank1, { softStaleness: true, hardMaxAgeDays: 90 })
    const labels = new Map(w.truth.offerLabels.map((l) => [l.shopName, l]))
    const rep = V.assessValidity(offers, NOW, { params, freshCutoffDays: cfg.outliers.freshCutoffDays, highTrustScoreThreshold: 4.5 })
    for (const [o, v] of rep.perOffer) {
      const l = labels.get(o.shopName)
      if (!l) continue
      rows.push({ p: v.p, valid: l.valid ? 1 : 0, kind: l.kind, depth: v.depth, age: v.ageDays, drift: rep.driftPerDay, trueDriftMu: w.mu })
    }
  }
  return rows
}

function report(rows, title) {
  const pos = rows.filter((r) => r.valid).map((r) => r.p)
  const neg = rows.filter((r) => !r.valid).map((r) => r.p)
  const bins = Array.from({ length: 10 }, () => ({ n: 0, v: 0, sp: 0 }))
  for (const r of rows) {
    const b = Math.min(9, Math.floor(r.p * 10))
    bins[b].n++
    bins[b].v += r.valid
    bins[b].sp += r.p
  }
  let ece = 0
  for (const b of bins) if (b.n) ece += (b.n / rows.length) * Math.abs(b.v / b.n - b.sp / b.n)
  const brier = rows.reduce((s, r) => s + (r.p - r.valid) ** 2, 0) / rows.length
  console.log(`\n== ${title}: n=${rows.length} valid=${(pos.length / rows.length * 100).toFixed(1)}% | AUC=${auc(pos, neg).toFixed(3)} | ECE=${ece.toFixed(3)} | Brier=${brier.toFixed(3)}`)
  console.log('  bin    n     predicted  observed')
  bins.forEach((b, i) => b.n && console.log(`  ${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)} ${String(b.n).padStart(6)}   ${(b.sp / b.n).toFixed(3)}     ${(b.v / b.n).toFixed(3)}`))
}

if (require.main === module) {
  const n = Number(arg('n', 600))
  const seed = Number(arg('seed', 11))
  const scenario = arg('scenario', 'mix')
  const params = {}
  const setArg = arg('set', '')
  if (setArg) for (const kv of setArg.split(',')) { const [k, v] = kv.split('='); params[k] = Number(v) }
  const rows = run({ n, seed, scenario, params })
  report(rows, `${scenario} همهٔ پیشنهادها`)
  report(rows.filter((r) => r.depth > 0.06), `${scenario} پیشنهادهای ارزان‌تر از بدنه (>۶٪)`)
  report(rows.filter((r) => r.age != null && r.age > 7), `${scenario} پیشنهادهای کهنه (>۷ روز)`)
  report(rows.filter((r) => r.age != null && r.age > 7 && r.depth > 0.02), `${scenario} کهنه و ارزان‌تر`)
  const byKind = {}
  for (const r of rows) (byKind[r.kind] ||= []).push(r)
  for (const [k, xs] of Object.entries(byKind)) console.log(`  kind=${k.padEnd(10)} n=${String(xs.length).padStart(6)} mean p=${(xs.reduce((s, r) => s + r.p, 0) / xs.length).toFixed(3)} valid=${(xs.reduce((s, r) => s + r.valid, 0) / xs.length).toFixed(3)}`)
  // کیفیت تخمین رانش
  const dr = rows.filter((r) => Number.isFinite(r.drift) && Number.isFinite(r.trueDriftMu))
  if (dr.length) {
    const byWorld = new Map()
    for (const r of dr) byWorld.set(`${r.drift}|${r.trueDriftMu}`, r)
    const xs = [...byWorld.values()]
    const num = xs.reduce((s, r) => s + r.drift * r.trueDriftMu, 0)
    const den = Math.sqrt(xs.reduce((s, r) => s + r.drift ** 2, 0) * xs.reduce((s, r) => s + r.trueDriftMu ** 2, 0))
    console.log(`\n  همبستگی رانش تخمینی با رانش واقعیِ شبیه‌ساز: ${(num / den).toFixed(3)} (n=${xs.length})`)
  }
}

module.exports = { run, report, auc }
