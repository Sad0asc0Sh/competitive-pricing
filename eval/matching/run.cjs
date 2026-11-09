'use strict'
/**
 * اجرای بنچمارک تطابق روی یک نسخه‌ی موتور (ریشه‌ی پروژه یا snapshot).
 *   node eval/matching/run.cjs [--root DIR] [--corpus FILE] [--split dev|test|all] [--label NAME] [--out FILE.json]
 * شاخص‌های اصلی:
 *   wrongAuto      : سهم کیس‌هایی که کارت «اشتباه» (diff) خودکار تایید شد                (هرچه کمتر بهتر؛ مهم‌ترین)
 *   unsafeAuto     : تایید خودکار هر کارتی جز «کارت درست در کیس قابل‌تشخیص» (شامل ابهام) (هرچه کمتر بهتر)
 *   coverage       : سهم کیس‌های قابل‌تشخیص (expected=approve) که کارت درست خودکار تایید شد (هرچه بیشتر بهتر)
 *   missed         : کارت درست وجود داشت ولی همه‌ی کارت‌ها رد شدند (از دست رفتن داده)
 *   pairFAR[type]  : نرخ تایید خودکار برای کارت‌های منفی هر نوع (سطح جفت)
 *   auc            : AUROC جداسازی same از diff با امتیاز تطابق (بدون وابستگی به آستانه)
 */
const fs = require('fs')
const path = require('path')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

function loadMatcher(root) {
  const { loadTsModule } = require(path.join(root, 'tests/helpers/ts-loader.cjs'))
  return loadTsModule('src/lib/pricing/matcher.ts')
}

function auroc(pos, neg) {
  if (!pos.length || !neg.length) return null
  const all = [...pos.map((s) => [s, 1]), ...neg.map((s) => [s, 0])].sort((a, b) => a[0] - b[0])
  let rankSum = 0
  let i = 0
  while (i < all.length) {
    let j = i
    while (j < all.length && all[j][0] === all[i][0]) j++
    const avg = (i + 1 + j) / 2
    for (let k = i; k < j; k++) if (all[k][1] === 1) rankSum += avg
    i = j
  }
  const n1 = pos.length
  const n0 = neg.length
  return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0)
}

