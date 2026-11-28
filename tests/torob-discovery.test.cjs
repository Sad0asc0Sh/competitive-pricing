'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { mcpOffer } = require('./helpers/fake-torob-mcp.cjs')
const fixture = require('./fixtures/torob-discovery-regression.json')

const { evaluateTorobCandidate } = loadTsModule('src/lib/pricing/matcher.ts')
const { parseTitle } = loadTsModule('src/lib/pricing/match/parse.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { fetchViaTorobMcpServer } = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { buildSearchQueryPlan, decomposeTargetProduct } = loadTsModule('src/lib/sources/torob-query.ts')
const { TorobDiscoveryCache } = loadTsModule('src/lib/sources/torob-cache.ts')

const NOW = new Date(fixture.observedAt)
const TARGET = {
  productName: fixture.target.name,
  sku: fixture.target.sku,
  anchorPriceToman: fixture.target.anchorPriceToman,
}

function makeMcpHarness({ searchFn, detailsMap, similarFn, onCall }) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    const { name, arguments: args } = body.params
    calls.push({ name, args })
    if (onCall) await onCall(name, args)
    const reply = (payload, isError = false) =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { isError, content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    if (name === 'search_products') {
      const out = await searchFn(args)
      if (Array.isArray(out)) return reply({ products: out, page: args.page ?? 1, has_next_page: false })
      return reply(out)
    }
    if (name === 'similar_products') {
      const out = similarFn ? await similarFn(args) : []
      return reply(Array.isArray(out) ? { products: out } : out)
    }
    if (name === 'product_details') {
      const d = detailsMap[args.prk]
      if (!d) return reply('not found', true)
      const offers = (d.offers || []).slice(0, args.max_offers ?? 30)
      return reply({
        ...d,
        offers,
        ...(d.offers.length > offers.length || d.offers_truncated ? { offers_truncated: true, offers_returned: offers.length } : {}),
        offer_count: d.offer_count ?? d.offers.length,
      })
    }
    if (name === 'price_history') return reply({ series: [] })
    return reply('unknown tool', true)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

function hydrateOffer(raw) {
  return {
    ...mcpOffer({
      shop: raw.shop_name,
      city: raw.shop_city ?? 'تهران',
      price: raw.price_toman,
      score: raw.shop_score ?? 4.7,
      votes: raw.shop_votes ?? 50,
      available: raw.available ?? true,
    }),
    shop_id: raw.shop_id === undefined ? raw.shop_name : raw.shop_id,
    product_title: raw.product_title,
    ...(raw.specs ? { specs: raw.specs } : {}),
  }
}

function cardPayload(card, prkOverride = card.prk) {
  return {
    prk: prkOverride,
    name_fa: card.name_fa,
    name_en: card.name_en,
    price_toman: card.price_toman,
    shop_count: card.shop_count,
    shop_name: card.shop_text,
    offers: card.offers.map(hydrateOffer),
    in_person_sellers: [],
  }
}

function withCfg(overrides = {}) {
  return {
    productId: 101,
    productName: TARGET.productName,
    sku: TARGET.sku,
    costPrice: 450000,
    supplierQuotes: [],
    now: NOW,
    config: structuredClone(DEFAULT_PROFILE_CONFIG),
    ...overrides,
  }
}

const CARD_A = fixture.cards.cardA_bazar
const CARD_B = fixture.cards.cardB_jahan
const CARD_C = fixture.cards.cardC_volta
const CARD_D_VERIFIED = fixture.cards.cardD_verified_volta

test('0. target decomposition & multi-strategy query planning generalize across categories', () => {
  const remoteProfile = decomposeTargetProduct(TARGET.productName, TARGET.sku)
  assert.equal(remoteProfile.productClass, 'acc:remote')
  assert.deepEqual(remoteProfile.brands, ['hsp'])
  assert.equal(remoteProfile.isCodeless, true)
  assert.ok(remoteProfile.hardConstraints.includes('frequency:315000000'))
  assert.ok(remoteProfile.hardConstraints.includes('buttons:5'))

  const remotePlan = buildSearchQueryPlan(TARGET.productName, TARGET.sku).map((q) => q.query)
  assert.ok(remotePlan.some((q) => q.includes('طرح بنزی')), 'must generate طرح بنزی market wording')
  assert.ok(remotePlan.some((q) => q.includes('اچ اس پی')), 'must generate Persian brand spelling')
  assert.ok(remotePlan.some((q) => q === 'ریموت بلوتوثی بنزی 315'), 'must generate brandless technical query')

  const psuPlan = buildSearchQueryPlan('آداپتور 12 ولت 5 آمپر مین ول', null).map((q) => q.query)
  assert.ok(psuPlan.some((q) => q.includes('12v') || q.includes('12 ولت')))
  assert.ok(psuPlan.some((q) => q.includes('meanwell') || q.includes('مین ول')))
})

test('0b. contextual طرح interpretation separates design style from counterfeit imitation', () => {
  assert.equal(parseTitle('ریموت بلوتوثی طرح بنزی 315MHz برند HSP').counterfeit, null)
  assert.equal(parseTitle('ریموت بلوتوثی طرح بنزی 315MHz برند HSP').designStyle, 'طرح بنزی')
  assert.equal(parseTitle('ریموت بلوتوثی طرح اصل HSP 315').counterfeit, 'طرح اصل')
  assert.equal(parseTitle('ریموت طرح سامسونگ 315').counterfeit, 'طرح سامسونگ')
  assert.equal(parseTitle('ساعت هوشمند طرح اپل واچ').counterfeit, 'طرح اپل')
  const unknownStyle = evaluateTorobCandidate(TARGET, { prk: 'u', titleFa: 'ریموت بلوتوثی 315 بنزی 5 دکمه طرح جدید Hsp' })
  assert.equal(unknownStyle.status, 'MATCH_CONFIRMED')
  const cardCEval = evaluateTorobCandidate(TARGET, { prk: 'c', titleFa: CARD_C.name_fa, priceToman: CARD_C.price_toman })
  assert.equal(cardCEval.status, 'REVIEW_REQUIRED')
  assert.notEqual(cardCEval.status, 'IDENTITY_MISMATCH')
})

test('1 & 12 & 18. Regression incident: Cards A, B, and C (ولتاتک) are all discovered, reviewable offers stay REVIEW_REQUIRED and excluded from pricing', async (t) => {
  const fake = makeMcpHarness({
    searchFn: (args) => {
      if (args.query === 'ریموت بنزی 315 hsp') return [CARD_A]
      if (args.query === 'ریموت بنزی') return [CARD_B]
      if (args.query.includes('طرح بنزی')) return [CARD_C]
      return []
    },
    detailsMap: {
      [CARD_A.prk]: cardPayload(CARD_A),
      [CARD_B.prk]: cardPayload(CARD_B),
      [CARD_C.prk]: cardPayload(CARD_C),
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, now: NOW })
  assert.equal(source.torob.status, 'MATCH_CONFIRMED')
  const bazar = source.offers.find((o) => o.shopName === 'بازار قفل')
  const jahan = source.offers.find((o) => o.shopName === 'جهان ریموت')
  const volta = source.offers.find((o) => o.shopName === 'ولتاتک')
  assert.ok(bazar && jahan && volta, 'all three reported sellers must be discovered')
  assert.equal(bazar.torobIdentity.status, 'MATCH_CONFIRMED')
  assert.equal(jahan.torobIdentity.status, 'REVIEW_REQUIRED')
  assert.equal(volta.torobIdentity.status, 'REVIEW_REQUIRED')
  assert.equal(volta.price, 610190)

  const priced = runPricingPipeline(source, withCfg())
  assert.equal(priced.offers.find((o) => o.shopName === 'بازار قفل').included, true)
  assert.equal(priced.offers.find((o) => o.shopName === 'جهان ریموت').included, false)
  assert.equal(priced.offers.find((o) => o.shopName === 'ولتاتک').included, false)
  assert.equal(priced.lowestValid, 580000)
})

test('2 & 13. Pagination: matching card only on page 2 is discovered and pagination exhausts cleanly', async (t) => {
  const page1Noise = Array.from({ length: 24 }, (_, i) => ({
    prk: `noise-${i}`, name_fa: `ریموت بنزی متفرقه ${i}`, price_toman: 500000 + i * 1000, shop_count: 1,
  }))
  const fake = makeMcpHarness({
    searchFn: (args) => {
      if ((args.page ?? 1) === 1 && args.sort === 'popularity' && args.query === TARGET.productName) {
        return { products: page1Noise, page: 1, has_next_page: true, total_matches: 25 }
      }
      if (args.page === 2) {
        return { products: [CARD_C], page: 2, has_next_page: false, total_matches: 25 }
      }
      return { products: [], page: args.page ?? 1, has_next_page: false }
    },
    detailsMap: {
      [CARD_C.prk]: cardPayload(CARD_D_VERIFIED, CARD_C.prk),
      'noise-0': { prk: 'noise-0', name_fa: 'ریموت بنزی متفرقه 0', offers: [] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    ...TARGET,
    now: NOW,
    budgets: { maxSearchRequests: 10, maxPagesPerQuery: 2 },
  })
  assert.ok(fake.calls.some((c) => c.name === 'search_products' && c.args.page === 2))
  assert.ok(source.offers.some((o) => o.shopName === 'ولتاتک'))
  assert.equal(source.torob.coverage.pagesRemaining, 0)
})

test('3. Alternative sort: card absent from popularity is discovered via sellers or price sort', async (t) => {
  const overflow = Array.from({ length: 24 }, (_, i) => ({
    prk: `pop-${i}`, name_fa: 'ریموت بنزی Hsp', price_toman: 700000, shop_count: 1,
  }))
  const fake = makeMcpHarness({
    searchFn: (args) => {
      if (args.sort === 'sellers') {
        return { products: [CARD_A], page: 1, has_next_page: false }
      }
      if (args.query === 'ریموت بلوتوثی 315 بنزی 5 دکمه (Hsp)') {
        return { products: overflow, page: 1, has_next_page: true, total_matches: 80 }
      }
      return { products: [], page: 1, has_next_page: false }
    },
    detailsMap: {
      [CARD_A.prk]: cardPayload(CARD_A),
      'pop-0': { prk: 'pop-0', name_fa: 'ریموت بنزی Hsp', offers: [] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, now: NOW })
  assert.ok(source.torob.coverage.sortModesUsed.includes('sellers'))
  assert.equal(source.prk, CARD_A.prk)
  assert.equal(source.torob.status, 'MATCH_CONFIRMED')
})

test('4. Four unrelated high-scoring (74%) cards before the real card do NOT starve inspection', async (t) => {
  const highScoringDistractors = [
    { prk: 'dist-1', name_fa: 'ریموت بلوتوثی سوئیچی تیغه پرایدی 315MHz برند HSP', price_toman: 600000, shop_count: 1 },
    { prk: 'dist-2', name_fa: 'ریموت آزارا ۳۱۵ بلوتوث hsp', price_toman: 600000, shop_count: 1 },
    { prk: 'dist-3', name_fa: 'ریموت بلوتوثی سوئیچی تیغه پژویی 315MHz برند HSP', price_toman: 600000, shop_count: 1 },
    { prk: 'dist-4', name_fa: 'ریموت بلوتوث HSP آنتن‌دار مدل 57 فرکانس 315 مگاهرتز', price_toman: 600000, shop_count: 1 },
  ]
  const fake = makeMcpHarness({
    searchFn: () => [...highScoringDistractors, CARD_C],
    detailsMap: {
      ...Object.fromEntries(highScoringDistractors.map((d) => [d.prk, { ...d, offers: [hydrateOffer({ shop_name: d.prk, price_toman: 600000, product_title: d.name_fa })] }])),
      [CARD_C.prk]: cardPayload(CARD_D_VERIFIED, CARD_C.prk),
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    ...TARGET,
    now: NOW,
    budgets: { maxDetails: 4 },
  })
  assert.equal(source.torob.status, 'MATCH_CONFIRMED')
  assert.equal(source.prk, CARD_C.prk)
  assert.ok(source.offers.some((o) => o.shopName === 'ولتاتک' && o.torobIdentity.status === 'MATCH_CONFIRMED'))
})

test('5 & 6. Incomplete canonical card title hydrated and corroborated by strong seller evidence', async (t) => {
  const incompleteCard = { prk: 'syn-incomplete', name_fa: 'ریموت بلوتوثی بنزی فرکانس ۳۱۵', price_toman: 589000, shop_count: 1 }
  const fake = makeMcpHarness({
    searchFn: () => [incompleteCard],
    detailsMap: {
      [incompleteCard.prk]: {
        ...incompleteCard,
        offers: [hydrateOffer({
          shop_name: 'فروشگاه معتبر',
          price_toman: 589000,
          product_title: 'ریموت بلوتوثی 315 بنزی 5 دکمه Hsp',
          specs: [{ key: 'تعداد در بسته', value: '1' }],
        })],
      },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, now: NOW })
  assert.equal(source.torob.status, 'MATCH_CONFIRMED')
  assert.equal(source.offers[0].torobIdentity.status, 'MATCH_CONFIRMED')
})

test('7 & 8. Cross-PRK semantic clustering merges equivalent identities but blocks conflicting attributes', async (t) => {
  const eq1 = { prk: 'eq-1', name_fa: 'دوربین مداربسته هایک ویژن 2 مگاپیکسل', price_toman: 2100000, shop_count: 1 }
  const eq2 = { prk: 'eq-2', name_fa: 'دوربین مداربسته هایک ویژن 1080P 2MP', price_toman: 2150000, shop_count: 1 }
  const eqTarget = { productName: 'دوربین مداربسته هایک ویژن 2 مگاپیکسل', anchorPriceToman: 2100000 }
  const fake = makeMcpHarness({
    searchFn: () => [eq1, eq2],
    detailsMap: {
      'eq-1': { ...eq1, offers: [hydrateOffer({ shop_name: 'فروشگاه ۱', price_toman: 2100000, product_title: eq1.name_fa })] },
      'eq-2': { ...eq2, offers: [hydrateOffer({ shop_name: 'فروشگاه ۲', price_toman: 2150000, product_title: eq2.name_fa })] },
    },
  })
  t.after(fake.restore)
  const merged = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...eqTarget, now: NOW })
  assert.equal(merged.torob.status, 'MATCH_CONFIRMED')
  assert.deepEqual(new Set(merged.meta.mergedPanelPrks), new Set(['eq-1', 'eq-2']))
  fake.restore()

  const conf1 = { prk: 'c-1', name_fa: 'دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I لنز 2.8 میلی متر', price_toman: 2300000 }
  const conf2 = { prk: 'c-2', name_fa: 'دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I لنز 3.6 میلی متر', price_toman: 2350000 }
  const fake2 = makeMcpHarness({
    searchFn: () => [conf1, conf2],
    detailsMap: {
      'c-1': { ...conf1, offers: [hydrateOffer({ shop_name: 'ف۱', price_toman: 2300000, product_title: conf1.name_fa })] },
      'c-2': { ...conf2, offers: [hydrateOffer({ shop_name: 'ف۲', price_toman: 2350000, product_title: conf2.name_fa })] },
    },
  })
  t.after(fake2.restore)
  const conflict = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    productName: 'دوربین مداربسته هایک ویژن مدل DS-2CD1023G0E-I',
    now: NOW,
  })
  assert.equal(conflict.torob.status, 'REVIEW_REQUIRED')
  assert.equal(conflict.meta.mergedPanelPrks, undefined)
})

test('9, 10, 11. Hard rejections: 433MHz, 4-button, and genuine 5-pack never auto-match target', async () => {
  for (const [title, expected] of [
    ['ریموت بلوتوثی 433 بنزی 5 دکمه Hsp', 'IDENTITY_MISMATCH'],
    ['ریموت بلوتوثی 315 بنزی 4 دکمه Hsp', 'IDENTITY_MISMATCH'],
    ['پک ۵ عددی ریموت بلوتوثی 315 بنزی 5 دکمه Hsp', 'IDENTITY_MISMATCH'],
    ['ریموت بلوتوث بنزی فرکانس ۳۱۵ بسته ۵ عددی Hsp', 'IDENTITY_MISMATCH'],
  ]) {
    assert.equal(evaluateTorobCandidate(TARGET, { prk: 'neg', titleFa: title, priceToman: 590000 }).status, expected, title)
  }
})

test('14 & 16. Budget exhaustion & truncation never report complete_within_scope', async (t) => {
  const fake = makeMcpHarness({
    searchFn: () => ({ products: [CARD_A], page: 1, has_next_page: true, total_matches: 50 }),
    detailsMap: {
      [CARD_A.prk]: { ...cardPayload(CARD_A), offers_truncated: true, offer_count: 45 },
    },
  })
  t.after(fake.restore)
  const res = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    ...TARGET,
    now: NOW,
    budgets: { maxSearchRequests: 2 },
  })
  assert.equal(res.torob.coverage.status, 'partial')
  assert.notEqual(res.torob.coverage.status, 'complete_within_scope')
  assert.equal(res.torob.coverage.sellerOffersTruncated, true)
  assert.ok(res.torob.coverage.limitations.length >= 2)
})

test('15. Stable seller deduplication across PRKs handles shopId + alias shops without double-counting', async (t) => {
  const card1 = { ...CARD_A, prk: 'dup-1', offers: [{ ...CARD_A.offers[0], shop_id: '991', price_toman: 580000 }] }
  const card2 = { ...CARD_A, prk: 'dup-2', offers: [{ ...CARD_A.offers[0], shop_id: null, shop_name: 'بازار قفل', price_toman: 595000 }] }
  const fake = makeMcpHarness({
    searchFn: () => [card1, card2],
    detailsMap: {
      'dup-1': cardPayload(card1),
      'dup-2': cardPayload(card2),
    },
  })
  t.after(fake.restore)
  const res = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, now: NOW })
  const confirmed = res.offers.filter((o) => o.torobIdentity.status === 'MATCH_CONFIRMED')
  assert.equal(confirmed.length, 1)
  assert.equal(confirmed[0].price, 580000)
})

test('17. Single confirmed card does NOT stop discovery of additional fragmented coded or codeless PRKs', async (t) => {
  const codedTarget = { productName: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', sku: 'DH-HAC-HFW1200T', anchorPriceToman: 2400000 }
  const c1 = { prk: 'd-1', name_fa: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', price_toman: 2400000, shop_count: 1 }
  const c2 = { prk: 'd-2', name_fa: 'دوربین داهوا HFW1200T', price_toman: 2350000, shop_count: 1 }
  const fake = makeMcpHarness({
    searchFn: (args) => args.query.includes('HFW1200T') && !args.query.includes('داهوا') ? [c2] : [c1],
    detailsMap: {
      'd-1': { ...c1, offers: [hydrateOffer({ shop_name: 'ف۱', price_toman: 2400000, product_title: c1.name_fa })] },
      'd-2': { ...c2, offers: [hydrateOffer({ shop_name: 'ف۲', price_toman: 2350000, product_title: c1.name_fa })] },
    },
  })
  t.after(fake.restore)
  const res = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...codedTarget, now: NOW })
  assert.equal(res.torob.status, 'MATCH_CONFIRMED')
  assert.equal(res.offers.filter((o) => o.torobIdentity.status === 'MATCH_CONFIRMED').length, 2)
})

test('19. Previously known PRKs remain discoverable even if omitted from search results', async (t) => {
  const fake = makeMcpHarness({
    searchFn: () => [CARD_A],
    detailsMap: {
      [CARD_A.prk]: cardPayload(CARD_A),
      [CARD_C.prk]: cardPayload(CARD_D_VERIFIED, CARD_C.prk),
    },
  })
  t.after(fake.restore)
  const res = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    ...TARGET,
    knownPrks: [CARD_C.prk],
    now: NOW,
  })
  assert.ok(res.offers.some((o) => o.shopName === 'ولتاتک' && o.torobIdentity.status === 'MATCH_CONFIRMED'))
})

