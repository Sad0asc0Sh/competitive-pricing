'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/test'

const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { installFakeTorob, mcpOffer } = require('./helpers/fake-torob-mcp.cjs')

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { detectIsolatedLiquidationOffers } = loadTsModule('src/lib/pricing/liquidation.ts')
const { summarizeMarket } = loadTsModule('src/lib/pricing/aggregate.ts')
const { buildDiscount, pickDiscountReference } = loadTsModule('src/lib/pricing/discount.ts')
const {
  evaluateSystemOneSupervisorSync,
  enrichSupervisorWithSubqApi,
  formatSupervisorRejectMessage,
} = loadTsModule('src/lib/pricing/systemone-supervisor.ts')
const { buildSgeoooleRequestPayload } = loadTsModule('src/lib/store/connectors.ts')
const { invalidateAIConfigCache, resolveSubqRuntime } = loadTsModule('src/lib/ai/config.ts')
const { verifyTorobMatchesWithAI } = loadTsModule('src/lib/ai/client.ts')
const mcpClient = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { pool } = loadTsModule('src/db/index.ts')

const NOW = new Date('2026-10-24T09:00:00.000Z')

function makeConfig(overrides = {}) {
  const base = structuredClone(DEFAULT_PROFILE_CONFIG)
  return {
    ...base,
    ...overrides,
    outliers: { ...base.outliers, ...(overrides.outliers || {}) },
    aggregation: { ...base.aggregation, ...(overrides.aggregation || {}) },
    rank1: { ...base.rank1, ...(overrides.rank1 || {}) },
    margin: { ...base.margin, ...(overrides.margin || {}) },
    guards: { ...base.guards, ...(overrides.guards || {}) },
    discount: { ...base.discount, ...(overrides.discount || {}) },
    supervisor: { ...base.supervisor, ...(overrides.supervisor || {}) },
    costless: { ...base.costless, ...(overrides.costless || {}) },
    estimator: { ...base.estimator, ...(overrides.estimator || {}) },
  }
}

function makeEvalOffer({
  shopName,
  shopId,
  price,
  city = 'تهران',
  score = 4.7,
  ageHours = 4,
  weight = 1,
  credible = true,
  included = true,
}) {
  return {
    shopName,
    shopId: shopId || shopName,
    shopCity: city,
    sellerType: 'online',
    shopScore: score,
    shopVotes: 80,
    isLocalCity: city === 'مشهد',
    priceUnreliable: false,
    price,
    deliveredPrice: price,
    lastChangedAt: new Date(NOW.getTime() - ageHours * 3600 * 1000),
    isAd: false,
    inStock: true,
    guarantee: 'enabled',
    included,
    weight,
    credible,
    freshHours: ageHours,
  }
}

function makeRawOffer({ shop, city = 'تهران', price, score = 4.7, ageDays = 0.2 }) {
  return {
    shopName: shop,
    shopId: shop,
    shopCity: city,
    sellerType: 'online',
    shopScore: score,
    shopVotes: 90,
    price,
    deliveredPrice: price,
    lastChangedAt: new Date(NOW.getTime() - ageDays * 86400000),
    isAd: false,
    inStock: true,
    priceUnreliable: false,
    guarantee: 'enabled',
  }
}

test('L1. detectIsolatedLiquidationOffers: تک‌فروشنده حراجی با فاصله پله‌ای و بدنه‌ای حذف می‌شود', () => {
  const offers = [
    makeEvalOffer({ shopName: 'فروشنده حراجی', price: 2050000 }),
    makeEvalOffer({ shopName: 'بازار الف', price: 2450000 }),
    makeEvalOffer({ shopName: 'بازار ب', price: 2480000 }),
    makeEvalOffer({ shopName: 'بازار ج', price: 2510000 }),
    makeEvalOffer({ shopName: 'بازار د', price: 2540000 }),
  ]
  const res = detectIsolatedLiquidationOffers(offers, { effectiveCostPrice: 1900000 })
  assert.equal(res.excluded.length, 1)
  assert.equal(res.excluded[0].shopName, 'فروشنده حراجی')
  assert.equal(offers[0].included, false)
  assert.equal(offers[0].cls, 'liquidation_low')
  assert.equal(offers[1].included, true)
})