function evaluateCorpus(matcher, cases, { reject = 45, approve = 80 } = {}) {
  const A = {
    n: 0,
    expected: { approve: 0, review: 0, reject: 0 },
    cls: {},
    pair: { same: { approve: 0, review: 0, reject: 0, n: 0 }, byNeg: {} },
    posScores: [],
    negScores: [],
    top1: { present: 0, hit: 0 },
    byFamily: {},
    byCoded: {},
    leaks: [], // نمونه‌هایی از تایید اشتباه برای بررسی دستی
    ambigEx: [],
    missedEx: [],
  }
  const bump = (o, k, by = 1) => (o[k] = (o[k] || 0) + by)
  for (const c of cases) {
    A.n++
    A.expected[c.expected]++
    const label = new Map(c.candidates.map((x) => [x.prk, x]))
    const target = { productName: c.target.productName, sku: c.target.sku, anchorPriceToman: c.target.anchorPriceToman, rejectBelowPct: reject, approveAbovePct: approve }
    const cands = c.candidates.map(({ prk, titleFa, titleEn, priceToman, sellerCount, available }) => ({ prk, titleFa, titleEn, priceToman, sellerCount, available }))
    let out
    try {
      out = matcher.selectBestTorobSearchMatch(target, cands, 1)
    } catch (e) {
      bump(A.cls, 'exception')
      continue
    }
    const ranked = out.allRanked || []
    for (const r of ranked) {
      const lb = label.get(r.candidate.prk)
      if (!lb) continue
      if (lb.label === 'same') {
        A.pair.same.n++
        A.pair.same[r.verdict]++
        A.posScores.push(r.score)
      } else if (lb.label === 'diff') {
        const key = lb.negType || 'other'
        const b = (A.pair.byNeg[key] ||= { approve: 0, review: 0, reject: 0, n: 0 })
        b.n++
        b[r.verdict]++
        A.negScores.push(r.score)
      }
    }
    const hasSame = c.candidates.some((x) => x.label === 'same')
    const best = out.best
    const bestLabel = best ? label.get(best.candidate.prk) : null
    if (hasSame) {
      A.top1.present++
      if (best && bestLabel && bestLabel.label === 'same') A.top1.hit++
    }
    let cls
    if (!best) cls = hasSame ? 'reject_present' : 'reject_absent'
    else if (best.verdict === 'approve') cls = bestLabel.label === 'same' ? 'auto_correct' : bestLabel.label === 'ambig' ? 'auto_ambig' : 'auto_wrong'
    else if (best.verdict === 'review') cls = bestLabel.label === 'same' ? 'review_same' : 'review_other'
    else cls = hasSame ? 'reject_present' : 'reject_absent'
    bump(A.cls, cls)
    if (cls === 'auto_correct' && c.expected === 'approve') bump(A, 'autoCorrectExpApprove')
    if (hasSame) bump(A, 'hasSameN')
    const fam = (A.byFamily[c.family] ||= { n: 0, auto_wrong: 0, auto_ambig: 0, auto_correct: 0, expApprove: 0 })
    fam.n++
    if (c.expected === 'approve') fam.expApprove++
    if (cls === 'auto_wrong' || cls === 'auto_ambig' || cls === 'auto_correct') fam[cls]++
    const cd = (A.byCoded[c.coded ? (c.statedCode ? 'coded+stated' : 'coded-notstated') : 'codeless'] ||= { n: 0, auto_wrong: 0, auto_ambig: 0, auto_correct: 0, expApprove: 0, hasSame: 0, review: 0 })
    cd.n++
    if (c.expected === 'approve') cd.expApprove++
    if (hasSame) cd.hasSame++
    if (cls === 'auto_wrong' || cls === 'auto_ambig' || cls === 'auto_correct') cd[cls]++
    if (best && best.verdict === 'review') cd.review++
    if (cls === 'auto_ambig' && A.ambigEx.length < 25) A.ambigEx.push({ id: c.id, target: c.target.productName, sku: c.target.sku, picked: best.candidate.titleFa, score: best.score, neg: bestLabel.negType, role: bestLabel.role })
    if (cls === 'auto_wrong' && A.leaks.length < 25)
      A.leaks.push({ id: c.id, target: c.target.productName, sku: c.target.sku, picked: best.candidate.titleFa, score: best.score, neg: bestLabel.negType })
    if (cls === 'reject_present' && c.expected === 'approve' && A.missedEx.length < 15) {
      const t = c.candidates.find((x) => x.label === 'same')
      const rr = ranked.find((r) => r.candidate.prk === t.prk)
      A.missedEx.push({ id: c.id, target: c.target.productName, true: t.titleFa, score: rr ? rr.score : null, reason: rr ? rr.rejectReason : null })
    }
  }
  const N = A.n
  const g = (k) => A.cls[k] || 0
  const expA = A.expected.approve
  const summary = {
    n: N,
    expected: A.expected,
    wrongAuto: g('auto_wrong') / N,
    ambigAuto: g('auto_ambig') / N,
    unsafeAuto: (g('auto_wrong') + g('auto_ambig') + 0) / N,
    autoCorrect: g('auto_correct') / N,
    // coverage: از کیس‌هایی که کارت درست در نتایج بود، چند درصد خودکار و درست تایید شد
    coverage: A.hasSameN ? g('auto_correct') / A.hasSameN : null,
    coverageExpApprove: expA ? (A.autoCorrectExpApprove || 0) / expA : null,
    reviewRate: (g('review_same') + g('review_other')) / N,
    missed: g('reject_present') / N,
    correctReject: g('reject_absent') / N,
    top1: A.top1.present ? A.top1.hit / A.top1.present : null,
    auc: auroc(A.posScores, A.negScores),
    pairSame: A.pair.same,
    pairNeg: A.pair.byNeg,
    cls: A.cls,
    byFamily: A.byFamily,
    byCoded: A.byCoded,
    leaks: A.leaks,
    ambigEx: A.ambigEx,
    missedEx: A.missedEx,
  }
  // نرخ تایید خودکار در سطح جفت برای منفی‌ها
  summary.pairFAR = {}
  for (const [k, v] of Object.entries(A.pair.byNeg)) summary.pairFAR[k] = { approve: v.approve / v.n, atLeastReview: (v.approve + v.review) / v.n, n: v.n }
  return summary
}