test('20. Large result sets (200+ unique cards) stay bounded and complete quickly', async (t) => {
  let pageSeq = 0
  const fake = makeMcpHarness({
    searchFn: (args) => {
      pageSeq++
      const products = Array.from({ length: 24 }, (_, i) => ({
        prk: `bulk-${pageSeq}-${i}`,
        name_fa: i === 23 && pageSeq === 1 ? CARD_A.name_fa : `ریموت بنزی Hsp شماره ${pageSeq}-${i}`,
        price_toman: 590000,
        shop_count: 1,
      }))
      return { products, page: args.page ?? 1, has_next_page: true, total_matches: 1200 }
    },
    detailsMap: {
      'bulk-1-23': { ...cardPayload(CARD_A), prk: 'bulk-1-23' },
    },
  })
  t.after(fake.restore)
  const t0 = Date.now()
  const res = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, now: NOW })
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 1000, `expected <1000ms, got ${elapsed}ms`)
  assert.ok(res.torob.coverage.uniquePrksDiscovered >= 150)
  // Upper bound for interactive codeless mode: base searches (10) + phase-2 continuation (≤4) +
  // similar/vocab share of the continuation pool (≤2) + maxDetails (8) + 1 price_history = 25.
  assert.ok(res.torob.coverage.apiRequestsMade <= 25, `expected <= 25 API requests, got ${res.torob.coverage.apiRequestsMade}`)
})

