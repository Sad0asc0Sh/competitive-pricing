'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { installFakeTorob, mcpOffer } = require('./helpers/fake-torob-mcp.cjs')
const fixture = require('./fixtures/torob-remotag-replay.json')

const { evaluateTorobCandidate } = loadTsModule('src/lib/pricing/matcher.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { enrichSupervisorWithSubqApi } = loadTsModule('src/lib/pricing/systemone-supervisor.ts')
const { decodeTorobSearch, torobPrice } = loadTsModule('src/lib/sources/torob-payload.ts')
const { torobAdapter } = loadTsModule('src/lib/sources/torob.ts')
const { buildSearchQueries, fetchViaTorobMcpServer, callTorobMcpToolWithDiag } = loadTsModule('src/lib/sources/torob-mcp-client.ts')

const now = new Date(fixture.observedAt)
const known = fixture.search.results.find((row) => row.random_key === fixture.prk)
const title = known.name1
const opts = { mcpUrl: 'http://fixture.invalid/mcp', productName: fixture.product.name, sku: fixture.product.sku, now }
const context = { productId: fixture.product.id, productName: opts.productName, sku: opts.sku, costPrice: 0, supplierQuotes: [], now }
const evalTarget = { productName: opts.productName, sku: opts.sku }
const exactProduct = 'ماژول ريموت‌تگ بتا مدل RTG-A12 ۱۲ ولت'
const exactCard = 'BETA REMOTAG Access Controller model RTG-A12 12V'
const confirmation = { prk: fixture.prk, confirmedAt: now.toISOString(), origin: 'admin_review', decisionId: 42 }
const remoteTarget = { productName: 'ریموت بلوتوثی 315 بنزی 5 دکمه (Hsp)', sku: '2399', anchorPriceToman: 589000 }
const bazarCard = { prk: 'hsp-bazar', name_fa: '613 ریموت بلوتوثی 315 بنزی 5 دکمه اچ اس پی', price_toman: 580000, shop_count: 1 }
const jahanCard = { prk: 'hsp-jahan', name_fa: 'ریموت بنزی ۵ عددی', name_en: 'Hsp', price_toman: 750000, shop_count: 1 }
const jahanOffer = { ...rawOffer('جهان ریموت', 750000), product_title: 'ریموت بنزی بلوتوث بنزی فرکانس 315 | Hsp' }
const verifiedJahanOffer = { ...jahanOffer, specs: [{ key: 'تعداد دکمه', value: 'پنج' }, { key: 'تعداد در بسته', value: '۱' }] }
const bazarOffer = { ...rawOffer('بازار قفل', 580000), product_title: bazarCard.name_fa }

function withConfig(overrides = {}) {
  return { ...context, config: structuredClone(DEFAULT_PROFILE_CONFIG), ...overrides }
}

function setEnv(t, name, value) {
  const previous = process.env[name]
  if (value == null) delete process.env[name]
  else process.env[name] = value
  t.after(() => { if (previous == null) delete process.env[name]; else process.env[name] = previous })
}

function mockSubq(t, noul) {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ answers: { identity_match: { noul } } }))
  return {
    fetch,
    config: { ...DEFAULT_PROFILE_CONFIG.supervisor, enabled: true, mode: 'hybrid_subq_and_local', apiKey: 'fixture-key' },
  }
}

function rawOffer(shop, price, extras = {}) {
  return mcpOffer({ shop, price, city: 'مشهد', ...extras })
}

function mcpDetails(name = title, offers = [rawOffer('fixture-a', 1360000), rawOffer('fixture-b', 1390000)]
  .map((offer) => ({ ...offer, product_title: name }))) {
  return { prk: fixture.prk, name_fa: name, offers, in_person_sellers: [] }
}

test('query expansion uses the named family and optional intercom context within five requests', () => {
  assert.deepEqual(buildSearchQueries(opts.productName, opts.sku), [
    'ماژول ریموتگ بتا', 'ریموتگ بتا', 'اکسس کنترل ریموتگ بتا',
    'برد کنترل دسترسی ریموتگ آیفون بتا', 'ماژول کارتی ریموتی آیفون بتا',
  ])
  assert.ok(buildSearchQueries(exactProduct).includes('RTG-A12'))
})

test('title aliases, Persian and Latin spelling, and matching codes can confirm identity', () => {
  const r = evaluateTorobCandidate({ productName: exactProduct }, { prk: 'exact', titleFa: '', titleEn: exactCard })
  assert.equal(r.status, 'MATCH_CONFIRMED')
  assert.equal(r.parsed.family, 'remotag')
  assert.deepEqual(r.parsed.brands, ['beta'])
  assert.equal(r.parsed.attrs.volt[0], 12)
  assert.ok(r.scoreComponents.model > 0 && r.scoreComponents.brand > 0)
  const detailSpec = evaluateTorobCandidate({ productName: exactProduct }, {
    prk: 'exact', titleFa: 'اکسس کنترل ریموتگ بتا',
    specs: [{ key: 'کد مدل', value: 'RTG-A12' }, { key: 'ولتاژ ورودی', value: '12' }],
  })
  assert.equal(detailSpec.status, 'MATCH_CONFIRMED')
})

test('an uncoded long title and a shorter family title require technical corroboration', () => {
  for (const titleFa of [title, 'ریموتگ بتا', 'ماژول ریموتگ بتا مخصوص آیفون صوتی']) {
    const r = evaluateTorobCandidate(evalTarget, { prk: 'review', titleFa })
    assert.equal(r.status, 'REVIEW_REQUIRED')
    assert.ok(r.score >= 45 && r.score < 80)
    assert.ok(r.blockers.some((reason) => /مدل دقیق/.test(reason)))
  }
})

