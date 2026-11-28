'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { installFakeTorob } = require('./helpers/fake-torob-mcp.cjs')
const { listMigrations } = require('../scripts/migrate.cjs')
const fixture = require('./fixtures/torob-wall-remote-incident.json')

const { resolveTorobSource, buildSearchQueryPlan } = loadTsModule('src/lib/sources/torob-discovery.ts')
const { fetchViaTorobMcpServer } = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { torobAdapter } = loadTsModule('src/lib/sources/torob.ts')
const { TorobDiscoveryCache } = loadTsModule('src/lib/sources/torob-cache.ts')
const { decodeTorobDetails } = loadTsModule('src/lib/sources/torob-payload.ts')
const { InMemoryTorobHybridIndex, canonicalizeCatalogEntry, buildLinkRecordsFromSource } = loadTsModule('src/lib/sources/torob-index.ts')
const { parseTitle, parseIdentityTitle } = loadTsModule('src/lib/pricing/match/parse.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')

const NOW = new Date('2026-11-27T14:00:00.000Z')

function makeConfig(overrides = {}) {
  const base = structuredClone(DEFAULT_PROFILE_CONFIG)
  return {
    ...base,
    ...overrides,
    filters: { ...base.filters, ...(overrides.filters || {}) },
    discovery: { ...base.discovery, ...(overrides.discovery || {}) },
    supervisor: { ...base.supervisor, enabled: false, ...(overrides.supervisor || {}) },
  }
}

function makeOffer(shop, price, title, { id = shop, city = 'تهران', ageDays = 0.2, inStock = true, adv = false, unreliable = false, specs } = {}) {
  return {
    shopName: shop,
    shopId: id,
    shopCity: city,
    price,
    currency: 'toman',
    observedAt: NOW,
    lastChangedAt: new Date(NOW.getTime() - ageDays * 86400000),
    listingTitle: title,
    listingSpecs: specs,
    inStock,
    isAd: adv,
    priceUnreliable: unreliable,
    sellerType: 'online',
    shopScore: 4.7,
    shopVotes: 80,
  }
}

function makeDetails(prk, titleFa, offers, { titleEn = null, specs = [], totalSellerCount, truncated = false } = {}) {
  return {
    prk,
    titleFa,
    titleEn,
    titleEvidence: { fields: ['name1'], parsed: true },
    specs,
    offers,
    sellerRows: offers.length,
    totalSellerCount: totalSellerCount ?? offers.length,
    inPersonSellerCount: 0,
    onlineOfferCount: offers.length,
    offersTruncated: truncated,
  }
}

function cardFromFixture(card, overrides = {}) {
  return {
    random_key: card.prk,
    name1: card.name_fa,
    name2: card.name_en ?? null,
    price: card.price_toman,
    shop_count: card.shop_count,
    ...overrides,
  }
}

function detailsFromFixture(card, extraSpecs = [], overrides = {}) {
  return makeDetails(
    card.prk,
    overrides.titleFa ?? card.name_fa,
    (overrides.offers ?? card.offers).map((o) =>
      makeOffer(o.shop_name, o.price_toman, overrides.listingTitle ?? o.product_title, {
        id: o.shop_id,
        city: o.shop_city,
        inStock: o.in_stock !== false,
        adv: Boolean(o.is_ad),
        specs: o.specs,
      }),
    ),
    {
      titleEn: overrides.titleEn ?? card.name_en ?? null,
      specs: extraSpecs,
      totalSellerCount: overrides.totalSellerCount ?? card.shop_count,
      truncated: Boolean(overrides.truncated),
    },
  )
}

// ---------- Scenario A & Spec Parsing ----------

test('Incident Scenario A & Query Plan: multi-descriptor wall remote query planning avoids طرح لرن and reaches both cards', () => {
  const plan = buildSearchQueryPlan(fixture.target.name, fixture.target.sku)
  const queries = plan.map((q) => q.query)
  assert.ok(!queries.some((q) => q.includes('طرح لرن')), `must not emit bogus طرح لرن query: ${JSON.stringify(queries)}`)
  assert.ok(queries.some((q) => q.includes('دیواری') && q.includes('433')), 'must include wall + frequency query')
  assert.ok(queries.some((q) => q.includes('کد لرن')), 'must include کد لرن synonym query')
  assert.ok(queries.some((q) => q.includes('طرح درپا')), 'must preserve actual designStyle طرح درپا')

  // Structured channel count parsing from Torob specs works alongside frequency & buttons
  const parsedWithSpecs = parseIdentityTitle('ریموت دیواری کد لرن 433 مگاهرتز', [{ key: 'تعداد کانال', value: '3' }])
  assert.deepEqual(parsedWithSpecs.attrs.ch, [3])
  assert.deepEqual(parsedWithSpecs.attrs.frequency, [433000000])
})

// ---------- Scenario B: Unverified consolidated Card B (بلوتوثی vs لرن) surfaces first as REVIEW_REQUIRED without fake auto-confirm ----------

