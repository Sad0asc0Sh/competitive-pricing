const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { makeScenarios, pickComparable } = require('./helpers/legacy-scenarios.cjs')

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { assessValidity } = loadTsModule('src/lib/pricing/validity.ts')
const { analyzeDecisionScenarios, calibratedConfidence, DEFAULT_CONFIDENCE_MODEL } = loadTsModule('src/lib/pricing/robustness.ts')
const { hasGuarantee } = loadTsModule('src/lib/pricing/aggregate.ts')
const { computeUndercutDelta } = loadTsModule('src/lib/pricing/strategy.ts')

const now = new Date('2026-10-14T08:00:00Z')
const DAY = 86400000

// ---------------------------------------------------------------------------------------------
// ۱) بازگشت امن (rollback): estimator.mode="legacy" باید دقیقاً خروجی ثبت‌شدهٔ موتور اصلی ۴.۱.۲ را بدهد
// ---------------------------------------------------------------------------------------------
test('E1. rollback: حالت legacy روی ۳۰۰ سناریوی تصادفی تصمیم قیمت را دقیقاً مثل موتور اصلی ۴.۱.۲ می‌دهد', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-4.1.2-snapshot.json'), 'utf8'))
  const scenarios = makeScenarios(fx.n, fx.seed, new Date(fx.now))
  assert.equal(scenarios.length, fx.rows.length)
  const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
  cfg.estimator.mode = 'legacy'

  // تصمیم قیمت (تخمین‌گر): باید بیت‌به‌بیت یکسان باشد.
  // توجه: امتیاز هویت/ناظر به تطبیق‌دهندهٔ محصول (matcher v2) وابسته است که عمداً سخت‌گیرتر شده و جدا از تخمین‌گر برگشت‌پذیر است
  // (نگاه کنید به docs/MATCHER_V2.md)؛ برای همین فقط یک تفاوت کوچک در امتیاز ناظر مجاز است، نه در قیمت.
  const PRICE_FIELDS = ['finalPrice', 'basePrice', 'discountPct', 'strategy', 'confidence', 'isProvisional', 'nationalRank', 'localRank', 'tier']
  const diffs = []
  let sameReview = 0
  scenarios.forEach((sc, i) => {
    const got = pickComparable(runPricingPipeline(sc.source, { ...sc.ctx, config: cfg }))
    const want = fx.rows[i]
    for (const k of PRICE_FIELDS) {
      if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) diffs.push(`#${i}.${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`)
    }
    if (got.needsReview === want.needsReview) sameReview++
  })
  assert.equal(diffs.length, 0, `${diffs.length} اختلاف قیمت با ۴.۱.۲؛ نمونه: ${diffs.slice(0, 5).join(' | ')}`)
  // صف بازبینی: تنها تفاوت‌ها باید از گیت هویت (matcher جدید) باشد، یعنی نسبت کوچک
  assert.ok(sameReview / scenarios.length >= 0.97, `needsReview یکسان فقط در ${sameReview}/${scenarios.length}`)
})