test('same brand cannot hide model, pack, accessory or conflicting structured specifications', () => {
  const sameBrand = { productName: 'ماژول ریموتگ بتا مدل هوشمند ۱۲ ولت' }
  for (const titleFa of ['اکسس کنترل ریموتگ بتا مدل ساده ۱۲ ولت', 'کارت ریموتگ بتا', 'پک ۲ عددی ماژول ریموتگ بتا', 'ماژول ریموتگ پاناسونیک']) {
    assert.equal(evaluateTorobCandidate(sameBrand, { prk: 'wrong', titleFa }).status, 'IDENTITY_MISMATCH', titleFa)
  }
  assert.equal(evaluateTorobCandidate(sameBrand, {
    prk: 'bundle', titleFa: 'ماژول ریموتگ بتا مدل هوشمند ۱۲ ولت به همراه دو عدد کارت',
  }).status, 'REVIEW_REQUIRED')
  assert.equal(evaluateTorobCandidate({ productName: exactProduct }, {
    prk: 'wrong', titleFa: 'اکسس کنترل ریموتگ بتا مدل RTG-A24 ۲۴ ولت',
  }).status, 'IDENTITY_MISMATCH')
  const contradiction = evaluateTorobCandidate({ productName: exactProduct }, {
    prk: 'conflict', titleFa: exactCard, specs: [{ key: 'ولتاژ تغذیه', value: '۲۴ ولت' }],
  })
  assert.equal(contradiction.status, 'REVIEW_REQUIRED')
  assert.equal(contradiction.hasConflict, true)
  const bilingual = evaluateTorobCandidate({ productName: exactProduct }, {
    prk: 'different-codes', titleFa: 'ماژول ریموتگ بتا RTG-A24', titleEn: exactCard,
  })
  assert.equal(bilingual.status, 'REVIEW_REQUIRED')
  assert.equal(bilingual.hasConflict, true)
})

test('HSP aliases and structured remote specifications confirm the exact Torob card', () => {
  const result = evaluateTorobCandidate(remoteTarget, { prk: bazarCard.prk, titleFa: bazarCard.name_fa, priceToman: bazarCard.price_toman })
  assert.equal(result.status, 'MATCH_CONFIRMED')
  assert.deepEqual(result.parsed.brands, ['hsp'])
  assert.deepEqual(result.parsed.attrs.frequency, [315000000])
  assert.deepEqual(result.parsed.attrs.buttons, [5])
  assert.deepEqual(result.parsed.attrs.bluetooth, ['yes'])
  assert.deepEqual(result.parsed.words, ['بنزی'])

  for (const titleFa of [
    'ریموت بلوتوثی بنزی 315mhz پنج دکمه‌ای اچاسپی',
    'ریموت بلوتوثی بنزی فرکانس ۳۱۵ پنج کلیده Hsp',
    'ریموت بلوتوثی بنزی Hsp frequency 315 5-button',
    'ریموت کپی خور بلوتوثی بنزی ۳۱۵ مگا هرتز ۵ شاسی Hsp',
  ]) {
    const candidate = evaluateTorobCandidate(remoteTarget, { prk: 'alias', titleFa })
    assert.equal(candidate.status, 'MATCH_CONFIRMED', titleFa)
    assert.deepEqual(candidate.parsed.attrs.buttons, [5], titleFa)
  }
  const specs = evaluateTorobCandidate(remoteTarget, {
    prk: 'hsp-specs', titleFa: 'ریموت بلوتوثی بنزی Hsp', specs: [{ key: 'فرکانس کاری', value: '۳۱۵' }],
  })
  assert.equal(specs.status, 'MATCH_CONFIRMED')
  assert.deepEqual(specs.parsed.attrs.frequency, [315000000])
  assert.equal(specs.parsed.attrs.buttons, undefined)
})

test('wrong remote frequencies, button counts and counterfeit markers remain hard vetoes', () => {
  for (const [titleFa, reason] of [
    ['ریموت بلوتوثی 433 بنزی 5 دکمه Hsp', /فرکانس/],
    ['ریموت بلوتوثی بنزی ۴۳۳٫۹۲ مگاهرتز ۵ دکمه Hsp', /فرکانس/],
    ['ریموت بلوتوثی بنزی 125khz 5 دکمه Hsp', /فرکانس/],
    ['ریموت بلوتوثی 315 بنزی 4 دکمه Hsp', /تعداد دکمه/],
    ['ریموت بدون بلوتوث 315 بنزی 5 دکمه Hsp', /بلوتوث/],
    ['ریموت بلوتوثی 315 بنزی شانزده کلید Hsp', /تعداد دکمه/],
    ['ریموت بلوتوثی 315 بنزی 5 دکمه Hsp کپی خور های کپی', /غیراصل/],
    ['ریموت بلوتوثی 315 بنزی 5 دکمه Hsp کپی خور طرح اصل', /غیراصل/],
  ]) {
    const result = evaluateTorobCandidate(remoteTarget, { prk: 'wrong-hsp', titleFa })
    assert.equal(result.status, 'IDENTITY_MISMATCH', titleFa)
    assert.match(result.rejectReason, reason)
  }
  for (const unrelated of ['۳۱۵ ولت', '315 عددی', '315 میلی متر', '315Ω']) {
    const result = evaluateTorobCandidate(remoteTarget, { prk: 'no-frequency', titleFa: `ریموت بلوتوثی بنزی Hsp ${unrelated}` })
    assert.equal(result.parsed.attrs.frequency, undefined, unrelated)
  }
  const configured = evaluateTorobCandidate({ ...remoteTarget, rejectBelowPct: 1, approveAbovePct: 10 }, {
    prk: 'wrong-hsp', titleFa: 'ریموت بلوتوثی 433 بنزی 5 دکمه Hsp',
  })
  assert.equal(configured.status, 'IDENTITY_MISMATCH')
})