test('Incident Scenario B: ambiguous multi-seller Card B is discovered alongside self-only Card A and prioritized for review without auto-confirming', async () => {
  const cardA = fixture.cards.cardA_selfOnly
  const cardB = fixture.cards.cardB_observedAmbiguous
  const res = await resolveTorobSource({
    productName: fixture.target.name,
    sku: fixture.target.sku,
    anchorPriceToman: fixture.target.anchorPriceToman,
    matchConfig: {
      ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames,
      ownShopIds: DEFAULT_PROFILE_CONFIG.filters.ownShopIds,
    },
    now: NOW,
    via: 'test',
    search: async (req) => {
      if (req.query.includes('دیواری') && req.query.includes('433')) {
        return { data: { results: [cardFromFixture(cardA), cardFromFixture(cardB)], count: 2, next: null }, origin: 'torob_mcp' }
      }
      return { data: { results: [cardFromFixture(cardA)], count: 1, next: null }, origin: 'torob_mcp' }
    },
    details: async (card) => {
      if (card.prk === cardA.prk) return { data: detailsFromFixture(cardA), origin: 'torob_mcp' }
      if (card.prk === cardB.prk) return { data: detailsFromFixture(cardB), origin: 'torob_mcp' }
      return { unavailable: true }
    },
    priceTrend: async () => null,
  })

  // Both panels discovered & evaluated
  const evA = res.torob.panelEvidence.find((p) => p.prk === cardA.prk)
  const evB = res.torob.panelEvidence.find((p) => p.prk === cardB.prk)
  assert.ok(evA && evB, 'both Card A and Card B must be in panelEvidence')
  assert.equal(evA.ownStoreOfferCount, 1)
  assert.equal(evA.uniqueExternalSellerCount, 0)
  assert.equal(evA.groupRole, 'self_only')
  assert.equal(evB.ownStoreOfferCount, 1)
  assert.equal(evB.uniqueExternalSellerCount, 6)

  // Honest REVIEW_REQUIRED (never fake-confirming brandless/bluetooth differences), yet prioritizing 6-seller Card B over self-only Card A
  assert.equal(res.torob.status, 'REVIEW_REQUIRED')
  assert.equal(res.prk, cardB.prk)
  assert.equal(res.torob.ownStoreOnlyOnPrimary, false)

  const priced = runPricingPipeline(res, {
    productId: 101,
    productName: fixture.target.name,
    sku: fixture.target.sku,
    costPrice: fixture.target.costPrice,
    supplierQuotes: [],
    config: makeConfig(),
    now: NOW,
  })
  assert.equal(priced.needsReview, true)
  assert.equal(priced.torobInquiry.validOffers, null)
  assert.equal(priced.torobInquiry.panelEvidence.length, 2)
})

// ---------- Scenario C & Cases 1 & 2: Verified Consolidated Card B ALWAYS beats Self-Only Card A regardless of discovery order ----------

