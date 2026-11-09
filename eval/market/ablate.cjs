'use strict'
/**
 * ablation: اثر هر پرچم/بخش تخمین‌گر v2 به‌صورت جداگانه و تجمعی.
 *   node eval/market/ablate.cjs [--root DIR] [--n 500] [--seed 7] [--scenarios mix,clean,...] [--oracle A|B|both] [--set list]
 */
const path = require('path')
const R = require('./run.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const E = (patch) => (cfg) => Object.assign(cfg.estimator, patch)
const SETS = {
  incremental: {
    'legacy(4.1.2 data path)': E({ mode: 'legacy' }),
    '+guaranteeFix': E({ mode: 'v2', validityModel: false, softStaleness: false, guaranteeFix: true, marketConflictByProbability: false, calibratedConfidence: false }),
    '+validityModel(no soft age)': E({ mode: 'v2', validityModel: true, softStaleness: false, guaranteeFix: true, marketConflictByProbability: false, calibratedConfidence: false }),
    '+softStaleness': E({ mode: 'v2', validityModel: true, softStaleness: true, guaranteeFix: true, marketConflictByProbability: false, calibratedConfidence: false }),
    '+conflictByProb': E({ mode: 'v2', validityModel: true, softStaleness: true, guaranteeFix: true, marketConflictByProbability: true, calibratedConfidence: false }),
    'v2 default': E({ mode: 'v2' }),
  },
}

SETS.final = {
  'v2 پیشنهادی (اعتماد کالیبره)': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true }),
  '  همان با آستانه ۰٫۹': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true, minCalibratedConfidence: 0.9 }),
  'v2 محافظه‌کار (همه دروازه‌ها)': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: true, supervisorMarketCalibrated: false }),
}
const FINAL = { mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true }
SETS.ratio = Object.fromEntries([0.5, 0.7, 1, 1.4, 2].map((r) => [`cost-ratio ${r}`, E({ ...FINAL, competitivenessCostRatio: r })]))
SETS.gates = {
  'v2 validity (بدون سناریو)': E({ mode: 'v2', calibratedConfidence: false }),
  'v2 + اعتماد کالیبره (همه دروازه‌ها)': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: true, supervisorMarketCalibrated: false }),
  '  − دروازهٔ تعارض بازار': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: false }),
  '  − تعارض + ناظر کالیبره': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true }),
  '  همان با آستانه ۰٫۷': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true, minCalibratedConfidence: 0.7 }),
  '  همان با آستانه ۰٫۹': E({ mode: 'v2', calibratedConfidence: true, conflictGateWhenCalibrated: false, supervisorMarketCalibrated: true, minCalibratedConfidence: 0.9 }),
}

if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
  const n = Number(arg('n', 500))
  const seed = Number(arg('seed', 7))
  const names = arg('scenarios', 'mix,clean,bait,volatile,legit,thin').split(',')
  const oracle = arg('oracle', 'both')
  const setName = arg('set', 'incremental')
  const eng = R.loadEngine(root)
  const base = R.loadEngine(baseRoot)
  for (const sc of names) {
    const worlds = R.buildWorlds(seed, sc, n)
    const rowsByCfg = Object.entries(SETS[setName]).map(([name, f]) => [name, R.evalEngine(eng, base, worlds, { cfgOverride: f })])
    // پایهٔ مرجع: موتور اصلی (baseline) روی همین دنیاها
    const baseRows = R.evalEngine(base, base, worlds, {})
    const want = oracle === 'both' ? ['A', 'B'] : oracle.split('')
    for (const o of want) {
      const key = 'o' + o
      const title = { A: 'oracleA (رتبه ۱ مطلق)', B: 'oracleB (baseline روی داده تمیز)', C: 'oracleC (بهترین رتبهٔ شدنی با بیشترین سود)', S: 'oracleS (خودِ موتور روی داده تمیز)' }[o]
      R.printTable(`${sc} vs ${title}`, [['baseline 4.1.2', R.aggregate(baseRows, key)], ...rowsByCfg.map(([k, rows]) => [k.slice(0, 36), R.aggregate(rows, key)])])
    }
  }
}
module.exports = { SETS, E }
