'use strict'
/**
 * مسیر «حالت سایه / بازتنظیم با برچسب واقعی» (۴.۲.۰): ذخیرهٔ ویژگی‌ها در steps → استخراج ردیف → برازش مدل اعتماد.
 * بدون دیتابیس و شبکه؛ همهٔ بخش‌های خالص آزمون می‌شوند. (K9–K13: انتخاب آستانهٔ اعتماد از روی ممیزی واقعی)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { makeScenarios } = require('./helpers/legacy-scenarios.cjs')
const rows = require(path.join(__dirname, '..', 'scripts', 'lib', 'calibration-rows.cjs'))
const { fitFromRows, features, NAMES } = require(path.join(__dirname, '..', 'eval', 'market', 'fit-confidence.cjs'))
const thr = require(path.join(__dirname, '..', 'eval', 'market', 'threshold-from-rows.cjs'))
const estCfg = require(path.join(__dirname, '..', 'scripts', 'lib', 'estimator-config.cjs'))
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')

function lcg(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

/** چند تصمیمِ واقعی موتور (v2) که تحلیل سناریو دارند */
function realResults(max = 12) {
  const scenarios = makeScenarios(300, 4120, new Date('2026-10-14T08:00:00Z'))
  const out = []
  for (const sc of scenarios) {
    const res = runPricingPipeline(sc.source, { ...sc.ctx, config: structuredClone(DEFAULT_PROFILE_CONFIG) })
    if (res.decisionScenarios && res.finalPrice) out.push({ sc, res })
    if (out.length >= max) break
  }
  return out
}

test('K1. ویژگی‌های کالیبراسیون واقعاً در steps ذخیره می‌شوند و استخراج‌شان با خروجی موتور یکی است', () => {
  const list = realResults()
  assert.ok(list.length >= 5, 'سناریوی کافی با تحلیل سناریو پیدا نشد')
  for (const { res } of list) {
    const f = rows.featuresFromSteps(res.steps)
    assert.ok(f, 'گام robustness باید ویژگی بدهد')
    assert.equal(f.pRight, res.decisionScenarios.pRight)
    assert.equal(f.heuristic, res.confidenceBreakdown.heuristic)
    const guards = res.steps.find((s) => s.step === 'guards')
    assert.equal(f.floorBound, Boolean(guards.data.floorEnforced))
    const dec = res.steps.find((s) => s.step === 'decision')
    assert.equal(dec.data.needsReview, res.needsReview)
    assert.equal(rows.needsReviewFromSteps(res.steps), res.needsReview)
    assert.equal(dec.data.confidence, res.confidence)
  }
})

test('K2. گام decision هیچ قیمت خرید/کف/حاشیه‌ای نمی‌برد (فقط احتمال و بولی)', () => {
  for (const { sc, res } of realResults()) {
    const dec = res.steps.find((s) => s.step === 'decision')
    const blob = JSON.stringify(dec.data)
    for (const secret of [sc.ctx.costPrice, res.supply.hardFloorPrice, res.supply.effectiveCostPrice]) {
      if (secret && secret > 1000) assert.ok(!blob.includes(String(Math.round(secret))), `عدد محرمانه ${secret} در data گام decision آمده`)
    }
    for (const v of Object.values(dec.data.confidenceBreakdown)) assert.ok(typeof v === 'number' && v <= 1.0001 && v >= -0.0001, 'ضرایب اعتماد باید در ۰..۱ باشند')
  }
})

test('K3. تصمیم‌های قدیمی (بدون robustness) نادیده گرفته می‌شوند و پیام فارسیِ گام decision پشتیبان است', () => {
  assert.equal(rows.featuresFromSteps([]), null)
  assert.equal(rows.featuresFromSteps(undefined), null)
  assert.equal(rows.featuresFromSteps([{ step: 'robustness', data: {} }]), null)
  const legacyReview = [{ step: 'decision', message: '⏳ ارسال به بخش ریویو (بازبینی): ...' }]
  const legacyAuto = [{ step: 'decision', message: '✅ تایید ناظر SystemOne (90% ≥ 80%) و اعمال خودکار: ...' }]
  assert.equal(rows.needsReviewFromSteps(legacyReview), true)
  assert.equal(rows.needsReviewFromSteps(legacyAuto), false)
  assert.equal(rows.needsReviewFromSteps([{ step: 'decision', message: 'x' }]), null)
})

