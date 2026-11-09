'use strict'
/**
 * تشخیص «علت خطا» برای هر دنیا (ریشه‌یابی، نه فقط اندازه‌گیری).
 *   node eval/market/diagnose.cjs --root DIR [--scenarios mix,bait,...] [--n 500] [--seed 7] [--json FILE]
 * هر دنیایی که |final − oracleA|/oracleA > 2% دارد در یکی از سطل‌های علت قرار می‌گیرد.
 */
const path = require('path')
const fs = require('fs')
const { evalEngineDetailed, buildWorlds, loadEngine, SCENARIOS } = require('./run.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
const n = Number(arg('n', 500))
const seed = Number(arg('seed', 7))
const names = arg('scenarios', 'mix,clean,bait,variant,legit,volatile,big,thin,wide').split(',')
const eng = loadEngine(root)
const base = root === baseRoot ? eng : loadEngine(baseRoot)

const summary = {}
for (const name of names) {
  const worlds = buildWorlds(seed, name, n)
  const rows = evalEngineDetailed(eng, base, worlds, {})
  const causes = {}
  let bad = 0
  let total = 0
  for (const r of rows) {
    if (r.oA == null || r.final == null) continue
    total++
    const err = (r.final - r.oA) / r.oA
    if (Math.abs(err) <= 0.02) continue
    bad++
    const key = `${err < 0 ? 'giveaway' : 'uncompetitive'}:${r.cause}`
    causes[key] = (causes[key] || 0) + 1
  }
  summary[name] = { total, bad, causes: Object.fromEntries(Object.entries(causes).sort((a, b) => b[1] - a[1])) }
  console.log(`\n=== ${name}: ${bad}/${total} (${((bad / total) * 100).toFixed(1)}%) با خطای >2٪`)
  for (const [k, v] of Object.entries(summary[name].causes)) console.log(`  ${String(v).padStart(4)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
}
const out = arg('json', null)
if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 2))