// ---------------------------------------------------------------------------------------------
// ۲) ناوردا‌های ایمنی تخمین‌گر v2 روی همان سناریوها (property-style)
// ---------------------------------------------------------------------------------------------
test('E2. v2 روی ۳۰۰ سناریو: هرگز زیر کف/هزینه نمی‌رود، عدد غیرمعتبر (NaN/∞) نمی‌دهد و گیت اعتماد کالیبره اعمال می‌شود', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-4.1.2-snapshot.json'), 'utf8'))
  const scenarios = makeScenarios(fx.n, fx.seed, new Date(fx.now))
  const cfg = DEFAULT_PROFILE_CONFIG
  assert.equal(cfg.estimator.mode, 'v2')

  let withScenarios = 0
  for (const sc of scenarios) {
    const r = runPricingPipeline(sc.source, { ...sc.ctx, config: cfg })
    // ایمنی سود (خط قرمز اول): هیچ قیمت نهایی‌ای زیر کف یا ≤ هزینه نیست
    if (r.finalPrice != null) {
      assert.ok(Number.isFinite(r.finalPrice) && r.finalPrice > 0, `قیمت نامعتبر #${sc.id}`)
      if (r.supply.hardFloorPrice > 0) assert.ok(r.finalPrice >= r.supply.hardFloorPrice, `زیر کف #${sc.id}: ${r.finalPrice} < ${r.supply.hardFloorPrice}`)
      if (r.supply.effectiveCostPrice > 0) assert.ok(r.finalPrice > r.supply.effectiveCostPrice, `≤ هزینه #${sc.id}`)
    }
    assert.ok(Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1, `اعتماد نامعتبر #${sc.id}: ${r.confidence}`)
    if (r.basePrice != null) assert.ok(Number.isFinite(r.basePrice))
    if (r.decisionScenarios) {
      withScenarios++
      const d = r.decisionScenarios
      for (const x of [d.pRight, d.pTooHigh, d.pTooLow, d.coveredMass, d.pNoneValid]) assert.ok(Number.isFinite(x) && x >= -1e-9 && x <= 1 + 1e-9, `احتمال نامعتبر #${sc.id}`)
      assert.ok(d.pRight + d.pTooHigh + d.pTooLow <= 1 + 1e-6, `مجموع احتمال‌ها >۱ #${sc.id}`)
      for (const s of d.scenarios) assert.ok(s.p >= 0 && s.p <= 1)
      // گیت: اعتماد کالیبره زیر حد → حتماً بازبینی انسانی
      if (r.finalPrice != null && r.confidence < cfg.estimator.minCalibratedConfidence) {
        assert.equal(r.needsReview, true, `اعمال خودکار با اعتماد ${r.confidence} #${sc.id}`)
      }
    }
  }
  assert.ok(withScenarios > 150, `تحلیل سناریو باید روی اغلب سناریوها اجرا شود (${withScenarios})`)
})