test('K4. برچسب‌ها: بازبینی (تأیید/رد) فقط برای تصمیم‌های رفته‌به‌صف؛ ممیزی بر بازبینی اولویت دارد', () => {
  const rob = (p) => ({ step: 'robustness', data: { pRight: p, pNoneValid: 0.1 } })
  const decReview = { step: 'decision', data: { needsReview: true }, message: '' }
  const decAuto = { step: 'decision', data: { needsReview: false }, message: '' }
  const mk = (id, status, steps, finalPrice = 1000000) => ({ id, status, finalPrice, confidence: 0.8, steps, createdAt: '2026-10-01T00:00:00Z' })
  const decisions = [
    mk(1, 'applied', [rob(0.9), decReview]), // بازبینی‌شده و تأییدشده ⇒ ۱
    mk(2, 'rejected', [rob(0.5), decReview]), // رد ⇒ ۰
    mk(3, 'pending_review', [rob(0.5), decReview]), // هنوز در صف ⇒ بدون برچسب
    mk(4, 'applied', [rob(0.95), decAuto]), // خودکار؛ فقط ممیزی می‌تواند برچسب بدهد
    mk(5, 'applied', [rob(0.95), decAuto], 1000000), // با ممیزی: قیمت درست ۱٫۰۱ میلیون ⇒ در ±۲٪ ⇒ ۱
    mk(6, 'applied', [rob(0.95), decAuto], 1000000), // ممیزی: ۱٫۱ میلیون ⇒ ۰
    mk(7, 'applied', [rob(0.5), decReview], 1000000), // هم بازبینی‌شده هم ممیزی‌شده: ممیزی برنده است ⇒ ۰
    mk(8, 'applied', [decAuto]), // بدون robustness (قدیمی)
  ]
  const audit = new Map([[5, 1010000], [6, 1100000], [7, 1100000]])
  const built = rows.buildRows(decisions, { audit })
  const byId = Object.fromEntries(built.rows.map((r) => [r.decisionId, r]))
  assert.equal(byId[1].label, 1)
  assert.equal(byId[1].labelSource, 'review')
  assert.equal(byId[2].label, 0)
  assert.equal(byId[3], undefined)
  assert.equal(byId[4], undefined)
  assert.equal(byId[5].label, 1)
  assert.equal(byId[5].labelSource, 'audit')
  assert.equal(byId[6].label, 0)
  assert.equal(byId[7].label, 0)
  assert.equal(byId[7].labelSource, 'audit')
  assert.equal(byId[8], undefined)
  assert.deepEqual(built.skipped, { noFeatures: 1, noLabel: 2 })
  // useReview=false ⇒ فقط ممیزی
  const onlyAudit = rows.buildRows(decisions, { audit, useReview: false })
  assert.deepEqual(onlyAudit.rows.map((r) => r.decisionId).sort((a, b) => a - b), [5, 6, 7])
  // تلورانس سفارشی
  assert.equal(rows.labelFromAudit({ finalPrice: 1000000 }, 1030000, 0.05), 1)
  assert.equal(rows.labelFromAudit({ finalPrice: 1000000 }, 1030000, 0.02), 0)
  assert.equal(rows.labelFromAudit({ finalPrice: 1000000 }, 0), null)
  assert.equal(rows.labelFromAudit({ finalPrice: null }, 1000000), null)
})