test('L2. detectIsolatedLiquidationOffers: دامپینگ زیر هزینه تمام‌شده توسط تک‌فروشنده کنار گذاشته می‌شود', () => {
  const offers = [
    makeEvalOffer({ shopName: 'نقدکننده انبار', price: 2150000 }),
    makeEvalOffer({ shopName: 'بازار ۱', price: 2300000 }),
    makeEvalOffer({ shopName: 'بازار ۲', price: 2350000 }),
    makeEvalOffer({ shopName: 'بازار ۳', price: 2400000 }),
  ]
  const res = detectIsolatedLiquidationOffers(offers, { effectiveCostPrice: 2180000 })
  assert.equal(res.excluded.length, 1)
  assert.equal(res.excluded[0].belowCostDumping, true)
  assert.equal(offers[0].included, false)
  assert.equal(offers[0].cls, 'liquidation_low')
})

test('L3. کف بازار با ۲ فروشنده مستقل حفظ می‌شود و در v2 تک‌فروشنده حراجی قیمت را نمی‌شکند', () => {
  const corroborated = [
    makeEvalOffer({ shopName: 'فروشنده ۱', shopId: 's1', price: 2050000 }),
    makeEvalOffer({ shopName: 'فروشنده ۲', shopId: 's2', price: 2080000 }),
    makeEvalOffer({ shopName: 'بازار الف', shopId: 's3', price: 2450000 }),
    makeEvalOffer({ shopName: 'بازار ب', shopId: 's4', price: 2480000 }),
    makeEvalOffer({ shopName: 'بازار ج', shopId: 's5', price: 2520000 }),
  ]
  const corrRes = detectIsolatedLiquidationOffers(corroborated, { effectiveCostPrice: 1950000 })
  assert.equal(corrRes.excluded.length, 0)
  assert.equal(corroborated[0].included, true)

  const cfg = makeConfig({
    estimator: { mode: 'v2' },
    supervisor: { ...DEFAULT_PROFILE_CONFIG.supervisor, enabled: false },
  })
  const source = {
    source: 'torob',
    ok: true,
    prk: 'liq-test',
    productTitle: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    totalSellerCount: 6,
    fetchedAt: NOW,
    offers: [
      makeRawOffer({ shop: 'حراج‌فروش تک', price: 2220000 }),
      makeRawOffer({ shop: 'رقابت ۱', price: 2680000 }),
      makeRawOffer({ shop: 'رقابت ۲', price: 2710000 }),
      makeRawOffer({ shop: 'رقابت ۳', price: 2750000 }),
      makeRawOffer({ shop: 'رقابت ۴', price: 2790000 }),
    ],
  }
  const result = runPricingPipeline(source, {
    productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    sku: 'DS-2CD1023G0E-I',
    costPrice: 2300000,
    supplierQuotes: [],
    config: cfg,
    now: NOW,
  })
  const liqStep = result.steps.find((s) => s.step === 'liquidation_guard')
  assert.ok(liqStep, 'گزارش فیلتر فروشنده منفرد نقدکننده باید ثبت شود')
  assert.ok(result.finalPrice >= 2600000, `نباید دنبال تک‌فروشنده حراجی ۲٫۲۲ میلیونی برود: got ${result.finalPrice}`)
})

test('D1. خاموش بودن تخفیف نمایشی (discount.enabled=false): خروجی بدون خط‌خورده، بدون هشدار و گیت ۴ امتیاز ۱۰۰', () => {
  const cfg = makeConfig({
    estimator: { mode: 'v2' },
    discount: { enabled: false },
  })
  const source = {
    source: 'torob',
    ok: true,
    prk: 'disc-off',
    productTitle: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    totalSellerCount: 8,
    fetchedAt: NOW,
    offers: [
      makeRawOffer({ shop: 'فروشگاه ۱', price: 2550000 }),
      makeRawOffer({ shop: 'فروشگاه ۲', price: 2580000 }),
      makeRawOffer({ shop: 'فروشگاه ۳', price: 2620000 }),
      makeRawOffer({ shop: 'فروشگاه ۴', price: 2660000 }),
      makeRawOffer({ shop: 'فروشگاه ۵', price: 2700000 }),
    ],
  }
  const res = runPricingPipeline(source, {
    productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    sku: 'DS-2CD1023G0E-I',
    costPrice: 2200000,
    supplierQuotes: [],
    config: cfg,
    now: NOW,
  })
  assert.equal(res.discountPct, 0)
  assert.equal(res.basePrice, res.finalPrice)
  assert.equal(res.supervisor.gates.ceiling_discount_validity.scorePct, 100)
  assert.equal(res.supervisor.gates.ceiling_discount_validity.verdict, 'approve')
  assert.equal(
    res.reviewReasons.some((r) => r.includes('تخفیف واقعی روی کف ممکن نشد')),
    false,
    `نباید هشدار جعلی ۰٪ تخفیف ثبت شود: ${JSON.stringify(res.reviewReasons)}`,
  )
})

