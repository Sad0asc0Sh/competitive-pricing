'use strict'
/**
 * برآورد ضرایب مدل «اعتماد کالیبره» (تنظیم لوجیستیک روی ویژگی‌های قابل‌توضیح) و ارزیابی آن روی داده‌ی کنارگذاشته.
 *   node eval/market/fit-confidence.cjs [--root DIR] [--train-seeds 101,102] [--test-seeds 103] [--n 300] [--label oS|oC] [--write FILE]
 * برچسب = |قیمت نهایی − اوراکل| ≤ ۲٪ (پیش‌فرض اوراکلِ سازگار با سیاست oS).
 *
 * حالت «دادهٔ واقعی» (۴.۲.۰): به‌جای شبیه‌ساز، ردیف‌های برچسب‌دارِ خروجی scripts/export-calibration-data.cjs را می‌خواند:
 *   node eval/market/fit-confidence.cjs --data calibration-rows.json [--test-frac 0.3] [--min-rows 200] [--write model.json]
 *   ردیف: { pRight, pNone, heuristic|null, floorBound, label: 0|1, createdAt? }  (برچسب ۱ = قیمتِ ما درست بود)
 *   تقسیم آموزش/آزمون «زمانی» است (قدیمی‌ترها آموزش)؛ بدون createdAt به ترتیب ردیف. با دادهٔ کم مدل نوشته نمی‌شود (کد خروج ۳).
 */
const fs = require('fs')
const path = require('path')
const R = require('./run.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const lg = (p) => { const q = clamp(p, 0.01, 0.99); return Math.log(q / (1 - q)) }

// ستون‌هایی که نادیده گرفته می‌شوند (صفر می‌مانند): با --drop none,floor,heur
const DROP = new Set((arg('drop', '') || '').split(',').filter(Boolean))
function features(r, drop = DROP) {
  return [1, lg(r.pRight), drop.has('heur') ? 0 : clamp(r.heuristic ?? 0, 0, 1), drop.has('none') ? 0 : clamp(r.pNone ?? 0, 0, 1), drop.has('floor') ? 0 : r.floorBound ? 1 : 0]
}
const NAMES = ['intercept', 'wLogitRight', 'wHeuristic', 'wNoneValid', 'wFloorBound']

function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let i = 0; i < n; i++) {
    let piv = i
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r
    ;[M[i], M[piv]] = [M[piv], M[i]]
    const d = M[i][i] || 1e-12
    for (let c = i; c <= n; c++) M[i][c] /= d
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = M[r][i]
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]
    }
  }
  return M.map((row) => row[n])
}

/** رگرسیون لوجیستیک با Newton–Raphson و جریمهٔ L2 روی ضرایب غیر از عرض از مبدأ */
function fitLogistic(X, y, lambda = 1e-2, iters = 50) {
  const d = X[0].length
  // آغاز: هویت روی logit(pRight)
  let w = new Array(d).fill(0)
  w[1] = 1
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0)
    const H = Array.from({ length: d }, () => new Array(d).fill(0))
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, v, k) => s + v * w[k], 0)
      const p = sigmoid(z)
      const e = p - y[i]
      for (let a = 0; a < d; a++) {
        g[a] += e * X[i][a]
        for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * X[i][a] * X[i][b]
      }
    }
    for (let a = 1; a < d; a++) {
      const target = a === 1 ? 1 : 0 // جریمه حول هویت برای logit(pRight)
      g[a] += lambda * (w[a] - target)
      H[a][a] += lambda
    }
    const step = solve(H, g)
    let mx = 0
    for (let a = 0; a < d; a++) { w[a] -= step[a]; mx = Math.max(mx, Math.abs(step[a])) }
    if (mx < 1e-7) break
  }
  return w
}

function metrics(rows, w, drop = DROP) {
  const ps = rows.map((r) => sigmoid(features(r, drop).reduce((s, v, k) => s + v * w[k], 0)))
  const ys = rows.map((r) => r.y)
  const pos = ps.filter((_, i) => ys[i] === 1)
  const neg = ps.filter((_, i) => ys[i] === 0)
  const brier = ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / ps.length
  const bins = []
  let ece = 0
  for (let b = 0; b < 10; b++) {
    const idx = ps.map((p, i) => i).filter((i) => ps[i] >= b / 10 && (ps[i] < (b + 1) / 10 || (b === 9 && ps[i] <= 1)))
    if (!idx.length) continue
    const mp = idx.reduce((s, i) => s + ps[i], 0) / idx.length
    const my = idx.reduce((s, i) => s + ys[i], 0) / idx.length
    ece += (idx.length / ps.length) * Math.abs(mp - my)
    bins.push({ bin: `${b * 10}-${b * 10 + 10}`, n: idx.length, meanP: mp, freq: my })
  }
  return { n: rows.length, base: ys.reduce((a, b) => a + b, 0) / ys.length, auc: R.auroc(pos, neg), brier, ece, bins }
}