test('K5. CSV ممیزی: ارقام فارسی، هزارگان، جداکننده‌های مختلف، سطرهای خراب و سرستون نامعتبر', () => {
  const csv = ['# یادداشت', 'decisionId,correctPrice', '12,"2,450,000"', '۱۳,"۲٬۴۵۰٬۰۰۰"', '14,abc', '15,0', ''].join('\n')
  const a = rows.parseAuditCsv(csv)
  assert.equal(a.audit.get(12), 2450000)
  assert.equal(a.audit.get(13), 2450000)
  assert.equal(a.audit.has(14), false)
  assert.equal(a.audit.has(15), false)
  assert.equal(a.problems.length, 2)
  const semi = rows.parseAuditCsv('correctPrice;decisionId\n1 250 000;7\n')
  assert.equal(semi.audit.get(7), 1250000)
  const tab = rows.parseAuditCsv('decisionId\tcorrectPrice\n9\t900000\n')
  assert.equal(tab.audit.get(9), 900000)
  const bad = rows.parseAuditCsv('id,price\n1,2\n')
  assert.equal(bad.audit.size, 0)
  assert.ok(bad.problems.length >= 1)
  assert.equal(rows.parseAuditCsv('').audit.size, 0)
  assert.equal(rows.toNumber('۱٬۲۰۰'), 1200)
  assert.equal(rows.toNumber('12a'), null)
  assert.equal(rows.toNumber(null), null)
})

test('K5b. ممیزی «wrong»: کارت اشتباه/بدون مرجع ⇒ برچسب ۰ (حذف‌نشدن بدترین شکست‌ها)، بدون خراب‌کردن سطرهای دیگر', () => {
  const a = rows.parseAuditCsv(['decisionId,correctPrice', '21,wrong', '22, نادرست ', '23,X', '24,"2,000,000"', '25,wrongish', ''].join('\n'))
  assert.equal(a.audit.get(21), rows.WRONG)
  assert.equal(a.audit.get(22), rows.WRONG)
  assert.equal(a.audit.get(23), rows.WRONG)
  assert.equal(a.audit.get(24), 2000000)
  assert.equal(a.audit.has(25), false, 'متن دیگر نشانهٔ wrong نیست')
  assert.equal(a.problems.length, 1)
  assert.equal(rows.labelFromAudit({ finalPrice: 1000000 }, rows.WRONG), 0)
  assert.equal(rows.labelFromAudit({ finalPrice: null }, rows.WRONG), null, 'تصمیمِ بی‌قیمت برچسب نمی‌گیرد')
  const rob = { step: 'robustness', data: { pRight: 0.97, pNoneValid: 0 } }
  const dec = { step: 'decision', data: { needsReview: false }, message: '' }
  const d = { id: 31, status: 'applied', finalPrice: 1000000, confidence: 0.97, steps: [rob, dec], createdAt: '2026-10-01T00:00:00Z' }
  const built = rows.buildRows([d], { audit: new Map([[31, rows.WRONG]]) })
  assert.equal(built.rows.length, 1)
  assert.equal(built.rows[0].label, 0)
  assert.equal(built.rows[0].labelSource, 'audit')
})

/** دادهٔ مصنوعی با مدل مولد معلوم: P(درست) = σ(a + b·logit(pRight)) */
function synthetic(n, a, b, seed) {
  const rnd = lcg(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const pRight = 0.05 + 0.9 * rnd()
    const z = a + b * Math.log(pRight / (1 - pRight))
    const p = 1 / (1 + Math.exp(-z))
    out.push({ pRight, pNone: 0, heuristic: null, floorBound: false, label: rnd() < p ? 1 : 0, createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString() })
  }
  return out
}

