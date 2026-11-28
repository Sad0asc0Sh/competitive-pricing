'use strict'
// رگرسیون recall بازار چند-لیستینگی (سند «FIX INCOMPLETE TOROB PRODUCT-CARD DISCOVERY»):
// یک کارت تلفیقی + ده کارت تک‌فروشندهٔ مستقل با عناوین کانونی متفاوت؛ نگاتیوهای خانوادهٔ نام‌دار/315/پک
// هرگز تأیید خودکار نمی‌شوند؛ PRKهای شناخته‌شده اولویت مصرف می‌کنند ولی بیش از نصف سهمیهٔ جزئیات نمی‌گیرند؛
// PRK کهنه fail-closed می‌ماند؛ پاسخ ناقص MCP شفاف گزارش می‌شود؛ قفل مستقیم-PRK در گذر توسعه‌یافته باز می‌شود.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { resolveTorobSource } = loadTsModule('src/lib/sources/torob-discovery.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')

const fixture = require('./fixtures/torob-discovery-recall.json')
const NOW = new Date(fixture.observedAt)
const TARGET = {
  productName: fixture.target.productName,
  sku: fixture.target.sku,
  anchorPriceToman: fixture.target.anchorPriceToman,
}
const SINGLES = fixture.singleSellerCards
const CONS = fixture.consolidatedCard
const PERLA = fixture.negativeCards.perla

const rawOffer = (o = {}) => ({
  shopName: o.shop_name ?? o.seller,
  shopId: o.shop_id ?? o.shop_name ?? o.seller,
  price: o.price_toman ?? 350000,
  currency: 'toman',
  observedAt: NOW,
  listingTitle: o.product_title ?? o.listingTitle,
  sellerType: 'online',
  shopScore: 4.6,
  shopVotes: 60,
  priceUnreliable: false,
  isAd: false,
  inStock: true,
  deliveredPrice: o.price_toman ?? 350000,
})

const detailOf = (card) => {
  const rawOffers = card.offers ?? [{ shop_name: card.seller, price_toman: card.price_toman, product_title: card.listingTitle }]
  const offers = rawOffers.map(rawOffer)
  return {
    prk: card.prk,
    titleFa: card.name_fa,
    titleEn: null,
    titleEvidence: { fields: ['name1'], parsed: true },
    specs: card.specs ?? [
      { key: 'فرکانس', value: '433 مگاهرتز' },
      { key: 'نوع ریموت', value: 'بلوتوثی' },
    ],
    imageUrls: [],
    offers,
    sellerRows: offers.length,
    totalSellerCount: offers.length,
    inPersonSellerCount: 0,
    onlineOfferCount: offers.length,
    offersTruncated: false,
  }
}