test('D2. اولویت مرجع تخفیف نمایشی: market_first سقف بازار را بر قیمت خودی پایین‌تر ترجیح می‌دهد', () => {
  const offers = [
    makeEvalOffer({ shopName: 'A', price: 2500000 }),
    makeEvalOffer({ shopName: 'B', price: 2700000 }),
    makeEvalOffer({ shopName: 'C', price: 2900000 }),
    makeEvalOffer({ shopName: 'D', price: 3000000 }),
    makeEvalOffer({ shopName: 'E', price: 3100000 }),
  ]
  const opts = {
    hasOwnPriceHistory: true,
    ownStableHigh7d: 2620000,
  }
  const ownFirstRef = pickDiscountReference(
    2480000,
    offers,
    { ...DEFAULT_PROFILE_CONFIG.discount, referencePriority: 'own_price_first' },
    opts,
  )
  const marketFirstRef = pickDiscountReference(
    2480000,
    offers,
    { ...DEFAULT_PROFILE_CONFIG.discount, referencePriority: 'market_first' },
    opts,
  )
  assert.equal(ownFirstRef.kind, 'own_price_7d')
  assert.equal(marketFirstRef.kind, 'market_p75')
  assert.ok((marketFirstRef.refPrice ?? 0) > (ownFirstRef.refPrice ?? 0))

  const discOut = buildDiscount(
    2480000,
    offers,
    { ...DEFAULT_PROFILE_CONFIG.discount, referencePriority: 'market_first' },
    DEFAULT_PROFILE_CONFIG.rounding,
    opts,
  )
  assert.ok(discOut.discountPct >= 10 && discOut.basePrice > discOut.finalPrice)
})

test('D3. buildSgeoooleRequestPayload: تخفیف نمایشی در campaignType=none نیز به فروشگاه منتقل می‌شود', () => {
  const payload = buildSgeoooleRequestPayload({
    productId: 10,
    sku: 'CAM-NONE',
    storeExternalId: 'KY-10',
    effectiveCostPrice: 2100000,
    hardFloorPrice: 2200000,
    basePrice: 2840000,
    finalPrice: 2500000,
    discountPct: 12,
    campaignType: 'none',
    decisionId: 99,
    confidence: 0.92,
  })
  assert.equal(payload.price, 2840000)
  assert.equal(payload.compareAtPrice, 2840000)
  assert.equal(payload.discount, 12)
  assert.equal(payload.finalPrice, 2500000)
  assert.equal(payload.campaignType, 'none')
})