test('K6. fitFromRows: ضرایب مولد را بازیابی می‌کند، ستون‌های بی‌اطلاع را کنار می‌گذارد و تقسیم زمانی است', () => {
  const data = synthetic(4000, -0.4, 0.7, 77)
  const res = fitFromRows(data)
  assert.ok(res.ok)
  assert.deepEqual(res.dropped.sort(), ['floor', 'heur', 'none'])
  const idx = Object.fromEntries(NAMES.map((k, i) => [k, i]))
  assert.ok(Math.abs(res.w[idx.intercept] - -0.4) < 0.2, `intercept=${res.w[idx.intercept]}`)
  assert.ok(Math.abs(res.w[idx.wLogitRight] - 0.7) < 0.15, `wLogitRight=${res.w[idx.wLogitRight]}`)
  assert.equal(res.w[idx.wHeuristic], 0)
  assert.equal(res.train.length + res.test.length, 4000)
  assert.ok(res.train[res.train.length - 1].createdAt <= res.test[0].createdAt, 'آموزش باید قدیمی‌تر از آزمون باشد')
})

test('K7. fitFromRows: با دادهٔ کم یا برچسب یک‌طرفه مدل نمی‌دهد (ok=false) و ردیف‌های نامعتبر را نادیده می‌گیرد', () => {
  assert.equal(fitFromRows(synthetic(50, 0, 1, 1)).ok, false)
  const oneSided = synthetic(500, 0, 1, 2).map((r) => ({ ...r, label: 1 }))
  const r = fitFromRows(oneSided)
  assert.equal(r.ok, false)
  assert.match(r.reason, /کافی نیست/)
  const dirty = [...synthetic(600, 0, 1, 3), { pRight: NaN, label: 1 }, { pRight: 0.5, label: 2 }, null]
  assert.equal(fitFromRows(dirty).ok, true)
})

test('K8. با ستون‌های اطلاعاتی (heuristic/pNone/floorBound) همان ستون‌ها برازش می‌شوند و features هم‌خوان است', () => {
  const rnd = lcg(5)
  const data = []
  for (let i = 0; i < 3000; i++) {
    const pRight = 0.05 + 0.9 * rnd()
    const heuristic = rnd()
    const floorBound = rnd() < 0.3
    const z = 0.2 + 1.0 * Math.log(pRight / (1 - pRight)) + 1.5 * heuristic - 1.2 * (floorBound ? 1 : 0)
    data.push({ pRight, pNone: rnd() * 0.2, heuristic, floorBound, label: rnd() < 1 / (1 + Math.exp(-z)) ? 1 : 0, createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString() })
  }
  const res = fitFromRows(data)
  assert.ok(res.ok)
  assert.deepEqual(res.dropped, [])
  const idx = Object.fromEntries(NAMES.map((k, i) => [k, i]))
  assert.ok(Math.abs(res.w[idx.wHeuristic] - 1.5) < 0.4, `wHeuristic=${res.w[idx.wHeuristic]}`)
  assert.ok(Math.abs(res.w[idx.wFloorBound] - -1.2) < 0.35, `wFloorBound=${res.w[idx.wFloorBound]}`)
  assert.equal(features({ pRight: 0.5, heuristic: 0.4, pNone: 0.1, floorBound: true }).length, NAMES.length)
})

test('K9. ویلسون: مقدار مرجع k=0، مقدار دستی، n=۰، شمول نقطه‌ای و باریک‌شدن با n', () => {
  const z2 = 1.96 * 1.96
  const w0 = thr.wilson(0, 100)
  assert.equal(w0.p, 0)
  assert.ok(w0.lo < 1e-12)
  assert.ok(Math.abs(w0.hi - z2 / (100 + z2)) < 1e-9, `کران بالا برای k=0 باید z²/(n+z²) باشد: ${w0.hi}`)
  const w5 = thr.wilson(5, 10)
  assert.ok(Math.abs(w5.lo - 0.2366) < 5e-4 && Math.abs(w5.hi - 0.7634) < 5e-4, `${w5.lo} ${w5.hi}`)
  const none = thr.wilson(0, 0)
  assert.deepEqual([none.p, none.lo, none.hi], [null, 0, 1])
  for (const [k, n] of [[1, 5], [30, 100], [99, 100], [100, 100]]) {
    const w = thr.wilson(k, n)
    assert.ok(w.lo >= 0 && w.hi <= 1 && w.lo <= k / n + 1e-12 && k / n <= w.hi + 1e-12, `${k}/${n}`)
  }
  const wide = thr.wilson(1, 100)
  const narrow = thr.wilson(10, 1000)
  assert.ok(narrow.hi - narrow.lo < wide.hi - wide.lo, 'نمونهٔ بزرگ‌تر باید بازهٔ باریک‌تر بدهد')
})