test('Cache effectiveness: second call reuses clean search/detail results without repeating API calls', async (t) => {
  const cache = new TorobDiscoveryCache()
  const fake = makeMcpHarness({
    searchFn: () => [CARD_A],
    detailsMap: { [CARD_A.prk]: cardPayload(CARD_A) },
  })
  t.after(fake.restore)
  const first = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, cache, now: NOW })
  const callsAfterFirst = fake.calls.length
  assert.ok(callsAfterFirst > 0)
  assert.equal(first.torob.coverage.cacheHits, 0)

  const second = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, cache, now: new Date(NOW.getTime() + 60_000) })
  assert.equal(fake.calls.length, callsAfterFirst, 'cache hit must issue 0 additional network calls')
  assert.equal(second.torob.coverage.apiRequestsMade, 0)
  assert.ok(second.torob.coverage.cacheHitRate === 1)
  assert.equal(second.offers.length, first.offers.length)
})

test('21. Live-like interactive density: diversity balances pagination/alt-wording/sellers/similar and prevents starvation of incomplete card', async (t) => {
  const ccebNoise = { prk: 'live-cceb', name_fa: 'ریموت بلوتوث 315', name_en: 'کد 114', price_toman: 255000, shop_count: 1 }
  const dfc0Model = { prk: 'live-dfc0', name_fa: 'ریموت بلوتوث HSP مدل لوکس H21 تاشو فرکانس ۳۱۵ مگاهرتز', price_toman: 960000, shop_count: 2 }
  const cardNoBrand = { prk: 'live-0d39', name_fa: 'ریموت بلوتوثی 315 بنزی 5 دکمه', price_toman: 589000, shop_count: 1 }
  const cardLuxury = { prk: 'live-5154', name_fa: 'ریموت بلوتوثی 315 لوکس بنزی', price_toman: 790000, shop_count: 1 }
  const page2Card = { prk: 'live-46f3', name_fa: 'ریموت بلوتوثی بنزی ۵ دکمه ۳۱۵', price_toman: 650000, shop_count: 1 }
  const similarCard = { prk: 'live-sim-1', name_fa: 'ریموت بلوتوثی بنزی فرکانس 315 HSP', price_toman: 640000, shop_count: 1 }
  const tarhNoiseCarParts = Array.from({ length: 12 }, (_, i) => ({
    prk: `noise-car-${i}`, name_fa: `کنسول وسط خودرو بنزی ${i}`, price_toman: 2500000, shop_count: 1,
  }))
  const fake = makeMcpHarness({
    searchFn: (args) => {
      if (args.category === '991') {
        return { products: [{ ...CARD_C, name_fa: 'ریموت بلوتوثی بنزی فرکانس ۳۱۵' }], page: 1, has_next_page: false }
      }
      if (args.query.includes('طرح بنزی')) {
        return { products: [CARD_C], page: 1, has_next_page: false }
      }
      if (args.sort === 'sellers') {
        return { products: [cardLuxury, CARD_A], page: 1, has_next_page: false }
      }
      if ((args.page ?? 1) === 2) {
        return { products: [page2Card, dfc0Model], page: 2, has_next_page: false }
      }
      return {
        products: [CARD_A, CARD_B, ccebNoise, dfc0Model, cardNoBrand, { ...CARD_C, name_fa: 'ریموت بلوتوثی بنزی فرکانس ۳۱۵' }, ...tarhNoiseCarParts],
        page: 1,
        has_next_page: true,
        total_matches: 60,
        suggested_categories: [{ id: 991, title: 'ریموت کنترل' }],
      }
    },
    similarFn: () => [similarCard],
    detailsMap: {
      [CARD_A.prk]: cardPayload(CARD_A),
      [CARD_B.prk]: cardPayload(CARD_B),
      [CARD_C.prk]: cardPayload(CARD_C),
      'live-0d39': { prk: 'live-0d39', name_fa: cardNoBrand.name_fa, offers: [hydrateOffer({ shop_name: 'ای کا جی کالا', price_toman: 589000, product_title: cardNoBrand.name_fa })] },
      'live-5154': { prk: 'live-5154', name_fa: cardLuxury.name_fa, offers: [hydrateOffer({ shop_name: 'مهدیران', price_toman: 790000, product_title: cardLuxury.name_fa })] },
      'live-46f3': { prk: 'live-46f3', name_fa: page2Card.name_fa, offers: [hydrateOffer({ shop_name: 'قفل مشهد', price_toman: 650000, product_title: page2Card.name_fa })] },
      'live-sim-1': { prk: 'live-sim-1', name_fa: similarCard.name_fa, offers: [hydrateOffer({ shop_name: 'مشابه ریموت', price_toman: 640000, product_title: similarCard.name_fa })] },
      'live-cceb': { prk: 'live-cceb', name_fa: ccebNoise.name_fa, offers: [hydrateOffer({ shop_name: 'کد 114', price_toman: 255000, product_title: 'ریموت بلوتوث 315 کد 114' })] },
      'live-dfc0': { prk: 'live-dfc0', name_fa: dfc0Model.name_fa, offers: [hydrateOffer({ shop_name: 'اکتیوآلارم', price_toman: 960000, product_title: dfc0Model.name_fa })] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ mcpUrl: 'http://fixture.invalid/mcp', ...TARGET, mode: 'interactive', now: NOW })
  assert.ok(source.offers.some((o) => o.shopName === 'بازار قفل' && o.torobIdentity.status === 'MATCH_CONFIRMED'))
  assert.ok(source.offers.some((o) => o.shopName === 'جهان ریموت' && o.torobIdentity.status === 'REVIEW_REQUIRED'))
  assert.ok(source.offers.some((o) => o.shopName === 'ولتاتک' && o.torobIdentity.status === 'REVIEW_REQUIRED'), 'interactive mode must inspect Card C (ولتاتک) directly')
  assert.ok(!source.offers.some((o) => o.shopName === 'کد 114'), 'low-score off-price probe must not starve Card C')
  assert.ok(source.torob.coverage.sortModesUsed.includes('sellers'), 'Phase 2 must diversify to sellers sort instead of pure pagination')
  assert.ok(source.torob.coverage.categoriesUsed.includes('991'), 'numeric category id must be decoded and queried when noisy')
  assert.ok(source.torob.coverage.similarProbesExecuted >= 1, 'similar_products probe must execute for fragmented primary (bounded ≤2 در تعاملی)')
  assert.ok(source.torob.search.queries.some((q) => q.query.includes('طرح بنزی')), 'alternative wording query must execute in Phase 2')
})