const detailsMap = {}
for (const s of SINGLES) detailsMap[s.prk] = detailOf(s)
detailsMap[CONS.prk] = detailOf(CONS)
detailsMap[PERLA.prk] = detailOf(PERLA)
for (const [prk, d] of Object.entries(fixture.knownPrkDetails)) {
  detailsMap[prk] = detailOf({
    prk,
    name_fa: fixture.knownPrks.find((k) => k.prk === prk)?.title ?? prk,
    offers: d.offers,
  })
}
detailsMap['stale-lux-42'] = detailOf({
  prk: 'stale-lux-42',
  name_fa: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس',
  price_toman: 351000,
  offers: [{ shop_name: 'فروشندهٔ کهنه', shop_id: 'stale-1', price_toman: 351000, product_title: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', available: true }],
})

const searchRowOf = (card) => ({
  random_key: card.prk ?? card.random_key,
  name_fa: card.name_fa,
  price_toman: card.price_toman,
  shop_count: card.shop_count,
  shop_name: card.seller ?? `${card.shop_count ?? 1} فروشگاه`,
})

const DEFAULT_PAGE1 = [
  CONS,
  SINGLES[0],
  SINGLES[9],
  SINGLES[6],
  SINGLES[8],
  PERLA,
  { prk: 'neg-315', name_fa: fixture.negativeCards.titles[0], price_toman: 350000, shop_count: 2 },
  { prk: 'neg-pack', name_fa: fixture.negativeCards.titles[1], price_toman: 690000, shop_count: 2 },
  ...Array.from({ length: 18 }, (_, i) => ({
    prk: `noise-${i}`,
    name_fa: `کنسول بازی دسته بی‌سیم مدل ${i}`,
    price_toman: 1200000 + i * 1000,
    shop_count: 2,
  })),
]
const DEFAULT_PAGE2 = [SINGLES[4], SINGLES[5]]

function makeWorld({ incompletePrk = null } = {}) {
  const calls = { search: [], details: [], similar: [] }
  return {
    calls,
    search: async (req) => {
      calls.search.push({ query: req.query, page: req.page ?? 1, sort: req.sort ?? 'popularity' })
      const q = req.query
      const page = req.page ?? 1
      const sort = req.sort ?? 'popularity'
      if (q.includes('سیلیکونی')) return { data: { results: [searchRowOf(SINGLES[2])], count: 1 }, origin: 'torob_mcp' }
      if (q.includes('ساده')) return { data: { results: [searchRowOf(SINGLES[3])], count: 1 }, origin: 'torob_mcp' }
      if (q.includes('لاکچری')) return { data: { results: [searchRowOf(SINGLES[6])], count: 1 }, origin: 'torob_mcp' }
      if (q.includes('استیل')) return { data: { results: [searchRowOf(SINGLES[5])], count: 1 }, origin: 'torob_mcp' }
      if (q.includes('شیک')) return { data: { results: [searchRowOf(SINGLES[7])], count: 1 }, origin: 'torob_mcp' }
      if (q.includes('چراغ')) return { data: { results: [searchRowOf(SINGLES[8])], count: 1 }, origin: 'torob_mcp' }
      if (sort === 'sellers') return { data: { results: [searchRowOf(SINGLES[7])], count: 3 }, origin: 'torob_mcp' }
      if (page === 2) return { data: { results: DEFAULT_PAGE2.map(searchRowOf), count: 28, has_next_page: false }, origin: 'torob_mcp' }
      return {
        data: {
          results: DEFAULT_PAGE1.map(searchRowOf),
          count: 28,
          has_next_page: page < 3,
          // پیشنهادهای جستجوی ترب — مجرای واژگانی به کارت‌های «طرح ساده/لاکچری/چراغ»
          suggested_queries: [
            'ریموت بلوتوث فرکانس 433 مدل رنگی طرح ساده',
            'ریموت بلوتوثی رنگی لاکچری 433 مگاهرتز',
            'ریموت بلوتوثی رنگی 433 با چراغ',
          ],
        },
        origin: 'torob_mcp',
      }
    },
    details: async (card) => {
      calls.details.push(card.prk)
      if (incompletePrk && card.prk === incompletePrk) {
        // شبیه‌سازی پاسخ ناقص MCP: شمار اعلام‌شدهٔ فروشنده بیش از سطرهای برگشتی ⇒ برش/شِمای ناقص
        const d = detailsMap[card.prk]
        return {
          origin: 'torob_mcp',
          issue: 'details_schema',
          data: { ...d, offersTruncated: true, totalSellerCount: 4, sellerRows: 1, onlineOfferCount: 4 },
        }
      }
      const d = detailsMap[card.prk]
      return d ? { origin: 'torob_mcp', data: d } : { unavailable: true, issue: 'not_found' }
    },
    similar: async (card) => {
      calls.similar.push(card.prk)
      // similar کارت تلفیقی: فانتزی + سیلیکونی؛ similar کارت مرجع تک‌فروشنده: طرح ساده
      if (card.prk === CONS.prk) return { origin: 'torob_mcp', data: { results: [searchRowOf(SINGLES[1]), searchRowOf(SINGLES[2])], count: 2 } }
      if (card.prk === SINGLES[0].prk) return { origin: 'torob_mcp', data: { results: [searchRowOf(SINGLES[3])], count: 1 } }
      return { origin: 'torob_mcp', data: { results: [], count: 0 } }
    },
    priceTrend: async () => null,
  }
}

const baseOpts = (world, extra = {}) => ({
  ...TARGET,
  now: NOW,
  via: 'recall_fixture',
  mode: 'interactive',
  search: world.search,
  details: world.details,
  similar: world.similar,
  priceTrend: world.priceTrend,
  ...extra,
  matchConfig: { ownShopNames: fixture.ownStoreNames, ...(extra.matchConfig ?? {}) },
})

test('recall: یک کارت تلفیقی + ده کارت تک‌فروشنده با عناوین متفاوت همگی کشف می‌شوند و تشخیص‌ها صادق است', async () => {
  const world = makeWorld()
  const res = await resolveTorobSource(baseOpts(world))
  assert.ok(res.ok, `استعلام باید نتیجه بدهد: ${res.torob?.status} ${res.torob?.reason}`)

  const cov = res.torob.coverage

  const discovered = new Set((res.torob.search?.candidates ?? []).map((c) => c.prk))
  const missed = fixture.relevantPrks.filter((p) => !discovered.has(p))
  assert.equal(missed.length, 0, `همهٔ ۱۱ PRK مرتبط باید کشف شوند؛ جاافتاده‌ها: ${missed.join(', ')}`)

  assert.ok(cov.pagesRequested >= 3, 'صفحهٔ ۲ و کوئری‌های جایگزین باید اجرا شده باشند')
  assert.ok(world.calls.search.some((c) => c.sort === 'sellers'), 'مرتب‌سازی sellers برای کارت‌های دم‌صفحه اجرا شود')
  assert.ok(world.calls.similar.includes(CONS.prk), 'پروب similar از کارت تلفیقی اجرا شود')
  assert.ok(world.calls.search.some((c) => ['سیلیکونی', 'لاکچری', 'چراغ', 'استیل', 'شیک'].some((w) => c.query.includes(w))),
    'واژگان عنوان فروشندگان باید به کوئری جدید تبدیل شود')
  // بودجه‌ها همچنان محدودند: پایه ۱۰ + استخر continuation ۶ (فاز۲ ≤۴، پروب/واژگان ≤۲)
  assert.ok(cov.apiRequestsMade <= 26, `apiRequestsMade=${cov.apiRequestsMade} باید ≤ 26 باشد`)
  assert.ok(cov.yieldContinuationRequestsUsed <= 6)
  assert.ok(cov.singleSellerPrksDiscovered >= 9, `singleSellerPrksDiscovered=${cov.singleSellerPrksDiscovered}`)
  assert.ok(cov.multiSellerPrksDiscovered >= 1)
  assert.ok(typeof cov.searchStoppingReason === 'string' && cov.searchStoppingReason.length > 0)
  assert.ok(cov.estimatedRemainingDiscoveryOpportunity >= 0)
  assert.equal(cov.status, 'partial', 'تا وقتی بازرسی‌نشدهٔ امیدبخش مانده، پوشش partial است نه complete')
})

test('fairness: PRKهای شناخته‌شده بیش از نصف سهمیهٔ جزئیات مصرف نمی‌کنند و کارت‌های تازه بازرسی می‌شوند', async () => {
  const world = makeWorld()
  const res = await resolveTorobSource(baseOpts(world, {
    knownPrks: fixture.knownPrks.map((k) => k.prk),
    knownPrkHints: fixture.knownPrks,
  }))
  assert.ok(res.ok, `استعلام باید نتیجه بدهد: ${res.torob?.status} ${res.torob?.reason}`)
  const cov = res.torob.coverage
  assert.ok(cov.knownPrksInspected <= 4, `knownPrksInspected=${cov.knownPrksInspected} باید ≤ نصف سهمیهٔ جزئیات (۴) باشد`)
  assert.ok(cov.newPrksInspected >= 3, `newPrksInspected=${cov.newPrksInspected} — کارت‌های تازه باید سهمیهٔ بازرسی بگیرند`)
  assert.ok(cov.singleSellerPrksInspected >= 2, 'کارت‌های تک‌فروشندهٔ تازه باید بازرسی شوند')
  assert.ok(world.calls.details.includes('k-lux-a'), 'PRKهای شناخته‌شده همچنان از مجرای hint بازرسی می‌شوند')
})

test('precision: نگاتیوهای پرلا/315/پک در سطح Stage-A رد می‌شوند و هرگز وارد قیمت نمی‌شوند', async () => {
  const world = makeWorld()
  const res = await resolveTorobSource(baseOpts(world))
  const confirmedPrks = new Set(res.offers.filter((o) => o.torobIdentity?.status === 'MATCH_CONFIRMED').map((o) => o.torobIdentity.prk))
  assert.ok(!confirmedPrks.has(PERLA.prk), 'پرلا هرگز تأیید خودکار نمی‌شود')
  assert.ok(!confirmedPrks.has('neg-315') && !confirmedPrks.has('neg-pack'))
  // کارت پرلا کشف می‌شود ولی هرگز تأیید/پنل نمی‌شود: خانوادهٔ نام‌دار متضاد ⇒ PARENT_AMBIGUOUS + مارکر
  const perlaDiag = (res.torob.discoveryDiagnostics ?? []).find((d) => d.prk === PERLA.prk)
  assert.ok(perlaDiag, 'کارت پرلا باید کشف شود (recall)')
  assert.notEqual(perlaDiag.classification, 'CONFIRMED_COMPATIBLE', 'پرلا هرگز سازگار تأییدشده نمی‌شود')
  assert.ok(!(res.torob.selectedPanelPrks ?? []).includes(PERLA.prk), 'پرلا هرگز در پنل انتخابی نیست')
  assert.ok(!res.offers.some((o) => o.torobIdentity?.prk === PERLA.prk && o.torobIdentity.status === 'MATCH_CONFIRMED'))

  const priced = runPricingPipeline(res, {
    productId: 7,
    ...TARGET,
    costPrice: 320000,
    supplierQuotes: [],
    now: NOW,
    config: structuredClone(DEFAULT_PROFILE_CONFIG),
  })
  const perlaPriced = priced.offers.find((o) => o.torobIdentity?.prk === PERLA.prk)
  assert.ok(!perlaPriced || perlaPriced.included === false, 'آفر پرلا هرگز وارد قیمت‌گذاری نمی‌شود')
  const neg315Priced = priced.offers.find((o) => o.torobIdentity?.prk === 'neg-315')
  assert.ok(!neg315Priced || neg315Priced.included === false)
})

test('stale hint fail-closed است: PRK کهنه بازرسی می‌شود ولی خودکار تأیید نمی‌شود', async () => {
  const world = makeWorld()
  const res = await resolveTorobSource(baseOpts(world, {
    knownPrks: ['stale-lux-42'],
    knownPrkHints: [{ prk: 'stale-lux-42', title: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', identityStatus: 'REVIEW_REQUIRED', externalCompetitorCount: 0, lastVerifiedAt: '2026-09-01T10:00:00.000Z' }],
  }))
  assert.ok(res.ok, `استعلام باید نتیجه بدهد: ${res.torob?.status} ${res.torob?.reason}`)
  assert.ok(world.calls.details.includes('stale-lux-42'), 'PRK کهنه همچنان کشف‌شدنی و بازرسی‌شدنی است')
  const staleOffer = res.offers.find((o) => o.torobIdentity?.prk === 'stale-lux-42')
  if (staleOffer) {
    assert.equal(staleOffer.torobIdentity.status, 'REVIEW_REQUIRED', 'PRK کهنهٔ بی‌شواهد تازه fail-closed می‌ماند')
  }
  const confirmedPrks = new Set(res.offers.filter((o) => o.torobIdentity?.status === 'MATCH_CONFIRMED').map((o) => o.torobIdentity.prk))
  assert.ok(!confirmedPrks.has('stale-lux-42'))
})

test('پاسخ ناقص MCP شفاف است: کارت بازرسی می‌شود، آفر REVIEW_REQUIRED می‌ماند و کشف ادامه می‌یابد', async () => {
  const world = makeWorld({ incompletePrk: SINGLES[9].prk })
  const res = await resolveTorobSource(baseOpts(world))
  assert.ok(res.ok, `استعلام باید نتیجه بدهد: ${res.torob?.status} ${res.torob?.reason}`)
  const broken = res.offers.find((o) => o.torobIdentity?.prk === SINGLES[9].prk)
  if (broken) {
    assert.equal(broken.torobIdentity.status, 'REVIEW_REQUIRED', 'آفر با پاسخ ناقص تأیید خودکار نمی‌شود')
  }
  const cov = res.torob.coverage
  assert.ok(cov.candidatePrksInspected >= 6)
  const discovered = new Set((res.torob.search?.candidates ?? []).map((c) => c.prk))
  assert.ok(discovered.has(SINGLES[3].prk), 'کشف پس از پاسخ ناقص ادامه می‌یابد')
})

test('direct-PRK lock: تعاملی جستجو نمی‌زند و status=uncertain گزارش می‌شود؛ extended پوشش بازار را محدود باز می‌کند', async () => {
  const lockedWorld = makeWorld()
  const locked = await resolveTorobSource(baseOpts(lockedWorld, {
    prk: SINGLES[0].prk,
    torobUrl: `https://torob.com/p/${SINGLES[0].prk}/`,
  }))
  assert.equal(locked.torob.coverage.queriesExecuted, 0, 'قفل مستقیم-PRK در تعاملی صفر جستجو انجام می‌دهد')
  assert.equal(locked.torob.coverage.status, 'uncertain')
  assert.equal(locked.torob.coverage.stoppingReason, 'direct_prk_lookup')
  assert.equal(locked.prk, SINGLES[0].prk)
  assert.equal(lockedWorld.calls.search.length, 0)

  // در گذر توسعه‌یافته، آداپتور PRK ذخیره‌شده را به hint تبدیل می‌کند (torob.ts) ⇒ جستجوی بازار اجرا می‌شود
  const extWorld = makeWorld()
  const extended = await resolveTorobSource(baseOpts(extWorld, {
    prk: null,
    cachedPrk: SINGLES[0].prk,
    mode: 'extended',
  }))
  assert.ok(extWorld.calls.search.length >= 2, 'گذر توسعه‌یافته حتی برای کارت قفل‌شده جستجوی بازار را باز می‌کند')
  assert.ok(extWorld.calls.details.includes(SINGLES[0].prk), 'PRK ذخیره‌شده به‌عنوان hint همچنان بازرسی می‌شود')
  const extDiscovered = new Set((extended.torob.search?.candidates ?? []).map((c) => c.prk))
  const newSingles = SINGLES.slice(1).filter((s) => extDiscovered.has(s.prk))
  assert.ok(newSingles.length >= 4, `گذر توسعه‌یافته باید کارت‌های تک‌فروشندهٔ دیگر را کشف کند؛ یافته: ${newSingles.length}`)
})