test('K10. scoreRows با همان تابع اعتماد موتور امتیاز می‌دهد؛ ردیف نامعتبر کنار می‌رود؛ منحنی ریسک–پوشش درست و یکنواست', () => {
  const { calibratedConfidence } = loadTsModule('src/lib/pricing/robustness.ts')
  const raw = [
    { pRight: 0.95, label: 1 },
    { pRight: 0.95, label: 0 },
    { pRight: 0.8, label: 1 },
    { pRight: 0.8, label: 1 },
    { pRight: 0.55, label: 0 },
    { pRight: NaN, label: 1 }, // نامعتبر
    { pRight: 0.9, label: 2 }, // برچسب نامعتبر
    null,
  ]
  const s = thr.scoreRows(raw, undefined)
  assert.equal(s.length, 5)
  for (const r of s) assert.equal(r.score, calibratedConfidence(undefined, { pRight: r.pRight, heuristic: 0, pNoneValid: 0, floorBound: false }))
  const shifted = thr.scoreRows(raw, { intercept: -1, wLogitRight: 1, wHeuristic: 0, wNoneValid: 0, wFloorBound: 0 })
  shifted.forEach((r, i) => assert.ok(r.score < s[i].score, 'عرض از مبدأ منفی باید همهٔ امتیازها را پایین بیاورد'))
  const rc = thr.riskCoverage(s, [0.5, 0.9, 0.99])
  assert.deepEqual(rc.map((r) => r.n), [5, 2, 0])
  assert.deepEqual(rc.map((r) => r.errors), [2, 1, 0])
  assert.equal(rc[1].errRate, 0.5)
  assert.equal(rc[2].errRate, null)
  assert.ok(rc[0].coverage >= rc[1].coverage && rc[1].coverage >= rc[2].coverage, 'پوشش با بالا رفتن آستانه نباید زیاد شود')
})

test('K11. recommend: فقط با نمونهٔ کافی و کران بالای ویلسونِ زیر هدف پیشنهاد می‌دهد؛ نمونهٔ کم یا چند خطا ⇒ هیچ', () => {
  const mk = (n, pRight, bad) => Array.from({ length: n }, (_, i) => ({ pRight, label: i < bad ? 0 : 1 }))
  // ۱۵۰ ردیف پراعتماد بی‌خطا + ۱۰۰ ردیف کم‌اعتماد با ۴۰٪ خطا
  const rec = thr.recommend(thr.scoreRows([...mk(150, 0.97, 0), ...mk(100, 0.6, 40)], undefined), { target: 0.03, minN: 30 })
  assert.equal(rec.met, true)
  assert.equal(rec.threshold, 0.61, 'کم‌ترین آستانه‌ای که ردیف‌های ۰٫۶ را کنار می‌گذارد')
  assert.ok(rec.row.hi <= 0.03)
  // ناحیهٔ پراعتمادِ بی‌خطا ولی کم‌نمونه (۲۰ < minN) ⇒ پیشنهاد نمی‌دهد
  assert.equal(thr.recommend(thr.scoreRows([...mk(20, 0.97, 0), ...mk(100, 0.6, 40)], undefined), { target: 0.03, minN: 30 }).met, false)
  // ۱۵۰ ردیف پراعتماد ولی ۴ خطا ⇒ کران بالا > ۳٪ ⇒ پیشنهاد نمی‌دهد و «نزدیک‌ترین» را می‌گوید
  const r2 = thr.recommend(thr.scoreRows([...mk(150, 0.97, 4), ...mk(100, 0.6, 40)], undefined), { target: 0.03, minN: 30 })
  assert.equal(r2.met, false)
  assert.equal(r2.threshold, null)
  assert.ok(r2.best && r2.best.n >= 30)
})