test('codeless discovery merges verified sellers with independent button and single-unit evidence', async (t) => {
  const queries = buildSearchQueries(remoteTarget.productName, remoteTarget.sku)
  assert.ok(queries.length <= 6)
  assert.ok(queries.includes('ریموت بنزی 315 hsp'))
  assert.ok(queries.includes('ریموت 315 hsp'))
  assert.ok(queries.includes('ریموت بنزی hsp'))
  assert.ok(queries.includes('ریموت بنزی'))
  assert.ok(queries.includes('ریموت بنزی 5 دکمه'))
  const fake = installFakeTorob({
    search: (query) => query === queries[0] ? [bazarCard] : query === 'ریموت بنزی hsp' ? [jahanCard] : [],
    details: {
      [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer] },
      [jahanCard.prk]: { ...jahanCard, offers: [verifiedJahanOffer] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, matchConfig: { aiIdentityEnabled: false } })
  assert.equal(source.torob.status, 'MATCH_CONFIRMED', source.torob.reason)
  assert.equal(source.prk, bazarCard.prk)
  assert.deepEqual(source.offers.map(({ shopName, price }) => [shopName, price]), [['بازار قفل', 580000], ['جهان ریموت', 750000]])
  assert.equal(source.totalSellerCount, 2)
  assert.deepEqual(source.meta.mergedPanelPrks, [bazarCard.prk, jahanCard.prk])
  assert.deepEqual(source.meta.panels, [{ prk: bazarCard.prk, sellerCount: 1 }, { prk: jahanCard.prk, sellerCount: 1 }])
  assert.deepEqual(fake.calls.filter(({ name }) => name === 'product_details').map(({ args }) => args.prk), [bazarCard.prk, jahanCard.prk])
  const sibling = source.torob.search.candidates.find(({ prk }) => prk === jahanCard.prk)
  assert.equal(sibling.titleFa, jahanCard.name_fa)
  assert.equal(sibling.extraction, 'extracted')
  assert.equal(sibling.inspection.status, 'MATCH_CONFIRMED')
  assert.ok(sibling.inspection.reasons.some((reason) => reason.includes('فروشنده')))
  assert.equal(source.offers[1].torobIdentity.packageUnits, 1)
  assert.deepEqual(source.offers[1].torobIdentity.specs.buttons, [5])
  assert.ok(source.offers.every(({ torobIdentity }) => torobIdentity.status === 'MATCH_CONFIRMED'))
})

test('the supplied Jahan Remote title is discoverable but cannot resolve the ambiguous ۵ عددی card', async (t) => {
  const sharedImage = 'https://fixture.invalid/remote.jpg'
  const fake = installFakeTorob({
    search: (query) => query === 'ریموت بنزی' ? [jahanCard] : [bazarCard],
    details: {
      [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer] },
      [jahanCard.prk]: { ...jahanCard, image: sharedImage, offers: [{ ...jahanOffer, image_url: sharedImage }] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
  const jahan = source.offers.find(({ shopName }) => shopName === 'جهان ریموت')
  assert.equal(jahan.listingTitle, jahanOffer.product_title)
  assert.equal(jahan.torobIdentity.status, 'REVIEW_REQUIRED')
  assert.equal(jahan.torobIdentity.sharedImage, true)
  assert.deepEqual(jahan.torobIdentity.specs.frequency, [315000000])
  assert.match(jahan.torobIdentity.reason, /تعداد دکمه/)
  assert.match(jahan.torobIdentity.reason, /عرضهٔ تکی/)
  const candidate = source.torob.search.candidates.find(({ prk }) => prk === jahanCard.prk)
  assert.equal(candidate.inspection.status, 'REVIEW_REQUIRED')
  assert.equal(candidate.inspection.origin, 'torob_mcp')
  assert.ok(candidate.queries.some((index) => source.torob.search.queries[index - 1].query === 'ریموت بنزی'))
  assert.equal(source.meta.mergedPanelPrks, undefined)
  const result = runPricingPipeline(source, withConfig({ ...remoteTarget, costPrice: 450000 }))
  assert.equal(result.offers.find(({ shopName }) => shopName === 'جهان ریموت').included, false)
  assert.equal(result.lowestValid, 580000)
})

test('codeless search keeps looking after a multi-seller match and inspects an unbranded card', async (t) => {
  const queries = buildSearchQueries(remoteTarget.productName, remoteTarget.sku)
  const unbranded = { prk: 'hsp-unbranded', name_fa: 'ریموت بنزی ۵ عددی', name_en: '', price_toman: 750000, shop_count: 1 }
  const established = { ...bazarCard, shop_count: 3 }
  const fake = installFakeTorob({
    search: (query) => query === queries[0] ? [established]
      : query === 'ریموت بنزی' ? [unbranded] : [],
    details: {
      [established.prk]: { ...established, offers: [
        bazarOffer,
        rawOffer('بازار قفل دو', 590000),
        rawOffer('بازار قفل سه', 600000),
      ] },
      [unbranded.prk]: { ...unbranded, offers: [jahanOffer] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, matchConfig: { aiIdentityEnabled: false } })
  assert.ok(fake.calls.some(({ name, args }) => name === 'search_products' && args.query === 'ریموت بنزی'))
  assert.ok(fake.calls.some(({ name, args }) => name === 'product_details' && args.prk === unbranded.prk))
  assert.ok(source.torob.search.candidates.some(({ prk, extraction }) => prk === unbranded.prk && extraction === 'extracted'))
})

test('a seller-corroborated card preserves its original Persian and English titles', async (t) => {
  const card = { ...jahanCard, name_fa: 'ریموت بنزی پنج تایی' }
  const fake = installFakeTorob({
    search: () => [card],
    details: { [card.prk]: { ...card, offers: [verifiedJahanOffer] } },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
  assert.equal(source.torob.status, 'MATCH_CONFIRMED', source.torob.reason)
  assert.equal(source.torob.titleOrigin, 'product_details')
  assert.equal(source.productTitle, card.name_fa)
  assert.equal(source.productTitleEn, card.name_en)
  assert.match(source.torob.reason, /مستقل فروشنده/)
})

test('real multi-packs and conflicting remote cards are rejected without probing seller evidence', async (t) => {
  const fake = installFakeTorob({
    search: () => [
      { ...jahanCard, price_toman: 2900000 },
      { ...jahanCard, prk: 'explicit-pack', name_fa: 'ریموت بنزی ۵ عددی پک' },
      { ...jahanCard, prk: 'explicit-buttons-pack', name_fa: 'ریموت بنزی ۵ دکمه ۵ عددی' },
      { ...jahanCard, prk: 'pack-wrong-frequency', name_fa: 'ریموت بنزی فرکانس ۴۳۳ ۵ عددی' },
      { ...jahanCard, prk: 'pack-wrong-buttons', name_fa: 'ریموت بنزی ۴ دکمه ۵ عددی' },
      { ...jahanCard, prk: 'pack-wrong-brand', name_en: 'Simaran' },
      { ...jahanCard, prk: 'pack-accessory', name_fa: 'ریموت بنزی پوسته ۵ عددی' },
      { ...jahanCard, prk: 'pack-bundle', name_fa: 'ریموت بنزی ۵ عددی به همراه دوربین مداربسته' },
      { ...jahanCard, prk: 'pack-used', name_fa: 'ریموت بنزی استوک ۵ عددی' },
      { ...jahanCard, prk: 'pack-model', name_fa: 'ریموت بنزی مدل ABC123 ۵ عددی' },
    ],
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
  assert.equal(source.torob.status, 'IDENTITY_MISMATCH')
  assert.equal(fake.calls.filter(({ name }) => name === 'product_details').length, 0)
  assert.ok(source.torob.search.candidates.every(({ extraction }) => extraction === 'not_requested'))
})

test('a conflicting seller never enters pricing and cannot promote an ambiguous card', async (t) => {
  for (const [card, status] of [[jahanCard, 'REVIEW_REQUIRED'], [bazarCard, 'MATCH_CONFIRMED']]) {
    await t.test(card.prk, async (t) => {
      const fake = installFakeTorob({
        search: () => [{ ...card, shop_count: 2 }],
        details: {
          [card.prk]: { ...card, offers: [
            verifiedJahanOffer,
            { ...rawOffer('فروشنده دیگر', 560000), product_title: jahanOffer.product_title.replace('315', '433') },
          ] },
        },
      })
      t.after(fake.restore)
      const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
      assert.equal(source.torob.status, status)
      const wrong = source.offers.find(({ shopName }) => shopName === 'فروشنده دیگر')
      assert.equal(wrong.torobIdentity.status, 'IDENTITY_MISMATCH')
      const result = runPricingPipeline(source, withConfig({ ...remoteTarget, costPrice: 450000 }))
      assert.equal(result.offers.find(({ shopName }) => shopName === wrong.shopName).included, false)
      assert.equal(source.torob.selected.extraction, 'extracted')
      assert.equal(source.meta.mergedPanelPrks, undefined)
      assert.equal(fake.calls.filter(({ name }) => name === 'product_details').length, 1)
    })
  }
})

test('a low-scoring incomplete codeless title can be corroborated without a pack label', async (t) => {
  const card = { ...jahanCard, name_fa: 'ریموت' }
  const fake = installFakeTorob({
    search: () => [card],
    details: { [card.prk]: { ...card, offers: [verifiedJahanOffer] } },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({
    ...opts, ...remoteTarget, matchConfig: { rejectBelowPct: 70, approveAbovePct: 90 },
  })
  assert.equal(source.torob.search.candidates[0].status, 'IDENTITY_MISMATCH')
  assert.equal(source.torob.status, 'MATCH_CONFIRMED', source.torob.reason)
  assert.equal(fake.calls.filter(({ name }) => name === 'product_details').length, 1)
})

test('separately corroborated cards with conflicting button counts require review', async (t) => {
  const cards = [4, 5].map((buttons) => ({
    prk: `hsp-${buttons}`, name_fa: 'ریموت بنزی Hsp', price_toman: 590000, shop_count: 1,
    offers: [{ ...rawOffer(`shop-${buttons}`, 590000), product_title: `ریموت بلوتوثی 315 بنزی ${buttons} دکمه Hsp` }],
  }))
  const fake = installFakeTorob({
    search: () => cards,
    details: Object.fromEntries(cards.map((card) => [card.prk, card])),
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, productName: 'ریموت بلوتوثی 315 بنزی (Hsp)' })
  assert.equal(source.torob.status, 'REVIEW_REQUIRED', source.torob.reason)
  assert.match(source.torob.reason, /مشخصات متفاوت/)
  assert.equal(source.meta.mergedPanelPrks, undefined)
})

test('seller identity gates pricing before statistics, including prices below the valid market', async (t) => {
  const valid = [580000, 590000, 600000].map((price, i) => ({
    ...rawOffer(`valid-${i}`, price), product_title: bazarCard.name_fa,
  }))
  const unverified = [
    { ...rawOffer('no-title', 450000) },
    { ...rawOffer('no-buttons', 460000), product_title: jahanOffer.product_title },
    { ...rawOffer('wrong-buttons', 470000), product_title: bazarCard.name_fa.replace('5 دکمه', '4 دکمه') },
    { ...rawOffer('contradictory-spec', 480000), product_title: bazarCard.name_fa, specs: [{ key: 'تعداد دکمه', value: '۴' }] },
    { ...rawOffer('shell', 490000), product_title: `قاب ${bazarCard.name_fa}` },
    { ...rawOffer('pack', 500000), product_title: bazarCard.name_fa, specs: [{ key: 'تعداد در بسته', value: '۵' }] },
  ]
  const listingResults = async (offers) => {
    const fake = installFakeTorob({ details: { [bazarCard.prk]: { ...bazarCard, offers } } })
    try {
      const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, prk: bazarCard.prk })
      return runPricingPipeline(source, withConfig({ ...remoteTarget, costPrice: 450000 }))
    } finally {
      fake.restore()
    }
  }
  const before = await listingResults(valid)
  const mixed = await listingResults([...unverified, ...valid])
  assert.ok(before.finalPrice > 0)
  for (const key of ['lowestValid', 'marketMedian', 'finalPrice', 'basePrice', 'confidence', 'offersUsed']) {
    assert.equal(mixed[key], before[key], key)
  }
  assert.deepEqual(mixed.torobInquiry.offerIdentityCounts, { MATCH_CONFIRMED: 3, REVIEW_REQUIRED: 2, IDENTITY_MISMATCH: 4 })
  for (const offer of mixed.offers.filter(({ shopName }) => !shopName.startsWith('valid'))) {
    assert.equal(offer.included, false)
    assert.equal(offer.weight, 0)
  }
})

test('search and details stay bounded and reserve a probe in crowded results', async (t) => {
  const crowded = Array.from({ length: 26 }, (_, i) => ({
    ...bazarCard, prk: `crowded-${i}`, name_fa: 'ریموت بنزی Hsp',
  }))
  const fake = installFakeTorob({
    search: (query) => query === 'ریموت بنزی' ? [jahanCard, ...crowded] : [bazarCard, ...crowded],
    details: {
      [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer] },
      [jahanCard.prk]: { ...jahanCard, offers: [verifiedJahanOffer] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
  assert.equal(fake.calls.filter(({ name }) => name === 'search_products').length, 6)
  assert.equal(fake.calls.filter(({ name }) => name === 'product_details').length, 4)
  assert.ok(source.torob.search.queries.every(({ mapped }) => mapped === 24))
  assert.ok(source.torob.search.candidates.every(({ prk }) => prk !== 'crowded-25'))
  assert.deepEqual(source.meta.mergedPanelPrks, [bazarCard.prk, jahanCard.prk])
})

test('a cached codeless id is a discovery hint and duplicate confirmed sellers count once', async (t) => {
  const fake = installFakeTorob({
    search: () => [jahanCard],
    details: {
      [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer] },
      [jahanCard.prk]: { ...jahanCard, offers: [
        verifiedJahanOffer,
        { ...bazarOffer, product_title: `${bazarCard.name_fa} تکی` },
      ] },
    },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, cachedPrk: bazarCard.prk })
  assert.ok(fake.calls.some(({ name }) => name === 'search_products'))
  assert.deepEqual(new Set(source.meta.mergedPanelPrks), new Set([bazarCard.prk, jahanCard.prk]))
  assert.equal(source.offers.filter(({ shopName }) => shopName === 'بازار قفل').length, 1)
})

test('missing seller rows and contradictory titles from repeated searches remain auditable', async (t) => {
  const queries = buildSearchQueries(remoteTarget.productName, remoteTarget.sku)
  const fake = installFakeTorob({
    search: (query) => [query === queries[0] ? bazarCard : { ...bazarCard, name_fa: bazarCard.name_fa.replace('315', '433') }],
    details: { [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer] } },
  })
  t.after(fake.restore)
  const conflict = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget })
  assert.equal(conflict.torob.status, 'REVIEW_REQUIRED')
  assert.match(conflict.torob.reason, /متناقض/)
  assert.equal(conflict.torob.search.candidates[0].observations.length, 6)
  fake.restore()
  const partial = installFakeTorob({ details: { [bazarCard.prk]: { ...bazarCard, offers: [bazarOffer, {}] } } })
  t.after(partial.restore)
  const incomplete = await fetchViaTorobMcpServer({ ...opts, ...remoteTarget, prk: bazarCard.prk })
  assert.equal(incomplete.torob.status, 'EXTRACTION_INCOMPLETE')
  assert.equal(incomplete.offers[0].torobIdentity.status, 'REVIEW_REQUIRED')
  assert.equal(runPricingPipeline(incomplete, withConfig({ ...remoteTarget, costPrice: 450000 })).finalPrice, null)
})

test('raw title states distinguish source omission, parse failure, and mapping loss', () => {
  const rows = [
    { random_key: 'omitted' },
    { random_key: 'unknown', display_title: { fa: title } },
    { random_key: 'mapped', title_fa: title },
    { random_key: 'vendor', title_source_fields: ['listing_title'], name_fa: null },
  ]
  const { candidates } = decodeTorobSearch({ data: { results: rows } }, 24)
  const states = candidates.map((card) => evaluateTorobCandidate(evalTarget, card).titleState)
  assert.deepEqual(states, ['source_missing', 'parser_missing', 'present', 'parser_missing'])
  assert.equal(evaluateTorobCandidate(evalTarget, { ...candidates[2], titleFa: '' }).titleState, 'mapping_missing')
  assert.equal(candidates[2].titleFa, title)
  assert.equal(decodeTorobSearch({ results: [{ url: `https://torob.com/p/${fixture.prk}/`, title }] }, 24).candidates[0].prk, fixture.prk)
  assert.equal(decodeTorobSearch({ results: { items: rows } }, 24).issue, 'search_schema')
})

test('prices accept declared rial or toman and reject unsupported currencies', () => {
  assert.equal(torobPrice('۱۲٬۰۰۰٬۰۰۰ ریال'), 1200000)
  assert.equal(torobPrice('۱۲٬۰۰۰٬۰۰۰ ﷼'), 1200000)
  assert.equal(torobPrice('۱٬۲۰۰٬۰۰۰', 'IRT'), 1200000)
  assert.equal(torobPrice(12000000, 'IRR'), 1200000)
  assert.equal(torobPrice(12000000, 'USD'), 0)
  assert.equal(torobPrice('12000000 USD'), 0)
})

test('direct API replays 22 rows with a full audit and extracts offers for the review card', async (t) => {
  setEnv(t, 'TOROB_MCP_URL', null)
  setEnv(t, 'TOROB_API_BASE', null)
  const queries = buildSearchQueries(opts.productName, opts.sku)
  const calls = t.mock.method(globalThis, 'fetch', async (url) => {
    const request = new URL(url)
    if (request.pathname.endsWith('/search/')) {
      return Response.json(request.searchParams.get('q') === queries[0] ? fixture.search : { results: [known] })
    }
    if (request.pathname.endsWith('/details/')) {
      assert.equal(request.searchParams.get('prk'), fixture.prk)
      assert.equal(request.searchParams.get('search_id'), 'fixture-context')
      return Response.json(fixture.details)
    }
    assert.fail(`Unexpected Torob request ${request.pathname}`)
  })
  const source = await torobAdapter.fetchOffers({ ...fixture.product, sourceType: 'torob' })
  assert.equal(source.torob.search.queries[0].rows, 22)
  assert.equal(source.torob.search.candidates.length, 22)
  assert.equal(source.torob.search.accepted, 0)
  assert.equal(source.torob.search.eligible, 1)
  assert.equal(source.torob.search.queries.length, 5)
  assert.equal(source.prk, fixture.prk)
  assert.equal(source.productTitle, title)
  assert.equal(source.torob.titleOrigin, 'search_card')
  assert.equal(new URL(source.detailsUrl).searchParams.has('search_id'), false)
  assert.equal(calls.mock.callCount(), 6)
  const candidate = source.torob.search.candidates.find(({ prk }) => prk === fixture.prk)
  assert.equal(candidate.observations[0].titleFa, title)
  assert.equal(candidate.extraction, 'extracted')
  assert.equal(candidate.score, 74)
  assert.equal(source.torob.status, 'REVIEW_REQUIRED')
  assert.deepEqual(source.offers.map(({ price }) => price), [1360000, 1390000, 1420000])
  assert.equal(source.offers[0].listingTitle, fixture.details.products_info.result[0].name1)
  assert.equal(source.offers[0].currency, 'toman')
  assert.equal(source.offers[0].url, 'https://shop-a.example/products/remotag')
  assert.ok(source.offers[0].observedAt instanceof Date)
  assert.equal(source.fetchedAt - source.offers[0].lastChangedAt, 7200000)
  assert.equal(source.offers[1].sellerType, 'online')
  assert.equal(source.offers[1].shopCity, 'مشهد')
  assert.equal(source.offers[2].inStock, false)
  const result = runPricingPipeline(source, withConfig())
  assert.equal(result.torobInquiry.status, 'REVIEW_REQUIRED')
  assert.equal(result.torobInquiry.extractedOffers, 3)
  assert.equal(result.torobInquiry.validOffers, null)
  assert.equal(result.rejectedBySupervisor, false)
  assert.equal(result.strategy, 'no_data')
  assert.equal(result.finalPrice, null)
  assert.equal(result.discountPct, null)
  assert.ok(result.offers.every((offer) => !offer.included))
  if (process.env.TOROB_SHOW_REPLAY === '1') console.log(JSON.stringify({ provenance: fixture.provenance,
    search: source.torob.search, selected: source.torob.selected, inquiry: result.torobInquiry }))
})

test('an expansion can find an id absent from the first response and merge a later title', async (t) => {
  const queries = buildSearchQueries(opts.productName, opts.sku)
  const blank = { prk: fixture.prk, name_fa: null, url: `https://torob.com/p/${fixture.prk}/` }
  const fake = installFakeTorob({
    search: (q) => q === queries[0] ? [fixture.search.results[0]]
      : q === queries[1] ? [blank] : [{ ...blank, name_fa: title }],
    details: { [fixture.prk]: mcpDetails(null) },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer(opts)
  const candidate = source.torob.search.candidates.find(({ prk }) => prk === fixture.prk)
  assert.equal(candidate.queries[0], 2)
  assert.equal(candidate.observations[0].titleFa, null)
  assert.equal(candidate.titleFa, title)
  assert.equal(fake.calls.filter(({ name }) => name === 'product_details').length, 1)
})

test('a blank search card is hydrated from product details, including a Latin-only title', async (t) => {
  const fake = installFakeTorob({
    search: () => [{ prk: fixture.prk, name_fa: null }],
    details: { [fixture.prk]: { ...mcpDetails(exactCard), name_fa: null, name_en: exactCard } },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, productName: exactProduct })
  assert.equal(source.torob.search.candidates[0].titleState, 'source_missing')
  assert.equal(source.torob.titleOrigin, 'product_details')
  assert.equal(source.productTitleEn, exactCard)
  assert.equal(source.torob.status, 'MATCH_CONFIRMED')
  assert.equal(runPricingPipeline(source, withConfig({ productName: exactProduct })).supervisor.gates.identity_match.verdict, 'approve')
})

test('seller titles are preserved as evidence without becoming the panel title', async (t) => {
  const fake = installFakeTorob({
    details: { [fixture.prk]: mcpDetails(null, [{ ...rawOffer('fixture-shop', 1380000), product_title: title }]) },
  })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, prk: fixture.prk })
  const result = runPricingPipeline(source, withConfig({ costPrice: 1150000 }))
  assert.equal(source.torob.titleOrigin, 'seller_listing')
  assert.equal(source.productTitle, undefined)
  assert.equal(source.meta.sellerTitle, title)
  assert.equal(result.torobInquiry.status, 'EXTRACTION_INCOMPLETE')
  assert.equal(result.torobInquiry.extractedOffers, 1)
  assert.equal(result.torobInquiry.validOffers, null)
  assert.equal(result.finalPrice, null)
  assert.equal(result.supervisor.gates.identity_match.maxScorePct, 70)
  assert.equal(result.supervisor.gates.identity_match.verdict, 'review')
  fake.restore()
  const subq = mockSubq(t, 1)
  const enriched = await enrichSupervisorWithSubqApi(result.supervisor, subq.config)
  assert.equal(subq.fetch.mock.callCount(), 0)
  assert.equal(enriched.apiStatus, 'skipped')
})

test('a stored id with an unavailable details payload stays reviewable with an unknown seller count', async (t) => {
  const fake = installFakeTorob({})
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, prk: fixture.prk })
  const result = runPricingPipeline(source, withConfig({ costPrice: 1000000 }))
  assert.deepEqual(fake.calls.map(({ name }) => name), ['product_details'])
  assert.equal(source.torob.status, 'EXTRACTION_INCOMPLETE')
  assert.equal(result.torobInquiry.sellerRows, null)
  assert.equal(result.torobInquiry.reportedSellers, null)
  assert.equal(result.torobInquiry.validOffers, null)
  assert.equal(result.finalPrice, null)
})

test('empty successful details and changed detail envelopes have separate outcomes', async (t) => {
  const resultFor = async (reply) => {
    const spy = t.mock.method(globalThis, 'fetch', async () => Response.json({ result: { structuredContent: reply } }))
    try {
      return await fetchViaTorobMcpServer({ ...opts, productName: exactProduct, prk: fixture.prk })
    } finally {
      spy.mock.restore()
    }
  }
  const empty = await resultFor({ data: mcpDetails(exactCard, []) })
  const result = runPricingPipeline(empty, withConfig({ productName: exactProduct }))
  assert.equal(result.torobInquiry.status, 'NO_VALID_OFFERS')
  assert.equal(result.torobInquiry.validOffers, 0)
  assert.equal(result.torobInquiry.sellerRows, 0)
  const unparsed = await resultFor({ prk: fixture.prk, name_en: exactCard, offers: { items: [] }, in_person_sellers: [] })
  assert.equal(unparsed.torob.status, 'EXTRACTION_INCOMPLETE')
  const wrong = await resultFor({ ...mcpDetails(exactCard), prk: 'other-card' })
  assert.equal(wrong.torob.status, 'EXTRACTION_INCOMPLETE')
  assert.equal(wrong.offers.length, 0)
})

test('a saved human confirmation is scoped to its id and still checks later conflicting evidence', async (t) => {
  const fake = installFakeTorob({ details: { [fixture.prk]: mcpDetails() } })
  t.after(fake.restore)
  const linked = await fetchViaTorobMcpServer({ ...opts, prk: fixture.prk, confirmation })
  const other = await fetchViaTorobMcpServer({ ...opts, prk: fixture.prk, confirmation: { ...confirmation, prk: 'other-card' } })
  const wrong = await fetchViaTorobMcpServer({ ...opts, productName: 'ماژول ریموتگ بتا مدل ساده', prk: fixture.prk, confirmation })
  assert.equal(linked.torob.identityStatus, 'MATCH_CONFIRMED')
  assert.equal(linked.torob.status, 'REVIEW_REQUIRED')
  assert.equal(linked.torob.adminConfirmed, true)
  assert.equal(other.torob.status, 'REVIEW_REQUIRED')
  assert.equal(wrong.torob.status, 'IDENTITY_MISMATCH')
  assert.equal(fake.calls.filter(({ name }) => name === 'search_products').length, 0)
})

test('valid national offers, local in-person counts, stale data, shop trust and Market-Maker are independent', async (t) => {
  const fresh = [1360000, 1370000, 1380000, 1390000, 1400000].map((price, index) => rawOffer(`fresh-${index}`, price))
  const noisy = [
    rawOffer('stale', 1320000, { ageDays: 400 }),
    rawOffer('poor-score', 1350000, { score: 2 }),
    rawOffer('outlier', 7000000),
    rawOffer('unreliable', 1300000, { unreliable: true }),
  ]
  const fake = installFakeTorob({ details: { [fixture.prk]: mcpDetails(exactCard,
    [...fresh, ...noisy].map((offer) => ({ ...offer, product_title: exactCard }))) } })
  t.after(fake.restore)
  const source = await fetchViaTorobMcpServer({ ...opts, productName: exactProduct, prk: fixture.prk })
  const ctx = withConfig({ productName: exactProduct })
  ctx.config.filters.minShopScore = 3.5
  const provisional = runPricingPipeline(source, ctx)
  assert.equal(provisional.torobInquiry.extractedOffers, 9)
  assert.equal(provisional.torobInquiry.validOnlineOffers, 5)
  assert.equal(provisional.torobInquiry.validLocalInPersonOffers, 0)
  for (const [shop, reason] of [['stale', /قدیمی/], ['poor-score', /امتیاز/], ['outlier', /پرت|بالا/], ['unreliable', /غیرقابل اعتماد/]]) {
    assert.match(provisional.offers.find((offer) => offer.shopName === shop).excludeReason, reason)
  }
  assert.equal(provisional.supply.usedMarketConsensusFloor, false)
  assert.equal(provisional.isProvisional, true)
  assert.equal(provisional.needsReview, true)
  assert.equal(provisional.discountPct ?? 0, 0)
  ctx.config.sourcing.allowMarketMakerWithoutCost = true
  const marketMaker = runPricingPipeline(source, ctx)
  assert.equal(marketMaker.supply.usedMarketConsensusFloor, true)
  assert.equal(marketMaker.supply.effectiveCostPrice, 0)
  assert.ok(marketMaker.finalPrice >= marketMaker.supply.hardFloorPrice)
})

test('SubQ cannot approve incomplete or structurally rejected candidates and its raw score is recorded', async (t) => {
  const fake = installFakeTorob({ details: { [fixture.prk]: mcpDetails() } })
  const review = await fetchViaTorobMcpServer({ ...opts, prk: fixture.prk })
  const mismatch = await fetchViaTorobMcpServer({ ...opts, productName: 'ماژول ریموتگ بتا مدل ساده', prk: fixture.prk })
  fake.restore()
  const subq = mockSubq(t, 0.99)
  const report = await enrichSupervisorWithSubqApi(runPricingPipeline(review, withConfig()).supervisor, subq.config)
  assert.equal(report.torobInquiryStatus, 'REVIEW_REQUIRED')
  assert.equal(report.gates.identity_match.localScorePct, 74)
  assert.equal(report.gates.identity_match.subqScorePct, 99)
  assert.equal(report.gates.identity_match.blendedScorePct, 87)
  assert.equal(report.gates.identity_match.verdict, 'review')
  const blocked = await enrichSupervisorWithSubqApi(runPricingPipeline(mismatch, withConfig()).supervisor, {
    ...subq.config, mode: 'subq_api_only',
  })
  assert.equal(blocked.gates.identity_match.verdict, 'reject')
  assert.equal(blocked.verdict, 'reject')
  const state = JSON.parse(subq.fetch.mock.calls[0].arguments[1].body).state
  assert.ok(state.includes(title) && !state.includes('SupplyCost') && !state.includes('ProfitGuard'))
})

test('a low SubQ vote on a structurally confirmed candidate requests review', async (t) => {
  const fake = installFakeTorob({ details: { [fixture.prk]: mcpDetails(exactCard) } })
  const source = await fetchViaTorobMcpServer({ ...opts, productName: exactProduct, prk: fixture.prk })
  fake.restore()
  const subq = mockSubq(t, 0.18)
  const report = await enrichSupervisorWithSubqApi(runPricingPipeline(source, withConfig({ productName: exactProduct })).supervisor, subq.config)
  assert.equal(report.torobInquiryStatus, 'REVIEW_REQUIRED')
  assert.equal(report.gates.identity_match.localScorePct, 100)
  assert.equal(report.gates.identity_match.subqScorePct, 18)
  assert.equal(report.gates.identity_match.blendedScorePct, 59)
  assert.equal(report.verdict, 'review')
})

test('disconnects and temporary failures can recover in bounded discovery, but rate limits stop it', async (t) => {
  let searchCalls = 0
  const mock = t.mock.method(globalThis, 'fetch', async (_url, req) => {
    const { name } = JSON.parse(req.body).params
    if (name === 'search_products' && ++searchCalls === 1) throw new TypeError('fixture socket closed')
    if (name === 'search_products' && searchCalls === 2) return new Response(null, { status: 503 })
    const data = name === 'search_products' ? { products: [{ prk: fixture.prk, name_en: exactCard }] }
      : name === 'product_details' ? mcpDetails(exactCard) : { series: [] }
    return Response.json({ result: { structuredContent: data } })
  })
  const recovered = await fetchViaTorobMcpServer({ ...opts, productName: exactProduct })
  assert.equal(recovered.torob.status, 'MATCH_CONFIRMED')
  assert.equal(searchCalls, 3)
  assert.deepEqual(recovered.torob.search.queries.map(({ issue }) => issue), ['mcp_connection', 'mcp_http_503', undefined])
  mock.mock.restore()
  const rateLimited = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 429 }))
  const denied = await fetchViaTorobMcpServer({ ...opts, fallbackSearch: async () => assert.fail('access restriction cannot trigger fallback') })
  assert.equal(denied.torob.status, 'SOURCE_UNAVAILABLE')
  assert.equal(denied.torob.reportedSellers, null)
  assert.equal(rateLimited.mock.callCount(), 1)
})

test('MCP timeout covers the response body as well as headers', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"result":')
  })
  server.listen(0, '127.0.0.1')
  t.after(() => { server.closeAllConnections(); server.close() })
  await once(server, 'listening')
  const timedOut = await callTorobMcpToolWithDiag(`http://127.0.0.1:${server.address().port}`, 'product_details', {}, 80)
  assert.equal(timedOut.issue, 'mcp_timeout')
  assert.equal(timedOut.unavailable, true)
})