test('E3. ورودی‌های لبه‌ای (بدون پیشنهاد، یک پیشنهاد، تاریخ نامعتبر، امتیاز/رأی ناموجود، قیمت NaN) هرگز استثنا یا NaN تولید نمی‌کنند', () => {
  const base = { productId: 1, productName: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', costPrice: 2000000, supplierQuotes: [], config: DEFAULT_PROFILE_CONFIG, now }
  const mk = (offers) => ({ source: 'torob', productTitle: base.productName, offers, totalSellerCount: offers.length, fetchedAt: now, ok: true })
  const cases = [
    [],
    [{ shopName: 'a', price: 2500000, lastChangedAt: now, inStock: true }],
    [{ shopName: 'a', price: 2500000, lastChangedAt: new Date('invalid'), inStock: true }, { shopName: 'b', price: Number.NaN, inStock: true }, { shopName: 'c', price: 2510000 }],
    [{ shopName: 'a', price: 2500000 }, { shopName: 'b', price: 2510000 }, { shopName: 'c', price: 2520000 }, { shopName: 'd', price: 900000 }],
    [{ shopName: 'a', price: 0 }, { shopName: 'b', price: -5 }],
  ]
  for (const offers of cases) {
    const r = runPricingPipeline(mk(offers), base)
    assert.ok(Number.isFinite(r.confidence))
    if (r.finalPrice != null) assert.ok(Number.isFinite(r.finalPrice))
  }
  // منبع ناموفق
  const bad = runPricingPipeline({ source: 'torob', offers: [], totalSellerCount: 0, fetchedAt: now, ok: false, error: 'x' }, base)
  assert.ok(bad)
})

// ---------------------------------------------------------------------------------------------
// ۳) رفع باگ guarantee: "disabled" truthy بود و فروشنده را «اعتماد بالا» می‌کرد
// ---------------------------------------------------------------------------------------------
test('E4. hasGuarantee: حالت strict مقدار "disabled" را ضمانت‌دار نمی‌شمارد؛ حالت قدیمی همان باگ ۴.۱.۲ را حفظ می‌کند', () => {
  for (const g of ['disabled', 'DISABLED', 'false', '0', 'none', '', null, undefined, false, 'غیرفعال', 'ندارد', 'بدون گارانتی']) {
    assert.equal(hasGuarantee(g, true), false, `strict: ${String(g)}`)
  }
  for (const g of ['enabled', 'Enabled', true, 'true', 'فعال', 'گارانتی ۱۸ ماهه']) {
    assert.equal(hasGuarantee(g, true), true, `strict: ${String(g)}`)
  }
  // رفتار قدیمی (legacy) = Boolean(g)
  assert.equal(hasGuarantee('disabled', false), true)
  assert.equal(hasGuarantee('', false), false)
})

// ---------------------------------------------------------------------------------------------
// ۴) مدل اعتبار پیشنهادها (validity v2)
// ---------------------------------------------------------------------------------------------
const mkOffer = (shopName, price, ageDays, extra = {}) => ({
  shopName,
  price,
  included: true,
  weight: 1,
  shopScore: 4.6,
  shopVotes: 120,
  lastChangedAt: new Date(now.getTime() - ageDays * DAY),
  ...extra,
})
const vopts = { freshCutoffDays: 3, highTrustScoreThreshold: 4.5 }
const sumDist = (r) => r.lowestDist.reduce((s, d) => s + d.p, 0)

test('V1. بازار آرام و تازه: لنگر = ارزان‌ترین، همه معتبر، توزیع «ارزان‌ترین معتبر» نرمال است', () => {
  const r = assessValidity([mkOffer('a', 2480000, 0.2), mkOffer('b', 2490000, 0.5), mkOffer('c', 2500000, 1), mkOffer('d', 2470000, 0.1), mkOffer('e', 2510000, 2)], now, vopts)
  assert.equal(r.anchorPrice, 2470000)
  assert.ok(r.pNoneValid < 0.02)
  for (const o of r.sortedOffers) assert.ok(r.perOffer.get(o).p > 0.85)
  assert.ok(Math.abs(sumDist(r) + r.pNoneValid - 1) < 0.02, 'توزیع باید جمعاً ۱ باشد')
})

test('V2. طعمهٔ قیمتی تنها (۴۰٪ زیر بازار، بدون امتیاز) معتبر شمرده نمی‌شود و لنگر نمی‌شود', () => {
  const offers = [mkOffer('a', 2480000, 0.2), mkOffer('b', 2490000, 0.5), mkOffer('c', 2500000, 1), mkOffer('d', 2470000, 0.1), mkOffer('e', 2510000, 2), mkOffer('bait', 1500000, 0.3, { shopScore: null, shopVotes: 0 })]
  const r = assessValidity(offers, now, vopts)
  const bait = offers[5]
  assert.ok(r.perOffer.get(bait).p < 0.1, `p(bait)=${r.perOffer.get(bait).p}`)
  assert.equal(r.anchorPrice, 2470000)
})

test('V3. قیمت پایین «تأییدشده» با دو فروشندهٔ مستقل در همان سطح، بسیار معتبرتر از طعمهٔ تنها است و لنگر می‌شود', () => {
  const body = [mkOffer('a', 2480000, 0.2), mkOffer('b', 2490000, 0.5), mkOffer('c', 2500000, 1), mkOffer('d', 2470000, 0.1), mkOffer('e', 2510000, 2)]
  const lone = assessValidity([...body, mkOffer('low1', 2250000, 0.3)], now, vopts)
  const l1 = [...body, mkOffer('low1', 2250000, 0.3), mkOffer('low2', 2255000, 0.4)]
  const pair = assessValidity(l1, now, vopts)
  const pLone = lone.perOffer.get(lone.sortedOffers[0]).p
  const pPair = pair.perOffer.get(pair.sortedOffers[0]).p
  assert.ok(pPair > pLone, `تأییدیه باید احتمال را بالا ببرد (${pPair} > ${pLone})`)
  assert.ok(pPair > 0.4)
  assert.equal(pair.anchorPrice, 2250000)
})

test('V4. بازار رو به بالا: رانش مثبت برآورد می‌شود و احتمال اعتبار با افزایش سن پیشنهاد (برای قیمت‌های پایین‌تر) یکنوا کاهش می‌یابد', () => {
  const rising = []
  for (let i = 0; i < 12; i++) {
    const age = i * 1.5
    rising.push(mkOffer('s' + i, Math.round(2500000 * (1 - 0.004 * age)), age))
  }
  const r = assessValidity(rising, now, vopts)
  assert.ok(r.driftPerDay > 0.001, `drift=${r.driftPerDay}`)
  const byAge = r.sortedOffers.map((o) => ({ age: r.perOffer.get(o).ageDays, p: r.perOffer.get(o).p })).sort((x, y) => x.age - y.age)
  for (let i = 1; i < byAge.length; i++) assert.ok(byAge[i].p <= byAge[i - 1].p + 1e-9, 'p باید با سن کاهش یابد')
  assert.ok(byAge[0].p > 0.9)
  assert.ok(byAge[byAge.length - 1].p < 0.8)
})

test('V5. ورودی خالی/تک‌پیشنهاد/بدون تاریخ و تاریخ نامعتبر: بدون NaN و با احتمال‌های معتبر', () => {
  const empty = assessValidity([], now, vopts)
  assert.equal(empty.anchorPrice, null)
  assert.equal(empty.pNoneValid, 1)

  const single = assessValidity([mkOffer('a', 2480000, 0.2)], now, vopts)
  assert.equal(single.anchorPrice, 2480000)

  const odd = [
    { shopName: 'a', price: 2480000, included: true, weight: 1 },
    { shopName: 'b', price: 2490000, included: true, weight: 1 },
    { shopName: 'c', price: 2500000, included: true, weight: 1 },
    { shopName: 'd', price: 1800000, included: true, weight: 1, lastChangedAt: new Date('invalid') },
  ]
  const r = assessValidity(odd, now, vopts)
  for (const o of r.sortedOffers) {
    const v = r.perOffer.get(o)
    for (const x of [v.p, v.pFresh, v.pReal, v.pAnomaly, v.depth, v.corroboration]) assert.ok(Number.isFinite(x), 'NaN در گزارش اعتبار')
    assert.ok(v.p >= 0 && v.p <= 1)
  }
  assert.ok(Number.isFinite(r.sigma) && Number.isFinite(r.driftPerDay))
})

// ---------------------------------------------------------------------------------------------
// ۵) تحلیل پایداری تصمیم (robustness)
// ---------------------------------------------------------------------------------------------
function fakeReport() {
  const o = (shopName, price) => ({ shopName, price, included: true, weight: 1 })
  const A = o('A', 2300000)
  const B = o('B', 2400000)
  const C = o('C', 2450000)
  const D = o('D', 2600000)
  const perOffer = new Map([
    [A, { p: 0.4 }],
    [B, { p: 0.9 }],
    [C, { p: 0.9 }],
    [D, { p: 0.9 }],
  ])
  return {
    A, B, C, D,
    report: {
      sortedOffers: [A, B, C, D],
      lowestDist: [
        { price: 2300000, p: 0.4 },
        { price: 2400000, p: 0.35 },
        { price: 2450000, p: 0.2 },
        { price: 2600000, p: 0.02 },
      ],
      pNoneValid: 0.03,
      perOffer,
    },
  }
}
const undercutDecide = (included) => ({ finalPrice: Math.min(...[...included].map((x) => x.price)) - 1000, strategy: 'test' })

test('R1. پایداری تصمیم: فرض‌ها اجرا می‌شوند؛ pRight فقط جرم فرض‌های هم‌قیمت است و جایگزین محتمل‌ترین ناهمخوان است', () => {
  const { report } = fakeReport()
  const a = analyzeDecisionScenarios(report, 2299000, () => true, undercutDecide)
  assert.equal(a.scenarios.length, 3) // فرض با p=۰٫۰۲ زیر minScenarioP=۰٫۰۳ حذف می‌شود
  assert.ok(Math.abs(a.pRight - 0.4) < 1e-9)
  assert.ok(Math.abs(a.pTooLow - 0.55) < 1e-9) // اگر ارزان‌ترین معتبر B/C باشد ما بی‌دلیل ارزان‌ایم
  assert.equal(a.pTooHigh, 0)
  assert.ok(Math.abs(a.coveredMass - 0.95) < 1e-9)
  assert.deepEqual(a.alternative, { finalPrice: 2399000, p: 0.35, lowestPrice: 2400000, shopName: 'B' })

  // برعکس: ما گران‌تر از فرض‌های بدبینانه
  const hi = analyzeDecisionScenarios(report, 2449000, () => true, undercutDecide)
  assert.ok(Math.abs(hi.pTooHigh - 0.75) < 1e-9) // k=0 (۰٫۴) و k=1 (۰٫۳۵: +۲٫۰۸٪ > ۲٪)
  assert.ok(Math.abs(hi.pRight - 0.2) < 1e-9)
})

test('R2. eligible پیشنهادهای ناشایسته را از هر فرضی بیرون می‌گذارد؛ maxScenarios و minScenarioP رعایت می‌شوند', () => {
  const { report, D } = fakeReport()
  const seen = []
  const spy = (inc) => {
    seen.push(new Set(inc))
    return undercutDecide(inc)
  }
  analyzeDecisionScenarios(report, 2299000, (x) => x !== D, spy)
  for (const s of seen) assert.ok(!s.has(D), 'پیشنهاد غیرمجاز نباید وارد فرض شود')

  const one = analyzeDecisionScenarios(report, 2299000, () => true, undercutDecide, { maxScenarios: 1 })
  assert.equal(one.scenarios.length, 1)
  assert.equal(one.scenarios[0].shopName, 'A')
  assert.ok(Math.abs(one.pRight - 0.4) < 1e-9)

  const none = analyzeDecisionScenarios(report, 2299000, () => true, undercutDecide, { minScenarioP: 0.9 })
  assert.equal(none.scenarios.length, 0)
  assert.equal(none.pRight, 0) // جرم ارزیابی‌نشده «نادرست» حساب می‌شود (محافظه‌کارانه)
  assert.equal(none.alternative, null)
})

test('R3. فرضی که موتور برایش قیمت نمی‌دهد (finalPrice=null) هرگز در pRight شمرده نمی‌شود', () => {
  const { report } = fakeReport()
  const a = analyzeDecisionScenarios(report, 2299000, () => true, () => ({ finalPrice: null, strategy: 'none' }))
  assert.equal(a.pRight, 0)
  assert.equal(a.pTooHigh, 0)
  assert.equal(a.pTooLow, 0)
})

// ---------------------------------------------------------------------------------------------
// ۶) اعتماد کالیبره
// ---------------------------------------------------------------------------------------------
test('C1. calibratedConfidence: پیش‌فرض هویت است، یکنوا در pRight، حدود امن، ورودی نامعتبر → ۰', () => {
  assert.deepEqual(DEFAULT_CONFIDENCE_MODEL, { intercept: 0, wLogitRight: 1, wHeuristic: 0, wNoneValid: 0, wFloorBound: 0 })
  const f = (pRight, extra = {}) => calibratedConfidence(undefined, { pRight, heuristic: 0.5, pNoneValid: 0, floorBound: false, ...extra })
  assert.ok(Math.abs(f(0.8) - 0.8) < 1e-3)
  assert.ok(Math.abs(f(0.5) - 0.5) < 1e-3)
  let prev = -1
  for (const p of [0, 0.05, 0.2, 0.5, 0.8, 0.95, 1]) {
    const c = f(p)
    assert.ok(c >= prev, 'باید یکنوا باشد')
    assert.ok(c >= 0.01 && c <= 0.99, `حدود: ${c}`)
    prev = c
  }
  assert.equal(f(Number.NaN), 0)
  // ضرایب برازش‌شده اثر می‌گذارند
  const shifted = calibratedConfidence({ intercept: -1 }, { pRight: 0.8, heuristic: 0.5, pNoneValid: 0, floorBound: false })
  assert.ok(shifted < f(0.8))
  const floor = calibratedConfidence({ wFloorBound: 1 }, { pRight: 0.5, heuristic: 0.5, pNoneValid: 0, floorBound: true })
  assert.ok(floor > 0.5)
})

// ---------------------------------------------------------------------------------------------
// ۷) پرچم‌های سیاستی تخمین‌گر (هر کدام جدا قابل‌خاموش‌کردن است)
// ---------------------------------------------------------------------------------------------
const NAME = 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T'
const off = (shopName, price, ageDays, city = 'تهران', score = 4.7) => ({
  shopName,
  shopCity: city,
  price,
  lastChangedAt: new Date(now.getTime() - ageDays * DAY),
  inStock: true,
  shopScore: score,
  shopVotes: 200,
})
function runWith(offers, cost, mut, meta) {
  const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
  if (mut) mut(cfg)
  return runPricingPipeline(
    { source: 'torob', productTitle: NAME, offers, totalSellerCount: offers.length, fetchedAt: now, ok: true, ...(meta ? { meta } : {}) },
    { productId: 1, productName: NAME, costPrice: cost, supplierQueries: undefined, supplierQuotes: [], config: cfg, now },
  )
}

test('F1. chaseConfirmedLow: قاعدهٔ فاصلهٔ ۱۲٪ برای کف «تأییدشده» دور زده می‌شود (برچسب استراتژی)؛ خاموش → رفتار قدیمی', () => {
  const gap = [off('low1', 2000000, 0.2), off('low2', 2010000, 0.3, 'اصفهان'), off('m1', 2400000, 0.2), off('m2', 2420000, 0.4), off('m3', 2440000, 1), off('m4', 2450000, 0.6), off('m5', 2480000, 0.5), off('m6', 2500000, 1.5)]
  const on = runWith(gap, 1700000)
  const offFlag = runWith(gap, 1700000, (c) => {
    c.estimator.chaseConfirmedLow = false
  })
  assert.equal(on.strategy, 'national_rank1_undercut')
  assert.equal(offFlag.strategy, 'national_cluster_rank1')
  assert.equal(on.finalPrice, 1999000)
})

test('F2. truncationAware: وقتی خروجی ترب بریده شده، «انحصار محلی» (غیابِ رقیب مشهد) ادعا نمی‌شود و به بازبینی می‌رود', () => {
  const offers = [off('l1', 2000000, 0.2), off('l2', 2030000, 0.3), off('h1', 2450000, 0.2), off('h2', 2460000, 0.3), off('h3', 2480000, 0.4), off('h4', 2500000, 0.5), off('h5', 2520000, 0.5)]
  const noCluster = (c) => {
    c.rank1.competeInReachableCluster = false
  }
  const full = runWith(offers, 2300000, noCluster)
  assert.equal(full.strategy, 'local_monopoly_leader')
  assert.equal(full.needsReview, false)

  const cut = runWith(offers, 2300000, noCluster, { offersTruncated: true })
  assert.notEqual(cut.strategy, 'local_monopoly_leader')
  assert.equal(cut.needsReview, true)

  // خاموش‌کردن پرچم یا legacy رفتار قبلی را برمی‌گرداند
  const flagOff = runWith(offers, 2300000, (c) => {
    noCluster(c)
    c.estimator.truncationAware = false
  }, { offersTruncated: true })
  assert.equal(flagOff.strategy, 'local_monopoly_leader')
})

test('F3. اعتماد کالیبره: زیر حد minCalibratedConfidence همیشه به بازبینی می‌رود و بالای آن می‌تواند خودکار باشد', () => {
  const clean = [off('a', 2480000, 0.2), off('b', 2490000, 0.5), off('c', 2500000, 1), off('d', 2470000, 0.1), off('e', 2510000, 2)]
  const ok = runWith(clean, 2000000)
  assert.ok(ok.confidence >= DEFAULT_PROFILE_CONFIG.estimator.minCalibratedConfidence)
  assert.equal(ok.needsReview, false)

  // لنگر مشکوک: فروشندهٔ پایین بدون تأییدیه → احتمال درستی پایین → بازبینی با قیمت جایگزین در دلیل
  const doubtful = [...clean, off('lone', 2150000, 0.3, 'تهران', 3.9)]
  const r = runWith(doubtful, 2000000)
  if (r.confidence < DEFAULT_PROFILE_CONFIG.estimator.minCalibratedConfidence) {
    assert.equal(r.needsReview, true)
    assert.ok(r.reviewReasons.some((x) => x.includes('اعتماد کالیبره')))
  }

  // اگر حد را ۰ کنند گیت برداشته می‌شود (اپراتور کنترل دارد)
  const relaxed = runWith(doubtful, 2000000, (c) => {
    c.estimator.minCalibratedConfidence = 0
  })
  assert.ok(!relaxed.reviewReasons.some((x) => x.includes('اعتماد کالیبره')))
})

test('F4. computeUndercutDelta: پله‌های undercut بر اساس سطح قیمت', () => {
  const cfg = DEFAULT_PROFILE_CONFIG.rank1
  const a = computeUndercutDelta(1500000, cfg)
  const b = computeUndercutDelta(25000000, cfg)
  assert.ok(a >= 1 && b >= a, `${a} ≤ ${b}`)
  assert.equal(Number.isInteger(a) && Number.isInteger(b), true)
})