test('K12. splitTemporal زمانی است (ورودی نامرتب هم)؛ verify سه حکم می‌دهد: تأیید / نقض / نامعلوم', () => {
  const rows = [
    { createdAt: '2026-10-03T00:00:00Z', id: 3 },
    { createdAt: '2026-10-01T00:00:00Z', id: 1 },
    { createdAt: '2026-10-04T00:00:00Z', id: 4 },
    { createdAt: '2026-10-02T00:00:00Z', id: 2 },
  ]
  const sp = thr.splitTemporal(rows, 0.25)
  assert.deepEqual(sp.train.map((r) => r.id), [1, 2, 3])
  assert.deepEqual(sp.test.map((r) => r.id), [4])
  assert.deepEqual(thr.splitTemporal([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], 0.5).train.map((r) => r.id), [1, 2], 'بدون createdAt به ترتیب ردیف')
  const mk = (n, bad) => thr.scoreRows(Array.from({ length: n }, (_, i) => ({ pRight: 0.97, label: i < bad ? 0 : 1 })), undefined)
  assert.equal(thr.verify(mk(100, 1), 0.9, 0.03).verdict, 'confirmed')
  assert.equal(thr.verify(mk(100, 10), 0.9, 0.03).verdict, 'violated', 'کران پایین ویلسونِ ۱۰٪ بالاتر از ۳٪ است')
  assert.equal(thr.verify(mk(100, 4), 0.9, 0.03).verdict, 'unknown', 'نرخ ۴٪ بالاتر از هدف ولی کران پایین زیر هدف')
  assert.equal(thr.verify(mk(5, 0), 0.9, 0.03).verdict, 'unknown', 'نمونهٔ آزمون کم')
})

