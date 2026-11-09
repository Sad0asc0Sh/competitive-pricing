'use strict'
/**
 * منحنی ریسک–پوشش: با بالا بردن آستانهٔ اعتماد، چه کسری از قیمت‌ها خودکار اعمال می‌شود و خطای همان‌ها چقدر است؟
 *   node eval/market/risk.cjs [--root DIR] [--n 500] [--seed 7] [--scenarios mix,...] [--ref C|S|B|A]
 * «خطای بی‌صدا» = اعمال خودکار + |خطا| > ۲٪ نسبت به اوراکل مرجع (پیش‌فرض C: بهترین رتبهٔ شدنی با بیشترین حاشیه)
 */
const path = require('path')
const R = require('./run.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

function curve(rows, refKey, thresholds) {
  const prod = rows.filter((r) => r.final != null && r[refKey] != null)
  const out = []
  for (const t of thresholds) {
    const auto = prod.filter((r) => !r.reviewNoConf && (r.conf == null || r.conf >= t))
    const bad = auto.filter((r) => Math.abs((r.final - r[refKey]) / r[refKey]) > 0.02)
    out.push({ t, autoRate: auto.length / Math.max(1, prod.length), silent: bad.length / Math.max(1, prod.length), errAmongAuto: bad.length / Math.max(1, auto.length) })
  }
  return out
}

module.exports = { curve }

if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
  const n = Number(arg('n', 500))
  const seed = Number(arg('seed', 7))
  const names = arg('scenarios', 'mix').split(',')
  const ref = 'o' + arg('ref', 'C')
  const eng = R.loadEngine(root)
  const base = R.loadEngine(baseRoot)
  const ths = [0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
  for (const sc of names) {
    const worlds = R.buildWorlds(seed, sc, n)
    const rowsV2 = R.evalEngine(eng, base, worlds, {})
    const rowsBase = R.evalEngine(base, base, worlds, {})
    console.log(`\n=== ${sc} (n=${n}, seed=${seed}, مرجع=${ref}) ===`)
    const b = curve(rowsBase, ref, [0])[0]
    console.log(`baseline 4.1.2 : auto=${(b.autoRate * 100).toFixed(1)}%  خطای بی‌صدا=${(b.silent * 100).toFixed(2)}%  خطا در میان خودکارها=${(b.errAmongAuto * 100).toFixed(2)}%`)
    console.log('v2 (آستانهٔ اعتماد):')
    for (const c of curve(rowsV2, ref, ths)) console.log(`  t=${c.t.toFixed(2)} auto=${(c.autoRate * 100).toFixed(1).padStart(5)}%  خطای بی‌صدا=${(c.silent * 100).toFixed(2).padStart(5)}%  خطا در میان خودکارها=${(c.errAmongAuto * 100).toFixed(2).padStart(5)}%`)
  }
}