test('Incident Scenario C & Cases 1, 2: verified consolidated card beats self-only Card A regardless of search order and excludes EKG Kala from pricing', async () => {
  const cardASelf = {
    prk: 'wall-self-coded-a',
    titleFa: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz',
    offers: [makeOffer('ای کا جی کالا', 250000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz', { id: 'ekg-1' })],
  }
  const cardBConsol = {
    prk: 'wall-consol-coded-b',
    titleFa: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز',
    offers: [
      makeOffer('ای کا جی کالا', 250000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'ekg-1' }),
      makeOffer('تهران گیت', 215000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c1' }),
      makeOffer('امنیت پارس', 220000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c2' }),
      makeOffer('دیجی ریموت', 224000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c3' }),
      makeOffer('الکترو شرق', 229000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c4' }),
      makeOffer('کیفیت کنترل', 235000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c5' }),
      makeOffer('آلفا کنترل', 240000, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', { id: 'c6' }),
    ],
  }

  for (const order of ['self_first', 'consolidated_first']) {
    const searchResults = order === 'self_first'
      ? [
          { random_key: cardASelf.prk, name1: cardASelf.titleFa, price: 250000, shop_count: 1 },
          { random_key: cardBConsol.prk, name1: cardBConsol.titleFa, price: 215000, shop_count: 7 },
        ]
      : [
          { random_key: cardBConsol.prk, name1: cardBConsol.titleFa, price: 215000, shop_count: 7 },
          { random_key: cardASelf.prk, name1: cardASelf.titleFa, price: 250000, shop_count: 1 },
        ]

    const src = await resolveTorobSource({
      productName: fixture.codedEquivalentTarget.name,
      sku: fixture.codedEquivalentTarget.sku,
      anchorPriceToman: fixture.codedEquivalentTarget.anchorPriceToman,
      cachedPrk: cardASelf.prk, // Even with cachedPrk pointing to self-only A!
      matchConfig: {
        ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames,
        ownShopIds: DEFAULT_PROFILE_CONFIG.filters.ownShopIds,
      },
      now: NOW,
      via: 'test',
      search: async () => ({ data: { results: searchResults, count: 2, next: null }, origin: 'torob_mcp' }),
      details: async (c) => {
        if (c.prk === cardASelf.prk) return { data: makeDetails(cardASelf.prk, cardASelf.titleFa, cardASelf.offers), origin: 'torob_mcp' }
        if (c.prk === cardBConsol.prk) return { data: makeDetails(cardBConsol.prk, cardBConsol.titleFa, cardBConsol.offers), origin: 'torob_mcp' }
        return { unavailable: true }
      },
      priceTrend: async () => null,
    })

    assert.equal(src.prk, cardBConsol.prk, `${order}: consolidated card must win`)
    assert.equal(src.torob.status, 'MATCH_CONFIRMED')
    assert.equal(src.torob.ownStoreOnlyOnPrimary, false)
    assert.deepEqual(src.torob.selectedPanelPrks, [cardBConsol.prk])
    assert.ok(src.torob.selfOnlyPanelPrks.includes(cardASelf.prk), 'self-only Card A isolated into selfOnlyPanelPrks')

    const priced = runPricingPipeline(src, {
      productId: 102,
      productName: fixture.codedEquivalentTarget.name,
      sku: fixture.codedEquivalentTarget.sku,
      costPrice: fixture.codedEquivalentTarget.costPrice,
      supplierQuotes: [],
      config: makeConfig(),
      now: NOW,
    })
    assert.equal(priced.torobInquiry.status, 'MATCH_CONFIRMED')
    assert.equal(priced.torobInquiry.validOffers, 6)
    assert.equal(priced.offersUsed, 6)
    assert.equal(priced.lowestValid, 215000, 'lowestValid must be cheapest external competitor, never EKG Kala')
    const ownOffer = priced.offers.find((o) => o.shopName === 'ای کا جی کالا')
    assert.equal(ownOffer.included, false)
    assert.equal(ownOffer.excludeReason, 'فروشگاه خودمان')
  }
})

// ---------- Scenario D: True Own-Store-Only Listing preserves provenance, continues expansion, and never leaks own price as competitor min ----------

test('Incident Scenario D: true self-only listing triggers bounded expansion/similar probe and marks zero independent competitors safely', async () => {
  let simCalled = 0
  let expandCalled = 0
  const title = fixture.codedEquivalentTarget.name
  const res = await resolveTorobSource({
    productName: title,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    matchConfig: {
      ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames,
      ownShopIds: DEFAULT_PROFILE_CONFIG.filters.ownShopIds,
    },
    now: NOW,
    via: 'test',
    search: async (req) => {
      if ((req.page ?? 1) > 1 || req.sort === 'sellers' || expandCalled > 0) {
        expandCalled++
        return { data: { results: [], count: 1, next: null }, origin: 'torob_mcp' }
      }
      expandCalled++
      return {
        data: { results: [{ random_key: 'only-self-1', name1: title, price: 250000, shop_count: 1 }], count: 1, next: null },
        origin: 'torob_mcp',
      }
    },
    details: async () => ({
      data: makeDetails('only-self-1', title, [
        makeOffer('ای‌کا‌جی کالا', 250000, title, { id: 'ekg-only' }),
      ]),
      origin: 'torob_mcp',
    }),
    similar: async () => {
      simCalled++
      return { data: { results: [] }, origin: 'torob_mcp' }
    },
    priceTrend: async () => null,
  })

  assert.ok(expandCalled >= 2, 'must not stop early after finding only our own store')
  assert.ok(simCalled >= 1, 'must probe similar products when only self store was found')
  assert.equal(res.prk, 'only-self-1')
  assert.equal(res.torob.identityStatus, 'MATCH_CONFIRMED')
  assert.equal(res.torob.ownStoreOnlyOnPrimary, true)
  assert.equal(res.torob.status, 'NO_VALID_OFFERS')
  assert.equal(res.torob.panelEvidence[0].groupRole, 'self_only')
  assert.equal(res.torob.panelEvidence[0].confirmedCompetitorCount, 0)
  assert.equal(res.torob.panelEvidence[0].ownStoreOfferCount, 1)

  const priced = runPricingPipeline(res, {
    productId: 103,
    productName: title,
    sku: fixture.codedEquivalentTarget.sku,
    costPrice: 175000,
    supplierQuotes: [],
    currentFinalPrice: 250000,
    config: makeConfig(),
    now: NOW,
  })
  assert.equal(priced.lowestValid, null, 'own store price must never become competitor minimum')
  assert.equal(priced.offersUsed, 0)
  assert.equal(priced.torobInquiry.validOffers, 0)
  assert.equal(priced.torobInquiry.ownStoreOnlyOnPrimary, true)
  assert.equal(priced.needsReview, true)
})

// ---------- Scenario E: Cross-panel isolation preserves valid external offers alongside review & rejected cards ----------

test('Incident Scenario E: confirmed consolidated Card B keeps all 6 valid external offers when ambiguous Card C and mismatch Card D coexist', async () => {
  const cardB = {
    prk: 'wall-consol-e',
    titleFa: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz',
    offers: fixture.cards.cardB_observedAmbiguous.offers.map((o) =>
      makeOffer(o.shop_name, o.price_toman, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال لرن 433MHz', { id: o.shop_id, city: o.shop_city }),
    ),
  }
  const cardC = fixture.cards.cardC_reviewPartial
  const cardD = fixture.cards.cardD_mismatch

  const src = await resolveTorobSource({
    productName: fixture.codedEquivalentTarget.name,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    matchConfig: {
      ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames,
      ownShopIds: DEFAULT_PROFILE_CONFIG.filters.ownShopIds,
    },
    now: NOW,
    via: 'test',
    search: async () => ({
      data: {
        results: [
          cardFromFixture(cardC),
          cardFromFixture(cardD),
          { random_key: cardB.prk, name1: cardB.titleFa, price: 215000, shop_count: 7 },
        ],
        count: 3,
        next: null,
      },
      origin: 'torob_mcp',
    }),
    details: async (c) => {
      if (c.prk === cardB.prk) return { data: makeDetails(cardB.prk, cardB.titleFa, cardB.offers), origin: 'torob_mcp' }
      if (c.prk === cardC.prk) return { data: detailsFromFixture(cardC), origin: 'torob_mcp' }
      if (c.prk === cardD.prk) return { data: detailsFromFixture(cardD), origin: 'torob_mcp' }
      return { unavailable: true }
    },
    priceTrend: async () => null,
  })

  assert.equal(src.prk, cardB.prk)
  assert.equal(src.torob.status, 'MATCH_CONFIRMED')
  assert.deepEqual(src.torob.selectedPanelPrks, [cardB.prk])
  assert.ok(src.torob.reviewPanelPrks.includes(cardC.prk))
  // Card D is rejected in search (different frequency 315MHz) or if inspected tracked in rejectedPanelPrks
  assert.ok(!src.torob.selectedPanelPrks.includes(cardD.prk))

  const priced = runPricingPipeline(src, {
    productId: 104,
    productName: fixture.codedEquivalentTarget.name,
    sku: fixture.codedEquivalentTarget.sku,
    costPrice: 175000,
    supplierQuotes: [],
    config: makeConfig(),
    now: NOW,
  })
  assert.equal(priced.torobInquiry.status, 'MATCH_CONFIRMED')
  assert.equal(priced.torobInquiry.validOffers, 6, 'all 6 external competitors on Card B remain valid')
  assert.equal(priced.offersUsed, 6)
  assert.equal(priced.lowestValid, 215000)
})

// ---------- Cases 3, 6, 7: Multiple compatible PRKs, cross-PRK same seller dedup, variant isolation ----------

test('Cases 3, 6, 7: compatible multi-PRKs merge & dedup same external seller while isolating self-only PRK & incompatible variants', async () => {
  const b1 = 'multi-b1'
  const b2 = 'multi-b2'
  const selfA = 'multi-self-a'
  const tTitle = fixture.codedEquivalentTarget.name
  const res = await resolveTorobSource({
    productName: tTitle,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    matchConfig: { ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames },
    now: NOW,
    via: 'test',
    search: async () => ({
      data: {
        results: [
          { random_key: selfA, name1: tTitle, price: 250000, shop_count: 1 },
          { random_key: b1, name1: tTitle, price: 215000, shop_count: 3 },
          { random_key: b2, name1: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', price: 218000, shop_count: 3 },
        ],
        count: 3,
        next: null,
      },
      origin: 'torob_mcp',
    }),
    details: async (c) => {
      if (c.prk === selfA) return { data: makeDetails(selfA, tTitle, [makeOffer('EKG Kala', 250000, tTitle, { id: 'own1' })]), origin: 'torob_mcp' }
      if (c.prk === b1) {
        return {
          data: makeDetails(b1, tTitle, [
            makeOffer('فروشگاه الف', 215000, tTitle, { id: 's-alpha', ageDays: 2 }),
            makeOffer('فروشگاه ب', 220000, tTitle, { id: 's-beta', ageDays: 0.1 }),
          ]),
          origin: 'torob_mcp',
        }
      }
      if (c.prk === b2) {
        return {
          data: makeDetails(b2, 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433 مگاهرتز', [
            // Same shopId s-alpha appears on compatible PRK b2 with fresher price 212000
            makeOffer('فروشگاه الف شعبه۲', 212000, tTitle, { id: 's-alpha', ageDays: 0.05 }),
            makeOffer('فروشگاه ج', 225000, tTitle, { id: 's-gamma', ageDays: 0.1 }),
          ]),
          origin: 'torob_mcp',
        }
      }
      return { unavailable: true }
    },
    priceTrend: async () => null,
  })

  assert.equal(new Set(res.torob.selectedPanelPrks).size, 2)
  assert.ok(res.torob.selectedPanelPrks.includes(b1) && res.torob.selectedPanelPrks.includes(b2))
  assert.ok(res.torob.selfOnlyPanelPrks.includes(selfA))
  const alphaOffers = res.offers.filter((o) => o.shopId === 's-alpha')
  assert.equal(alphaOffers.length, 1, 'identical seller across compatible PRKs deduplicated cleanly')
  assert.equal(alphaOffers[0].price, 212000, 'fresher price preserved across PRKs')
})

// ---------- Cases 4, 5, 8, 9, 10, 11: OwnShopIds, Page 2 & Sellers Sort, Cached coded PRK & preferBroadDiscovery ----------

test('Cases 4, 5, 8, 9: page-2 & sort=sellers consolidated cards discovered when page-1 has ownShopIds self-only card', async () => {
  const tTitle = fixture.codedEquivalentTarget.name
  const res = await resolveTorobSource({
    productName: tTitle,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    matchConfig: {
      ownShopNames: DEFAULT_PROFILE_CONFIG.filters.ownShopNames,
      ownShopIds: ['secret-own-999'],
    },
    now: NOW,
    via: 'test',
    search: async (req) => {
      if (req.sort === 'sellers') {
        return { data: { results: [{ random_key: 'sort-sellers-card', name1: tTitle, price: 210000, shop_count: 5 }], count: 30, next: null }, origin: 'torob_mcp' }
      }
      if ((req.page ?? 1) === 2) {
        return { data: { results: [{ random_key: 'page2-card', name1: tTitle, price: 218000, shop_count: 3 }], count: 30, next: null }, origin: 'torob_mcp' }
      }
      return {
        data: {
          results: [{ random_key: 'p1-secret-own', name1: tTitle, price: 245000, shop_count: 1 }],
          count: 30,
          next: 'page2',
        },
        origin: 'torob_mcp',
      }
    },
    details: async (c) => {
      if (c.prk === 'p1-secret-own') {
        return { data: makeDetails('p1-secret-own', tTitle, [makeOffer('فروشگاه ناشناس ظاهری', 245000, tTitle, { id: 'secret-own-999' })]), origin: 'torob_mcp' }
      }
      if (c.prk === 'sort-sellers-card') {
        return {
          data: makeDetails('sort-sellers-card', tTitle, [
            makeOffer('رقیب ۱', 210000, tTitle, { id: 'c1' }),
            makeOffer('رقیب ۲', 214000, tTitle, { id: 'c2' }),
            makeOffer('رقیب ۳', 219000, tTitle, { id: 'c3' }),
          ], { totalSellerCount: 5 }),
          origin: 'torob_mcp',
        }
      }
      return { data: makeDetails('page2-card', tTitle, [makeOffer('رقیب ۴', 218000, tTitle, { id: 'c4' })]), origin: 'torob_mcp' }
    },
    priceTrend: async () => null,
  })

  assert.equal(res.prk, 'sort-sellers-card')
  assert.ok(res.torob.selfOnlyPanelPrks.includes('p1-secret-own'), 'unknown display name matched via ownShopIds is isolated')
  assert.ok(res.torob.selectedPanelPrks.includes('sort-sellers-card'))
  assert.ok(res.torob.selectedPanelPrks.includes('page2-card'))
})

test('Cases 10 & 11: stored coded torobPrk without confirmation & preferBroadDiscovery both execute search rather than blind single-PRK lock', async () => {
  const title = fixture.codedEquivalentTarget.name
  const fake = installFakeTorob({
    search: () => [
      { random_key: 'coded-self', name1: title, price: 250000, shop_count: 1 },
      { random_key: 'coded-consol', name1: title, price: 215000, shop_count: 4 },
    ],
    details: {
      'coded-self': {
        prk: 'coded-self',
        name_fa: title,
        offers: [{ shop_name: 'sgeooole', shop_id: 'own', price_toman: 250000, product_title: title, in_stock: true }],
      },
      'coded-consol': {
        prk: 'coded-consol',
        name_fa: title,
        offers: [
          { shop_name: 'رقیب مستقل الف', shop_id: 'x1', price_toman: 215000, product_title: title, in_stock: true },
          { shop_name: 'رقیب مستقل ب', shop_id: 'x2', price_toman: 222000, product_title: title, in_stock: true },
        ],
      },
    },
  })
  try {
    process.env.TOROB_MCP_URL = 'http://127.0.0.1:3999/mcp'
    // 10. Stored torobPrk on coded product (no torobUrl, no confirmation) -> must still search and pick coded-consol!
    const fromCachedPrk = await torobAdapter.fetchOffers({
      id: 201,
      name: title,
      sku: fixture.codedEquivalentTarget.sku,
      sourceType: 'torob',
      torobPrk: 'coded-self',
      costPrice: 175000,
    })
    assert.ok(fake.calls.some((c) => c.name === 'search_products'), 'stored torobPrk without admin lock must still search')
    assert.equal(fromCachedPrk.prk, 'coded-consol')

    // 11. Explicit torobUrl + preferBroadDiscovery -> searches and discovers coded-consol too!
    fake.calls.length = 0
    const fromBroadFlag = await torobAdapter.fetchOffers({
      id: 202,
      name: title,
      sku: fixture.codedEquivalentTarget.sku,
      sourceType: 'torob',
      torobUrl: 'https://torob.com/p/coded-self/',
      costPrice: 175000,
      matchConfig: { preferBroadDiscovery: true },
    })
    assert.ok(fake.calls.some((c) => c.name === 'search_products'), 'preferBroadDiscovery must enable broader search even with torobUrl')
    assert.equal(fromBroadFlag.prk, 'coded-consol')
  } finally {
    fake.restore()
  }
})

// ---------- Cases 12, 13, 18, 19: Truncation, Partial Failure, Partial Search Coverage, Invalid Offer Filtering ----------

test('Cases 12, 13, 18, 19: truncation, partial MCP errors, uninspected backlog, and invalid/ad/out-of-stock offer exclusion remain transparent and accurate', async () => {
  const tTitle = fixture.codedEquivalentTarget.name
  const res = await resolveTorobSource({
    productName: tTitle,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    budgets: { maxSearchRequests: 3, maxDetails: 2 },
    now: NOW,
    via: 'test',
    search: async (req) => {
      if ((req.page ?? 1) === 1 && req.query === tTitle) {
        return {
          data: {
            results: [
              { random_key: 'trunc-card', name1: tTitle, price: 210000, shop_count: 15 },
              { random_key: 'fail-card', name1: tTitle, price: 215000, shop_count: 3 },
              { random_key: 'extra-card', name1: 'ریموت دیواری بتا مدل WLC-3CH 3 کانال کد لرن 433MHz', price: 218000, shop_count: 2 },
            ],
            count: 60,
            next: 'page2',
          },
          origin: 'torob_mcp',
        }
      }
      return { unavailable: true, issue: 'mcp_timeout' }
    },
    details: async (card) => {
      if (card.prk === 'trunc-card') {
        return {
          data: makeDetails('trunc-card', tTitle, [
            makeOffer('رقیب معتبر ۱', 215000, tTitle, { id: 'ok1' }),
            makeOffer('رقیب معتبر ۲', 220000, tTitle, { id: 'ok2' }),
            makeOffer('رقیب تبلیغاتی', 190000, tTitle, { id: 'ad1', adv: true }),
            makeOffer('رقیب ناموجود', 180000, tTitle, { id: 'oos1', inStock: false }),
            makeOffer('رقیب نامطمئن', 175000, tTitle, { id: 'unrel1', unreliable: true }),
          ], { totalSellerCount: 15, truncated: true }),
          origin: 'torob_mcp',
        }
      }
      return { unavailable: true, issue: 'details_timeout' }
    },
    priceTrend: async () => null,
  })

  const ev = res.torob.panelEvidence.find((p) => p.prk === 'trunc-card')
  assert.equal(ev.offersTruncated, true)
  assert.equal(ev.coverageStatus, 'partial')
  assert.equal(ev.confirmedCompetitorCount, 2, 'only priced in-stock non-ad external offers count as confirmed competitors')
  assert.notEqual(res.torob.coverage.status, 'complete_within_scope')

  const priced = runPricingPipeline(res, {
    productId: 105,
    productName: tTitle,
    sku: fixture.codedEquivalentTarget.sku,
    costPrice: 170000,
    supplierQuotes: [],
    config: makeConfig(),
    now: NOW,
  })
  assert.equal(priced.offersUsed, 2)
  assert.equal(priced.lowestValid, 215000)
})

// ---------- Cases 22 & 23: High volume (120+ cards) & Concurrent Single-Flight Deduplication ----------

test('Cases 22 & 23: high-volume 120-card search stays bounded and concurrent identical inquiries deduplicate upstream requests via single-flight', async () => {
  const title = fixture.codedEquivalentTarget.name
  let upstreamSearchCalls = 0
  let upstreamDetailCalls = 0
  const cache = new TorobDiscoveryCache()
  const manyCards = Array.from({ length: 120 }, (_, i) => ({
    random_key: i === 18 ? 'best-card' : `noise-card-${i}`,
    name1: i === 18 ? title : `ریموت متفرقه ${i}`,
    price: i === 18 ? 220000 : 180000 + i * 500,
    shop_count: i === 18 ? 6 : 1,
  }))

  const runOnce = () => resolveTorobSource({
    productName: title,
    sku: fixture.codedEquivalentTarget.sku,
    anchorPriceToman: 235000,
    cache,
    matchConfig: { singleFlightEnabled: true },
    now: NOW,
    via: 'test',
    search: async (req) => {
      upstreamSearchCalls++
      await new Promise((r) => setTimeout(r, 25))
      const page = req.page ?? 1
      const slice = manyCards.slice((page - 1) * 24, page * 24)
      return { data: { results: slice, count: 120, next: page < 5 ? `page${page + 1}` : null }, origin: 'torob_mcp' }
    },
    details: async (card) => {
      upstreamDetailCalls++
      await new Promise((r) => setTimeout(r, 25))
      return {
        data: makeDetails(card.prk, title, [
          makeOffer('رقیب الف', 220000, title, { id: 'a' }),
          makeOffer('رقیب ب', 226000, title, { id: 'b' }),
        ], { totalSellerCount: 6 }),
        origin: 'torob_mcp',
      }
    },
    priceTrend: async () => null,
  })

  const [r1, r2, r3] = await Promise.all([runOnce(), runOnce(), runOnce()])
  assert.equal(r1.prk, 'best-card')
  assert.equal(r2.prk, 'best-card')
  assert.equal(r3.prk, 'best-card')
  assert.ok(r1.torob.search.candidates.length <= 120)
  // Three concurrent identical inquiries share single-flight upstream calls (one inquiry's full budget:
  // base searches 6 + yield-continuation pool ≤ 4 = 10, vs 3x that without dedup)
  assert.ok(upstreamDetailCalls <= 2, `expected single-flight deduped details <= 2, got ${upstreamDetailCalls}`)
  assert.ok(upstreamSearchCalls <= 10, `expected single-flight deduped search <= 10, got ${upstreamSearchCalls}`)
  assert.equal(cache.stats().inFlightCount, 0, 'in-flight map cleaned up after completion')
})

// ---------- Case 24: Hybrid Product Discovery Index (RRF, synonyms, trigrams, hard guardrails) ----------

test('Case 24: InMemoryTorobHybridIndex retrieves equivalent synonym/seller-title candidates via RRF while blocking frequency/class mismatches', () => {
  const index = new InMemoryTorobHybridIndex()
  index.upsertCards([
    {
      prk: 'idx-self',
      titleFa: 'ریموت لرن دیواری 3 کانال طرح درپا 433MHz',
      reportedSellerCount: 1,
    },
    {
      prk: 'idx-consol-synonym',
      titleFa: 'ریموت دیواری 433 مگاهرتز کد لرن',
      sellerTitles: ['ریموت لرن دیواری سه کانال کد لرن ۴۳۳'],
      reportedSellerCount: 7,
    },
    {
      prk: 'idx-wrong-freq',
      titleFa: 'ریموت لرن دیواری 3 کانال کد لرن 315 مگاهرتز',
      reportedSellerCount: 9,
    },
    {
      prk: 'idx-wrong-class',
      titleFa: 'پوسته قاب ریموت دیواری کد لرن 433 مگاهرتز',
      reportedSellerCount: 12,
    },
  ])

  const doc = canonicalizeCatalogEntry({ titleFa: 'ریموت دیواری 433 مگاهرتز کد لرن' })
  assert.ok(doc.tokenSet.has('syn:learn_code'))
  assert.ok(doc.tokenSet.has('syn:wall_mount'))

  const hits = index.search({ productName: fixture.target.name, sku: fixture.target.sku, anchorPriceToman: 235000 }, 5)
  const hitPrks = hits.map((h) => h.prk)
  assert.ok(hitPrks.includes('idx-consol-synonym'), 'must retrieve normalized synonym + seller-corroborated panel')
  assert.ok(!hitPrks.includes('idx-wrong-freq'), 'must exclude wrong 315MHz frequency card despite high seller count')
  assert.ok(!hitPrks.includes('idx-wrong-class'), 'must exclude wrong product class (receiver vs remote)')

  // Product-to-PRK graph preserves multiple links cleanly and distinguishes self_only vs confirmed
  index.upsertProductLinks([
    {
      productId: 500,
      prk: 'idx-self',
      relationStatus: 'self_only',
      identityScore: 90,
      confidence: 0.9,
      origin: 'auto_discovery',
      isPrimary: false,
      ownStorePresent: true,
      externalCompetitorCount: 0,
      reportedSellerCount: 1,
      discoveringQueries: ['ریموت لرن دیواری 433'],
      lastReason: 'فقط فروشگاه خودمان',
      lastVerifiedAt: NOW,
    },
    {
      productId: 500,
      prk: 'idx-consol-synonym',
      relationStatus: 'confirmed',
      identityScore: 88,
      confidence: 0.88,
      origin: 'auto_discovery',
      isPrimary: true,
      ownStorePresent: true,
      externalCompetitorCount: 6,
      reportedSellerCount: 7,
      discoveringQueries: ['ریموت دیواری کد لرن 433'],
      lastReason: 'مرجع اصلی با ۶ رقیب',
      lastVerifiedAt: NOW,
    },
  ])
  const hints = index.getProductLinks(500)
  assert.equal(hints[0].prk, 'idx-consol-synonym')
  assert.equal(hints[1].prk, 'idx-self')
  assert.equal(hints[1].ownStorePresent, true)
})

// ---------- Case 25: Migration 0005 & Schema Integrity ----------

test('Case 25: migration 0005_torob_discovery_graph_index.sql, schema.ts, and _journal.json are registered and idempotent', () => {
  const migrations = listMigrations()
  const m0005 = migrations.find((m) => m.name === '0005_torob_discovery_graph_index.sql')
  assert.ok(m0005, '0005_torob_discovery_graph_index.sql must exist in drizzle/')
  assert.match(m0005.sql, /CREATE TABLE IF NOT EXISTS "torob_catalog_cards"/)
  assert.match(m0005.sql, /CREATE TABLE IF NOT EXISTS "product_torob_links"/)
  assert.match(m0005.sql, /CREATE UNIQUE INDEX IF NOT EXISTS "product_torob_links_prod_prk_uq"/)
  assert.match(m0005.sql, /torob_catalog_cards_fts_idx/)

  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.ts'), 'utf8')
  assert.match(schema, /torobCatalogCards\s*=\s*pgTable\(\s*"torob_catalog_cards"/)
  assert.match(schema, /productTorobLinks\s*=\s*pgTable\(\s*"product_torob_links"/)

  const journal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8'))
  assert.ok(journal.entries.some((e) => e.tag === '0005_torob_discovery_graph_index'))
})

// ---------- Cases 20 & 21: Repeated Pricing Runs + Link Persistence Helper ----------

test('Cases 20 & 21: sequential pricing runs exclude EKG Kala & guard unknown echo while link builder preserves secondary PRKs', () => {
  const tTitle = fixture.codedEquivalentTarget.name
  const offers = [
    makeOffer('ای کا جی کالا', 240000, tTitle, { id: 'ekg' }),
    makeOffer('تهران گیت', 220000, tTitle, { id: 'c1' }),
    makeOffer('امنیت پارس', 224000, tTitle, { id: 'c2' }),
    makeOffer('دیجی ریموت', 228000, tTitle, { id: 'c3' }),
    makeOffer('الکترو شرق', 232000, tTitle, { id: 'c4' }),
    makeOffer('کیفیت کنترل', 238000, tTitle, { id: 'c5' }),
  ].map((o) => ({
    ...o,
    torobIdentity: {
      prk: 'wall-consol-b',
      status: 'MATCH_CONFIRMED',
      reason: 'ok',
      sources: ['product_details'],
    },
  }))

  let myPrice = 240000
  const history = [myPrice]
  for (let i = 0; i < 4; i++) {
    offers[0].price = myPrice
    const src = {
      source: 'torob',
      prk: 'wall-consol-b',
      productTitle: tTitle,
      offers,
      totalSellerCount: 6,
      fetchedAt: NOW,
      ok: true,
      torob: {
        status: 'MATCH_CONFIRMED',
        reason: 'ok',
        identityStatus: 'MATCH_CONFIRMED',
        identityScore: 95,
        sellerRows: 6,
        reportedSellers: 6,
        offerIdentityEvaluated: true,
        selectedPanelPrks: ['wall-consol-b'],
        panelEvidence: [
          {
            prk: 'wall-consol-b',
            identityStatus: 'MATCH_CONFIRMED',
            matchConfidence: 0.95,
            reportedSellerCount: 6,
            extractedOfferCount: 6,
            ownStoreOfferCount: 1,
            uniqueExternalSellerCount: 5,
            confirmedCompetitorCount: 5,
            reviewRequiredCompetitorCount: 0,
            rejectedCompetitorCount: 0,
            offersTruncated: false,
            coverageStatus: 'complete_within_scope',
            groupRole: 'primary',
            discoveringQueries: ['ریموت دیواری کد لرن 433'],
          },
          {
            prk: 'wall-self-a',
            identityStatus: 'MATCH_CONFIRMED',
            matchConfidence: 0.94,
            reportedSellerCount: 1,
            extractedOfferCount: 1,
            ownStoreOfferCount: 1,
            uniqueExternalSellerCount: 0,
            confirmedCompetitorCount: 0,
            reviewRequiredCompetitorCount: 0,
            rejectedCompetitorCount: 0,
            offersTruncated: false,
            coverageStatus: 'complete_within_scope',
            groupRole: 'self_only',
          },
        ],
      },
    }
    const priced = runPricingPipeline(src, {
      productId: 77,
      productName: tTitle,
      sku: fixture.codedEquivalentTarget.sku,
      costPrice: 175000,
      supplierQuotes: [],
      currentFinalPrice: myPrice,
      ownRecentPrices: history,
      config: makeConfig(),
      now: NOW,
    })
    assert.equal(priced.lowestValid, 220000)
    assert.equal(priced.offersUsed, 5)
    assert.ok(priced.finalPrice >= 215000 && priced.finalPrice <= 220000)
    myPrice = priced.finalPrice
    history.push(myPrice)

    const links = buildLinkRecordsFromSource({ productId: 77, source: src, now: NOW })
    assert.equal(links.find((l) => l.prk === 'wall-consol-b').relationStatus, 'confirmed')
    assert.equal(links.find((l) => l.prk === 'wall-self-a').relationStatus, 'self_only')
    assert.equal(links.find((l) => l.prk === 'wall-self-a').ownStorePresent, true)
  }
})