test('K13. CLI: ممیزی کافی ⇒ آستانه نوشته می‌شود و apply-estimator-config آن را معتبر می‌داند؛ برچسب بازبینی نادیده؛ داده کم ⇒ کد ۳', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thr-'))
  try {
    const script = path.join(__dirname, '..', 'eval', 'market', 'threshold-from-rows.cjs')
    const base = Date.UTC(2026, 9, 1)
    const audit = []
    for (let i = 0; i < 600; i++) {
      const hi = i % 3 !== 0 // ۴۰۰ ردیف پراعتماد (تقریباً بی‌خطا) و ۲۰۰ ردیف کم‌اعتماد (۴۰٪ خطا)
      audit.push({
        decisionId: i + 1,
        createdAt: new Date(base + i * 3600e3).toISOString(),
        pRight: hi ? 0.97 : 0.6,
        pNone: 0,
        heuristic: null,
        floorBound: false,
        label: hi ? (i % 200 === 1 ? 0 : 1) : i % 5 < 2 ? 0 : 1,
        labelSource: 'audit',
      })
    }
    // ۳۰۰ ردیف بازبینیِ «همه نادرست» در ناحیهٔ پراعتماد: اگر به‌اشتباه به‌کار رود نتیجه را نابود می‌کند
    const review = Array.from({ length: 300 }, (_, i) => ({ decisionId: 1000 + i, createdAt: new Date(base + i * 3600e3).toISOString(), pRight: 0.97, pNone: 0, heuristic: null, floorBound: false, label: 0, labelSource: 'review' }))
    const dataFile = path.join(dir, 'rows.json')
    fs.writeFileSync(dataFile, JSON.stringify({ meta: {}, rows: [...audit, ...review] }))
    const run = (...args) => spawnSync(process.execPath, [script, '--data', dataFile, ...args], { encoding: 'utf8' })

    const out = path.join(dir, 'threshold.json')
    const ok = run('--target-error', '0.03', '--write', out)
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    const written = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.equal(written.estimator.minCalibratedConfidence, 0.61)
    assert.equal(written.meta.rowsUsed, 600, 'ردیف‌های بازبینی نباید به‌کار رفته باشند')
    const checked = estCfg.validateEstimatorPatch(written)
    assert.equal(checked.ok, true, checked.errors.join(' | '))
    assert.deepEqual(checked.patch, { minCalibratedConfidence: 0.61 })

    // با --include-review همان داده، آستانه‌ای با اطمینان نمی‌دهد (کد ۴) و فایل نمی‌نویسد
    const out2 = path.join(dir, 'threshold-review.json')
    const bad = run('--target-error', '0.03', '--include-review', '--write', out2)
    assert.equal(bad.status, 4, bad.stdout + bad.stderr)
    assert.equal(fs.existsSync(out2), false)

    // دادهٔ کم ⇒ کد ۳
    fs.writeFileSync(dataFile, JSON.stringify({ rows: audit.slice(0, 50) }))
    const few = run()
    assert.equal(few.status, 3, few.stdout + few.stderr)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('K14. CLI export (pg جعلی): فقط SELECT می‌زند، ممیزی (قیمت و wrong) را اعمال می‌کند و ردیف‌های برچسب‌دار بدون هیچ قیمت/کفی می‌نویسد', () => {
  const list = realResults(6)
  assert.ok(list.length >= 4, 'سناریوی کافی پیدا نشد')
  const decisions = list.map(({ res }, i) => ({
    id: 100 + i,
    status: 'applied',
    finalPrice: res.finalPrice,
    confidence: res.confidence,
    steps: res.steps,
    createdAt: new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toISOString(),
  }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'))
  try {
    const dbFile = path.join(dir, 'db.json')
    // خروجی SQL به‌ترتیب id نزولی است (ORDER BY id DESC)؛ اسکریپت خودش برعکس می‌کند
    fs.writeFileSync(dbFile, JSON.stringify({ profiles: [], decisions: [...decisions].reverse(), logs: [], queries: [] }))
    const auditFile = path.join(dir, 'audit.csv')
    fs.writeFileSync(auditFile, ['decisionId,correctPrice', `100,"${decisions[0].finalPrice}"`, `101,${decisions[1].finalPrice * 2}`, '102,wrong', ''].join('\n'))
    const out = path.join(dir, 'rows.json')
    const r = spawnSync(
      process.execPath,
      ['--require', path.join(__dirname, 'helpers', 'fake-pg-preload.cjs'), path.join(__dirname, '..', 'scripts', 'export-calibration-data.cjs'), '--out', out, '--audit', auditFile, '--since', '2026-10-01', '--limit', '50', '--no-review'],
      { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgres://fake/db', FAKE_PG_FILE: dbFile } },
    )
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /ممیزی: 3 سطر خوانده شد \(2 قیمت درست، 1 نشانهٔ wrong\)/)
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    assert.ok(db.queries.length >= 1 && db.queries.every((q) => /^SELECT /.test(q.sql)), 'export باید فقط‌خواندنی باشد: ' + JSON.stringify(db.queries.map((q) => q.sql)))
    assert.deepEqual(db.queries[0].params, ['2026-10-01', 50])
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'))
    const byId = Object.fromEntries(payload.rows.map((x) => [x.decisionId, x]))
    assert.equal(byId[100].label, 1)
    assert.equal(byId[101].label, 0)
    assert.equal(byId[102].label, 0, 'wrong ⇒ برچسب ۰')
    assert.equal(byId[103], undefined, 'با --no-review و بدون ممیزی برچسب ندارد')
    assert.equal(payload.meta.labelSources.audit, 3)
    const text = JSON.stringify(payload.rows)
    for (const k of ['costPrice', 'hardFloor', 'effectiveCost', 'finalPrice', 'monitoredMarketCeiling']) assert.equal(text.includes(k), false, `ردیف‌ها نباید ${k} داشته باشند`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