test('S1. پیام شفاف وتوی ناظر برای کارت ۶۹٪ و غیرکشنده بودن گیت ۴ (ceiling_discount_validity)', () => {
  const msg = formatSupervisorRejectMessage({
    overallScorePct: 69,
    rejectBelowPct: 45,
    gates: {
      identity_match: {
        key: 'identity_match',
        title: 'گیت ۱: تطابق هویت کالا',
        scorePct: 30,
        verdict: 'reject',
        noul: 0.3,
        rejectBelowPct: 45,
        approveAbovePct: 80,
        weight: 0.3,
        reason: 'نامرتبط',
      },
      market_data_integrity: {
        key: 'market_data_integrity',
        title: 'گیت ۲',
        scorePct: 90,
        verdict: 'approve',
        noul: 0.9,
        rejectBelowPct: 45,
        approveAbovePct: 80,
        weight: 0.25,
        reason: 'ok',
      },
    },
  })
  assert.ok(!msg.includes('69% < 45%'), 'پیام غلط ۶۹٪ < ۴۵٪ نباید ساخته شود')
  assert.ok(msg.includes('وتوی گیت حیاتی') && msg.includes('گیت ۱') && msg.includes('69%'))

  // گیت ۴ خراب (basePrice < finalPrice -> 20%) در حالی که ۳ گیت حیاتی سالم‌اند => باید review شود نه reject
  const cfg = makeConfig({
    supervisor: { ...DEFAULT_PROFILE_CONFIG.supervisor, strictGateVeto: true, rejectBelowPct: 45, approveAbovePct: 80 },
  })
  const offers = [
    makeEvalOffer({ shopName: 'ف۱', price: 2550000 }),
    makeEvalOffer({ shopName: 'ف۲', price: 2580000 }),
    makeEvalOffer({ shopName: 'ف۳', price: 2610000 }),
    makeEvalOffer({ shopName: 'ف۴', price: 2650000 }),
  ]
  const supReport = evaluateSystemOneSupervisorSync({
    productName: 'دوربین داهوا 2MP مدل DH-HAC-HFW1200RP',
    source: { source: 'torob', ok: true, offers: [], totalSellerCount: 8, fetchedAt: NOW },
    offers,
    supply: {
      costSource: 'manual_cost',
      effectiveCostPrice: 2200000,
      baseBuyPrice: 2200000,
      overheadAmount: 0,
      hardFloorPrice: 2310000,
      minMarginPctUsed: 5,
      minProfitAmountUsed: 0,
      validQuotesCount: 0,
      selectedQuote: null,
      costPolicyUsed: 'replacement_floor',
      usedMarketConsensusFloor: false,
      warnings: [],
      explanation: 'ok',
    },
    position: {
      projectedNationalRank: 1,
      projectedLocalRank: 1,
      totalNationalValid: 4,
      totalLocalValid: 0,
      competitionTier: 'national_rank1_undercut',
      explanation: 'ok',
    },
    floorCeiling: {
      basePrice: 2400000,
      finalPrice: 2540000,
      discountPct: 10,
      referencePrice: 2800000,
      referenceKind: 'market_p75',
      monitoredCeiling: 2800000,
      monitoredFloor: 2550000,
      monitoredSellersCount: 4,
      floorConfirmed: false,
    },
    identityMatchScorePct: 92,
    selfShopInListing: false,
    finalPrice: 2540000,
    basePrice: 2400000, // basePrice < finalPrice => Gate 4 scores 20% (reject on gate)
    discountPct: 10,
    dispersion: 0.03,
    config: cfg,
  })
  assert.equal(supReport.gates.ceiling_discount_validity.verdict, 'reject')
  assert.equal(supReport.verdict, 'review', 'گیت ۴ نمایشی نباید تصمیم کل را reject کند')
})