function collect(eng, base, seeds, names, n, labelKey) {
  const rows = []
  for (const seed of seeds) {
    for (const sc of names) {
      const worlds = R.buildWorlds(seed, sc, n)
      for (const r of R.evalEngine(eng, base, worlds, {})) {
        if (r.final == null || r[labelKey] == null || r.pRight == null) continue
        rows.push({ ...r, y: Math.abs((r.final - r[labelKey]) / r[labelKey]) <= 0.02 ? 1 : 0, sc, seed })
      }
    }
  }
  return rows
}

module.exports = { fitLogistic, features, NAMES, metrics, collect, fitFromRows }

/**
 * برازش روی ردیف‌های واقعی. ستونی که در همهٔ ردیف‌ها بی‌اطلاع است (heuristic همیشه null، pNone همیشه ۰، floorBound همیشه false)
 * به‌طور خودکار کنار گذاشته می‌شود تا ضریب بی‌معنا برازش نشود.
 */
function fitFromRows(rawRows, { testFrac = 0.3, minRows = 200, minEach = 30 } = {}) {
  const rows = rawRows
    .filter((r) => r && Number.isFinite(r.pRight) && (r.label === 0 || r.label === 1))
    .map((r) => ({ ...r, y: r.label }))
  const pos = rows.filter((r) => r.y === 1).length
  const neg = rows.length - pos
  if (rows.length < minRows || pos < minEach || neg < minEach) {
    return { ok: false, reason: `داده کافی نیست: n=${rows.length} (درست=${pos}, نادرست=${neg})؛ حداقل n≥${minRows} و از هر برچسب ≥${minEach} لازم است` }
  }
  const dropped = []
  if (rows.every((r) => r.heuristic == null)) dropped.push('heur')
  if (rows.every((r) => !r.pNone)) dropped.push('none')
  if (rows.every((r) => !r.floorBound)) dropped.push('floor')
  // حالت ماژول (DROP سراسری از --drop) تغییر نمی‌کند؛ هر فراخوانی مجموعهٔ کنارگذاشتهٔ خودش را دارد
  const drop = new Set([...DROP, ...dropped])
  const sorted = rows.every((r) => r.createdAt) ? [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) : rows
  const cut = Math.max(1, Math.floor(sorted.length * (1 - testFrac)))
  const train = sorted.slice(0, cut)
  const test = sorted.slice(cut)
  const w = fitLogistic(train.map((r) => features(r, drop)), train.map((r) => r.y))
  return { ok: true, w, train, test, dropped, drop, counts: { n: rows.length, pos, neg } }
}

function printMetrics(title, m) {
  console.log(`\n${title}: n=${m.n} baseRate=${(m.base * 100).toFixed(1)}% AUC=${m.auc == null ? 'n/a' : m.auc.toFixed(3)} Brier=${m.brier.toFixed(4)} ECE=${m.ece.toFixed(3)}`)
  for (const b of m.bins) console.log(`   ${b.bin.padEnd(7)} n=${String(b.n).padStart(5)}  پیش‌بینی=${(b.meanP * 100).toFixed(1).padStart(5)}%  فراوانی واقعی=${(b.freq * 100).toFixed(1).padStart(5)}%`)
}