function pct(x) {
  return x == null ? '  n/a ' : (x * 100).toFixed(2).padStart(6) + '%'
}

function printSummary(label, s) {
  console.log(`\n=== ${label} — ${s.n} کیس ===`)
  console.log(`wrongAuto(کارت اشتباه تایید شد) ${pct(s.wrongAuto)} | ambigAuto ${pct(s.ambigAuto)} | unsafeAuto ${pct(s.unsafeAuto)}`)
  console.log(`coverage(کارت درست بود ⇒ خودکار درست) ${pct(s.coverage)} (فقط کیس‌های بی‌ابهام ${pct(s.coverageExpApprove)}) | reviewRate ${pct(s.reviewRate)} | missed(رد در حالت وجود) ${pct(s.missed)} | top1 ${pct(s.top1)} | AUC ${s.auc == null ? 'n/a' : s.auc.toFixed(4)}`)
  const ps = s.pairSame
  console.log(`کارت‌های درست: approve ${pct(ps.approve / ps.n)} review ${pct(ps.review / ps.n)} reject ${pct(ps.reject / ps.n)} (n=${ps.n})`)
  console.log('نرخ تایید خودکار منفی‌ها به تفکیک نوع (سطح جفت):')
  for (const [k, v] of Object.entries(s.pairFAR).sort()) console.log(`  ${k.padEnd(16)} approve ${pct(v.approve)} | ≥review ${pct(v.atLeastReview)} | n=${v.n}`)
  console.log('به تفکیک وضعیت کد:')
  for (const [k, v] of Object.entries(s.byCoded)) console.log(`  ${k.padEnd(16)} n=${String(v.n).padEnd(5)} wrong ${pct(v.auto_wrong / v.n)} ambigAuto ${pct(v.auto_ambig / v.n)} coverage ${pct(v.hasSame ? v.auto_correct / v.hasSame : null)} review ${pct(v.review / v.n)}`)
}

module.exports = { evaluateCorpus, printSummary, loadMatcher, auroc, pct }

if (require.main === module) {
  const root = path.resolve(arg('root', path.join(__dirname, '..', '..')))
  const corpusFile = arg('corpus', path.join(__dirname, 'corpus.json'))
  const split = arg('split', 'all')
  const label = arg('label', path.basename(root))
  if (!fs.existsSync(corpusFile)) require('./generate.cjs')
  let corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'))
  if (split !== 'all') corpus = corpus.filter((c) => c.split === split)
  const matcher = loadMatcher(root)
  const s = evaluateCorpus(matcher, corpus)
  printSummary(`${label} [${split}]`, s)
  if (process.argv.includes('--leaks')) {
    console.log('\nنمونه‌ی تاییدهای اشتباه:')
    for (const l of s.leaks.slice(0, 12)) console.log(`  [${l.neg}] «${l.target}» (sku ${l.sku}) ⇒ «${l.picked}» ${l.score}%`)
    console.log('\nنمونه‌ی تاییدِ خودکارِ کارت مبهم:')
    for (const l of s.ambigEx.slice(0, 12)) console.log(`  [${l.neg}/${l.role}] «${l.target}» (sku ${l.sku}) ⇒ «${l.picked}» ${l.score}%`)
    console.log('\nنمونه‌ی کارت‌های درستِ ازدست‌رفته:')
    for (const l of s.missedEx.slice(0, 10)) console.log(`  «${l.target}» ⇏ «${l.true}» ${l.score}% ${l.reason || ''}`)
  }
  const out = arg('out', null)
  if (out) fs.writeFileSync(out, JSON.stringify(s, null, 2))
}