test('S2. enrichSupervisorWithSubqApi فقط تطابق هویت را به SubQ می‌فرستد و قیمت/سود را دستکاری نمی‌کند', async () => {
  const cfg = makeConfig({
    estimator: { mode: 'v2' },
    supervisor: {
      ...DEFAULT_PROFILE_CONFIG.supervisor,
      enabled: true,
      mode: 'hybrid_subq_and_local',
      apiKey: 'subq-test-key',
      baseUrl: 'https://subq.test/v1',
    },
  })
  const source = {
    source: 'torob',
    ok: true,
    prk: 'subq-id',
    productTitle: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    totalSellerCount: 8,
    fetchedAt: NOW,
    offers: [
      makeRawOffer({ shop: 'س۱', price: 2550000 }),
      makeRawOffer({ shop: 'س۲', price: 2580000 }),
      makeRawOffer({ shop: 'س۳', price: 2620000 }),
      makeRawOffer({ shop: 'س۴', price: 2660000 }),
      makeRawOffer({ shop: 'س۵', price: 2700000 }),
    ],
  }
  const baseRes = runPricingPipeline(source, {
    productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    sku: 'DS-2CD1023G0E-I',
    costPrice: 2200000,
    supplierQuotes: [],
    config: cfg,
    now: NOW,
  })
  const origProfitScore = baseRes.supervisor.gates.profit_and_rank_safety.scorePct
  const origDiscountScore = baseRes.supervisor.gates.ceiling_discount_validity.scorePct
  const origMarketScore = baseRes.supervisor.gates.market_data_integrity.scorePct

  const origFetch = globalThis.fetch
  const captured = []
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(
      JSON.stringify({
        answers: {
          identity_match: { noul: 0.98 },
          profit_and_rank_safety: { noul: 0.02 },
          ceiling_discount_validity: { noul: 0.02 },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const enriched = await enrichSupervisorWithSubqApi(baseRes.supervisor, cfg.supervisor)
    assert.equal(captured.length, 1)
    const reqBody = captured[0].body
    assert.deepEqual(Object.keys(reqBody.questions), ['identity_match'])
    for (const line of String(reqBody.state).split('\n').filter(Boolean)) {
      assert.ok(line.startsWith('Product:') || line.startsWith('TorobListing:'), `خط غیرهویتی ارسال شد: ${line}`)
    }
    assert.equal(enriched.gates.profit_and_rank_safety.scorePct, origProfitScore)
    assert.equal(enriched.gates.ceiling_discount_validity.scorePct, origDiscountScore)
    assert.equal(enriched.gates.market_data_integrity.scorePct, origMarketScore)
    assert.ok(enriched.gates.identity_match.scorePct >= 90)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('S3. resolveSubqRuntime وقتی subq_config در دیتابیس enabled=false باشد کلید خالی برمی‌گرداند', async () => {
  const origQuery = pool.query.bind(pool)
  const origEnvKey = process.env.SUBQ_API_KEY
  pool.query = async () => ({ rows: [{ value: { enabled: false, apiKey: 'db-secret' } }] })
  process.env.SUBQ_API_KEY = 'env-secret'
  invalidateAIConfigCache()
  try {
    const rt = await resolveSubqRuntime({
      ...DEFAULT_PROFILE_CONFIG.supervisor,
      apiKey: 'profile-secret',
    })
    assert.equal(rt.apiKey, '')
  } finally {
    pool.query = origQuery
    if (origEnvKey === undefined) delete process.env.SUBQ_API_KEY
    else process.env.SUBQ_API_KEY = origEnvKey
    invalidateAIConfigCache()
  }
})

test('A1. verifyTorobMatchesWithAI محرمانگی و حذف PRK جعلی را رعایت می‌کند و MCP چند پنل ادغام را ادغام می‌نماید', async () => {
  const origQuery = pool.query.bind(pool)
  const origKey = process.env.AI_API_KEY
  const origBase = process.env.AI_BASE_URL
  pool.query = async () => ({ rows: [] })
  process.env.AI_API_KEY = 'sk-test-ai-identity'
  process.env.AI_BASE_URL = 'https://ai.test/v1'
  invalidateAIConfigCache()

  const aiPayloads = []
  const card = (prk, fa, en, price = 2500000, n = 5) => ({
    prk,
    name_fa: fa,
    name_en: en,
    price_toman: price,
    available: true,
    shop_name: `در ${n} فروشگاه`,
    shop_count: n,
    url: `https://torob.com/p/${prk}/`,
    details_url: `https://api.torob.com/v4/base-product/details/?prk=${prk}`,
  })
  const P1 = card('p1', 'دوربین مداربسته بولت هایک ویژن DS-2CD1023G0E-I', 'Hikvision DS-2CD1023G0E-I', 2500000, 4)
  const P2 = card('p2', 'دوربین شبکه بولت هایک‌ویژن مدل DS-2CD1023G0E-I 2MP', null, 2520000, 3)
  const BAD = card('bad', 'پایه دوربین هایک ویژن DS-1280ZJ-DM18', 'Hikvision Bracket', 350000, 5)

  const fakeTorob = installFakeTorob({
    search: () => [P1, P2, BAD],
    details: {
      p1: {
        prk: 'p1',
        name_fa: P1.name_fa,
        name_en: P1.name_en,
        cheapest_price_toman: 2500000,
        available: true,
        offers: [
          mcpOffer({ shop: 'فروشگاه اول', price: 2500000 }),
          mcpOffer({ shop: 'فروشگاه مشترک', price: 2530000 }),
        ],
      },
      p2: {
        prk: 'p2',
        name_fa: P2.name_fa,
        name_en: P2.name_en,
        cheapest_price_toman: 2520000,
        available: true,
        offers: [
          mcpOffer({ shop: 'فروشگاه مشترک', price: 2540000 }),
          mcpOffer({ shop: 'فروشگاه دوم پنل دو', price: 2560000 }),
        ],
      },
    },
  })

  const torobFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/chat/completions')) {
      aiPayloads.push(JSON.parse(init.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: 'match',
                  primaryPrk: 'p1',
                  matchedPrks: ['p1', 'p2', 'hallucinated_prk'],
                  rejectedPrks: ['bad', 'fake_prk'],
                  reasoning: 'هر دو پنل متعلق به دوربین DS-2CD1023G0E-I هستند',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return torobFetch(url, init)
  }

  try {
    const directRes = await verifyTorobMatchesWithAI({
      productName: 'دوربین هایک ویژن DS-2CD1023G0E-I',
      sku: 'DS-2CD1023G0E-I',
      category: 'دوربین مداربسته',
      candidates: [
        { prk: 'p1', titleFa: P1.name_fa, titleEn: P1.name_en, sellerCount: 4, priceToman: 2500000 },
        { prk: 'p2', titleFa: P2.name_fa, sellerCount: 3, priceToman: 2520000 },
        { prk: 'bad', titleFa: BAD.name_fa, sellerCount: 5, priceToman: 350000 },
      ],
    })
    assert.ok(directRes)
    assert.equal(directRes.verdict, 'match')
    assert.deepEqual(directRes.matchedPrks, ['p1', 'p2'])
    assert.deepEqual(directRes.rejectedPrks, ['bad'])
    const sentStr = JSON.stringify(aiPayloads[0])
    assert.ok(!sentStr.includes('costPrice') && !sentStr.includes('hardFloor') && !sentStr.includes('marginPct'))

    const mcpOut = await mcpClient.fetchViaTorobMcpServer({
      mcpUrl: 'http://fake-torob',
      productName: 'دوربین هایک ویژن DS-2CD1023G0E-I',
      sku: 'DS-2CD1023G0E-I',
      now: NOW,
    })
    assert.ok(mcpOut && mcpOut.ok)
    assert.deepEqual(mcpOut.meta.mergedPanelPrks, ['p1', 'p2'])
    assert.equal(mcpOut.offers.length, 3, 'فروشگاه مشترک نباید تکراری ذخیره شود و ۲+۱=۳ فروشنده یکتا بماند')
    assert.equal(mcpOut.offers.find((o) => o.shopName === 'فروشگاه مشترک')?.price, 2530000)
  } finally {
    fakeTorob.restore()
    pool.query = origQuery
    if (origKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = origKey
    if (origBase === undefined) delete process.env.AI_BASE_URL
    else process.env.AI_BASE_URL = origBase
    invalidateAIConfigCache()
  }
})

test('M1 & P1. پشتیبانی trimmed_weighted_mean، پیش‌فرض نظارت انسانی، و fallback کالاهای بی‌هزینه v2', () => {
  const offers = [
    makeEvalOffer({ shopName: 'S1', price: 2000000, weight: 0.1 }),
    makeEvalOffer({ shopName: 'S2', price: 2500000, weight: 1.0 }),
    makeEvalOffer({ shopName: 'S3', price: 2550000, weight: 1.0 }),
    makeEvalOffer({ shopName: 'S4', price: 2600000, weight: 1.0 }),
    makeEvalOffer({ shopName: 'S5', price: 4500000, weight: 1.0 }),
  ]
  const trimSummary = summarizeMarket(
    offers,
    { ...DEFAULT_PROFILE_CONFIG.aggregation, method: 'trimmed_weighted_mean', trimPct: 0.2 },
    'مشهد',
    0,
  )
  const wMeanSummary = summarizeMarket(
    offers,
    { ...DEFAULT_PROFILE_CONFIG.aggregation, method: 'weighted_mean', trimPct: 0.2 },
    'مشهد',
    0,
  )
  assert.equal(trimSummary.reference, trimSummary.trimmedWeightedMean)
  assert.notEqual(trimSummary.reference, wMeanSummary.reference)
  assert.equal(DEFAULT_PROFILE_CONFIG.guards.requireHumanApproval, true)

  // P1: کالای بدون قیمت خرید با ۳ فروشنده امتیاز ۴٫۰ (کمتر از ۴٫۵ معتبرِ خوش‌امتیاز)
  const cfg = makeConfig({
    estimator: { mode: 'v2' },
    supervisor: { ...DEFAULT_PROFILE_CONFIG.supervisor, enabled: false },
  })
  const costlessSource = {
    source: 'torob',
    ok: true,
    prk: 'costless-fb',
    productTitle: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    totalSellerCount: 3,
    fetchedAt: NOW,
    offers: [
      makeRawOffer({ shop: 'ع۱', price: 2450000, score: 4.0 }),
      makeRawOffer({ shop: 'ع۲', price: 2500000, score: 4.0 }),
      makeRawOffer({ shop: 'ع۳', price: 2580000, score: 4.0 }),
    ],
  }
  const res = runPricingPipeline(costlessSource, {
    productName: 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I',
    sku: 'DS-2CD1023G0E-I',
    costPrice: 0,
    supplierQuotes: [],
    config: cfg,
    now: NOW,
  })
  assert.ok(res.finalPrice != null && res.finalPrice >= 2450000)
  assert.equal(res.strategy, 'provisional_market_percentile')
  assert.equal(res.isProvisional, true)
  assert.equal(res.needsReview, true)
})