if (require.main === module && arg('data', null)) {
  const file = arg('data')
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  const res = fitFromRows(Array.isArray(payload) ? payload : payload.rows || [], {
    testFrac: Number(arg('test-frac', 0.3)),
    minRows: Number(arg('min-rows', 200)),
  })
  if (!res.ok) {
    console.error(res.reason)
    console.error('مدل نوشته نشد؛ همان مدل پیش‌فرض (هویت روی pRight) را نگه دارید و ممیزی/ثبت برچسب را ادامه دهید.')
    process.exit(3)
  }
  const model = Object.fromEntries(NAMES.map((k, i) => [k, Number(res.w[i].toFixed(4))]))
  console.log(`ردیف‌ها: ${res.counts.n} (درست=${res.counts.pos}, نادرست=${res.counts.neg}) | آموزش=${res.train.length} آزمون=${res.test.length}${res.dropped.length ? ' | ستون‌های کنارگذاشته‌شده: ' + res.dropped.join(',') : ''}`)
  console.log('ضرایب برآوردشده:', model)
  printMetrics('آموزش (برازش‌شده)', metrics(res.train, res.w, res.drop))
  if (res.test.length >= 20) {
    const tf = metrics(res.test, res.w, res.drop)
    const ti = metrics(res.test, [0, 1, 0, 0, 0], res.drop)
    printMetrics('آزمون زمانیِ کنارگذاشته — مدل برازش‌شده', tf)
    printMetrics('آزمون — بدون کالیبراسیون (pRight خام = مدل پیش‌فرض)', ti)
    const better = tf.ece < ti.ece - 0.005 && tf.brier <= ti.brier + 1e-4
    console.log(better ? '\nنتیجه: مدل برازش‌شده روی آزمون «بهتر کالیبره» است؛ می‌توانید آن را در پروفایل (estimator.confidenceModel) بگذارید.' : '\nنتیجه: بهبود معناداری نسبت به مدل پیش‌فرض دیده نشد؛ مدل پیش‌فرض را نگه دارید.')
  } else {
    console.log('\nداده آزمون کمتر از ۲۰ ردیف است؛ ارزیابی بی‌طرف ممکن نیست.')
  }
  const out = arg('write', null)
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ estimator: { confidenceModel: model }, meta: { source: path.basename(file), rows: res.counts, dropped: res.dropped } }, null, 2))
    console.log(`مدل نوشته شد: ${out}  (فقط در صورت «بهتر کالیبره» اعمال شود؛ سپس minCalibratedConfidence را روی منحنی ریسک–پوشش بازبینی کنید)`)
  }
} else if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const baseRoot = path.resolve(arg('baseline', path.join(__dirname, '..', 'baseline')))
  const trainSeeds = arg('train-seeds', '101,102').split(',').map(Number)
  const testSeeds = arg('test-seeds', '103').split(',').map(Number)
  const n = Number(arg('n', 300))
  const labelKey = 'o' + arg('label', 'S')
  const names = arg('scenarios', 'mix,clean,bait,variant,legit,volatile,big,thin,wide').split(',')
  const eng = R.loadEngine(root)
  const base = R.loadEngine(baseRoot)
  const train = collect(eng, base, trainSeeds, names, n, labelKey)
  const test = collect(eng, base, testSeeds, names, n, labelKey)
  const X = train.map(features)
  const y = train.map((r) => r.y)
  const w = fitLogistic(X, y)
  const ident = [0, 1, 0, 0, 0]
  const show = (title, m) => {
    console.log(`\n${title}: n=${m.n} baseRate=${(m.base * 100).toFixed(1)}% AUC=${m.auc.toFixed(3)} Brier=${m.brier.toFixed(4)} ECE=${m.ece.toFixed(3)}`)
    for (const b of m.bins) console.log(`   ${b.bin.padEnd(7)} n=${String(b.n).padStart(5)}  پیش‌بینی=${(b.meanP * 100).toFixed(1).padStart(5)}%  فراوانی واقعی=${(b.freq * 100).toFixed(1).padStart(5)}%`)
  }
  console.log('ضرایب برآوردشده:', Object.fromEntries(NAMES.map((k, i) => [k, Number(w[i].toFixed(4))])))
  show('آموزش (برازش‌شده)', metrics(train, w))
  show('آزمون کنارگذاشته — مدل برازش‌شده', metrics(test, w))
  show('آزمون کنارگذاشته — بدون کالیبراسیون (pRight خام)', metrics(test, ident))
  // heuristic-only baseline
  const hOnly = [0, 0, 1, 0, 0]
  show('آزمون — امتیاز قدیمی (heuristic) خام', { ...metrics(test, hOnly) })
  const out = arg('write', null)
  if (out) fs.writeFileSync(out, JSON.stringify({ model: Object.fromEntries(NAMES.map((k, i) => [k, Number(w[i].toFixed(4))])), trainSeeds, testSeeds, n, label: labelKey }, null, 2))
}
