'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { mcpOffer } = require('./helpers/fake-torob-mcp.cjs')
const incident = require('./fixtures/torob-seller-title-incident.json')

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { parseTitle } = loadTsModule('src/lib/pricing/match/parse.ts')
const { classifyDescriptorToken, compareTitleDescriptors } = loadTsModule('src/lib/pricing/match/descriptors.ts')
const { evaluateTorobCandidate } = loadTsModule('src/lib/pricing/matcher.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { buildSearchQueryPlan, decomposeTargetProduct, extractVocabularyExpansions } = loadTsModule('src/lib/sources/torob-query.ts')
const { assessDiscoveryEligibility } = loadTsModule('src/lib/sources/torob-identity.ts')
const { fetchViaTorobMcpServer } = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { InMemoryTorobHybridIndex, buildLinkRecordsFromSource } = loadTsModule('src/lib/sources/torob-index.ts')

const NOW = new Date(incident.observedAt)

function makeMcpHarness({ searchFn, detailsMap, similarFn }) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    const { name, arguments: args } = body.params
    calls.push({ name, args })
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
      return reply(Array.isArray(out) ? { products: out, page: args.page ?? 1, has_next_page: false } : out)
    }
    if (name === 'similar_products') {
      const out = similarFn ? await similarFn(args) : []
      return reply(Array.isArray(out) ? { products: out } : out)
    }
    if (name === 'product_details') {
      const d = detailsMap[args.prk]
      if (!d) return reply('not found', true)
      return reply({
        ...d,
        offer_count: d.offer_count ?? d.offers.length,
        in_person_sellers: d.in_person_sellers ?? [],
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
    shop_id: raw.shop_id ?? raw.shop_name,
    product_title: raw.product_title,
    ...(raw.specs ? { specs: raw.specs } : {}),
  }
}

function makeDetailsPayload(card) {
  return {
    prk: card.prk,
    name_fa: card.name_fa,
    name_en: card.name_en,
    price_toman: card.price_toman,
    shop_count: card.shop_count ?? card.offers.length,
    shop_name: card.shop_name,
    specs: card.specs,
    offers: card.offers.map(hydrateOffer),
  }
}

test('ST1-ST3: Descriptor policy classifies لوکس/فانتزی/سیلیکونی/مکعب/رنگی as soft uncertainty rather than hard rejection', () => {
  const parsedTarget = parseTitle(incident.target.productName)
  assert.equal(parsedTarget.attrs.frequency[0], 433000000)
  assert.deepEqual(parsedTarget.attrs.bluetooth, ['yes'])
  assert.ok(parsedTarget.descriptorWords.includes('رنگی'))
  assert.ok(parsedTarget.descriptorWords.includes('لوکس'))

  assert.equal(classifyDescriptorToken('لوکس', 'acc:remote').group, 'marketing')
  assert.equal(classifyDescriptorToken('فانتزی', 'acc:remote').group, 'cosmetic_style')
  assert.equal(classifyDescriptorToken('سیلیکونی', 'acc:remote').group, 'material')
  assert.equal(classifyDescriptorToken('مکعب', 'acc:remote').group, 'shape')
  assert.equal(classifyDescriptorToken('رنگی', 'acc:remote').group, 'color')

  const cmp = compareTitleDescriptors(
    parsedTarget.descriptorWords,
    parsedTarget.norm,
    parseTitle(incident.relatedSimilarCard.name_fa).descriptorWords,
    parseTitle(incident.relatedSimilarCard.name_fa).norm,
    'acc:remote',
  )
  assert.equal(cmp.strictVariantMismatch.length, 0)
  assert.ok(cmp.matchedColors.includes('رنگی'))
  assert.ok(cmp.unmatchedTargetSoft.includes('marketing:لوکس'))
  assert.ok(cmp.unmatchedCandSoft.includes('cosmetic_style:فانتزی'))

  // Query plan keeps رنگی and suppresses bogus طرح لوکس queries.
  const plan = buildSearchQueryPlan(incident.target.productName)
  assert.ok(plan.some((q) => q.query.includes('رنگی') && q.query.includes('433')))
  assert.ok(!plan.some((q) => q.query.includes('طرح لوکس')))

  // Category-sensitive override can treat a token strictly when explicitly configured.
  const strictPolicy = { categoryOverrides: { 'acc:remote': { material: 'strict_variant' } } }
  assert.equal(classifyDescriptorToken('سیلیکونی', 'acc:remote', strictPolicy).behavior, 'strict_variant')

  // Stage A allows generic & cosmetic-variant cards while blocking hard structural contradictions.
  for (const titleFa of ['ریموت بلوتوثی فانتزی ۴۳۳ رنگی', 'ریموت بلوتوثی', 'ریموت کنترل رنگی', 'ریموت بلوتوثی 433']) {
    const scored = evaluateTorobCandidate(incident.target, { prk: 'cand', titleFa })
    const elig = assessDiscoveryEligibility(incident.target, parsedTarget, scored)
    assert.equal(elig.eligible, true, `${titleFa} should pass Stage A discovery eligibility`)
  }
  for (const badTitle of ['ریموت بلوتوثی رنگی فرکانس 315 لوکس', 'کاور سیلیکونی ریموت 433', 'پک ۵ عددی ریموت بلوتوثی 433']) {
    const scored = evaluateTorobCandidate(incident.target, { prk: 'bad', titleFa: badTitle })
    const elig = assessDiscoveryEligibility(incident.target, parsedTarget, scored)
    assert.equal(elig.eligible, false, `${badTitle} must be rejected by Stage A hard constraints`)
  }
})

test('ST4-ST8 & ST15: Exact production incident retrieves related similar_products card, expands seller vocabulary, and keeps ambiguous offers in REVIEW_REQUIRED', async (t) => {
  const distractors = Array.from({ length: 10 }, (_, i) => ({
    prk: `distractor-315-${i}`,
    name_fa: `ریموت کنترل بلوتوثی 315 کد R${10 + i}`,
    price_toman: 350000,
    shop_count: 2,
  }))
  const thirdSiblingCard = {
    prk: 'silicone-sibling-3',
    name_fa: 'ریموت بلوتوثی سیلیکونی 433',
    price_toman: 330000,
    shop_count: 1,
    offers: [
      {
        shop_name: 'فروشگاه سیلیکون',
        shop_id: 'sil-shop',
        price_toman: 330000,
        product_title: 'ریموت بلوتوثی سیلیکونی فرکانس 433 رنگی',
        available: true,
      },
    ],
  }
  const searchQueriesSeen = []
  const fake = makeMcpHarness({
    searchFn: (args) => {
      searchQueriesSeen.push(args.query)
      if (args.query.includes('سیلیکونی') || args.query.includes('فانتزی') || args.query.includes('مکعب')) {
        return [thirdSiblingCard]
      }
      return [
        { prk: incident.initialCard.prk, name_fa: incident.initialCard.name_fa, price_toman: incident.initialCard.price_toman, shop_count: 1 },
        ...distractors,
      ]
    },
    similarFn: (args) => {
      if (args.prk === incident.initialCard.prk) {
        return [{
          prk: incident.relatedSimilarCard.prk,
          name_fa: incident.relatedSimilarCard.name_fa,
          price_toman: incident.relatedSimilarCard.price_toman,
          shop_count: incident.relatedSimilarCard.shop_count,
        }]
      }
      return []
    },
    detailsMap: {
      [incident.initialCard.prk]: makeDetailsPayload(incident.initialCard),
      [incident.relatedSimilarCard.prk]: makeDetailsPayload(incident.relatedSimilarCard),
      [thirdSiblingCard.prk]: makeDetailsPayload(thirdSiblingCard),
    },
  })
  t.after(fake.restore)

  const res = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    productName: incident.target.productName,
    sku: incident.target.sku,
    anchorPriceToman: incident.target.anchorPriceToman,
    now: NOW,
  })

  // Must retrieve both initial باسلام card AND related فانتزی card from similar_products within bounded requests
  assert.ok(fake.calls.some((c) => c.name === 'similar_products' && c.args.prk === incident.initialCard.prk))
  assert.ok(res.torob.coverage.similarProbesExecuted >= 1)
  assert.ok(res.torob.coverage.apiRequestsMade <= 18, `Bounded API requests (${res.torob.coverage.apiRequestsMade})`)

  const fancyDiag = res.torob.discoveryDiagnostics.find((d) => d.prk === incident.relatedSimilarCard.prk)
  assert.ok(fancyDiag, 'Related similar_products card must appear in discoveryDiagnostics')
  assert.equal(fancyDiag.retrievalOrigin, 'similar_products')
  assert.equal(fancyDiag.similarProductSeed, incident.initialCard.prk)
  assert.equal(fancyDiag.inspectionCompleted, true)
  assert.equal(fancyDiag.classification, 'POTENTIAL_MATCH')
  assert.equal(fancyDiag.adminState, 'inspected_insufficient_evidence')
  assert.equal(fancyDiag.sellerSpecificTitles.length, 3)
  assert.ok(fancyDiag.technicalAttributeMatches.some((a) => a.includes('433000000')))
  assert.ok(fancyDiag.technicalAttributeMatches.some((a) => a.includes('bluetooth')))
  assert.equal(fancyDiag.sellerAssessments.length, 3)

  // Every seller on the related card is individually assessed as REVIEW_REQUIRED (not auto-confirmed, not dropped!)
  const bestControl = res.offers.find((o) => o.shopName === 'بست کنترل')
  const arxis = res.offers.find((o) => o.shopName === 'آرکسیس سیستم‌های حفاظتی')
  const ghoflak = res.offers.find((o) => o.shopName === 'قفلک')
  assert.ok(bestControl && arxis && ghoflak, 'All 3 sellers on related card must be extracted')
  for (const off of [bestControl, arxis, ghoflak]) {
    assert.equal(off.torobIdentity.status, 'REVIEW_REQUIRED', `${off.shopName} must remain REVIEW_REQUIRED`)
    assert.ok(off.torobIdentity.assessment, `${off.shopName} must carry structured SellerIdentityAssessment`)
    assert.ok(off.torobIdentity.matchedAttributes.some((a) => a.includes('433000000')))
    assert.ok(off.torobIdentity.missingAttributes.some((a) => /^descriptor:/.test(a)))
  }

  // Closed-loop seller-title vocabulary expansion must issue follow-up queries using observed seller adjectives
  assert.ok(
    searchQueriesSeen.some((q) => q.includes('سیلیکونی') || q.includes('فانتزی') || q.includes('مکعب')),
    `Expected closed-loop seller vocab search query in ${JSON.stringify(searchQueriesSeen)}`,
  )

  // Uninspected wrong-frequency distractors are explicitly recorded as CONFIRMED_INCOMPATIBLE in diagnostics
  const wrongFreqDiag = res.torob.discoveryDiagnostics.find((d) => d.prk === 'distractor-315-0')
  assert.ok(wrongFreqDiag)
  assert.equal(wrongFreqDiag.classification, 'CONFIRMED_INCOMPATIBLE')
  assert.equal(wrongFreqDiag.adminState, 'confirmed_incompatible')
  assert.ok(wrongFreqDiag.hardContradictions.length > 0)

  // Pricing pipeline preserves discoveryDiagnostics without leaking REVIEW_REQUIRED offers into pricing
  const priced = runPricingPipeline(res, {
    productId: 501,
    productName: incident.target.productName,
    sku: null,
    costPrice: 280000,
    supplierQuotes: [],
    currentFinalPrice: 360000,
    config: structuredClone(DEFAULT_PROFILE_CONFIG),
    now: NOW,
  })
  assert.ok(priced.torobInquiry.discoveryDiagnostics.some((d) => d.prk === incident.relatedSimilarCard.prk))
})

test('ST7-ST14: Mixed-variant partitioning, positive confirmation, multi-PRK merge, dedup, own-store exclusion, and price guardrails', async (t) => {
  // Scenario A: Generic canonical title card containing mixed sellers A, B (confirmed), C (315 mismatch), D (silicone cover accessory)
  // Plus second compatible PRK repeating Shop A to verify cross-PRK dedup, plus own-store Seller E & suspiciously cheap Seller F!
  const target = {
    productName: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330',
    sku: 'RX-4330',
    anchorPriceToman: 400000,
  }
  const mixedCard = {
    prk: 'generic-mixed-1',
    name_fa: 'ریموت بلوتوثی',
    price_toman: 400000,
    shop_count: 6,
    offers: [
      { shop_name: 'فروشگاه خودمان', shop_id: 'own-ekg', price_toman: 390000, product_title: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330' },
      { shop_name: 'فروشنده الف', shop_id: 'seller-a', price_toman: 410000, product_title: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330' },
      { shop_name: 'فروشنده ب', shop_id: 'seller-b', price_toman: 420000, product_title: 'ریموت بلوتوثی بتا 433 مدل RX-4330 اصل' },
      { shop_name: 'فروشنده ج', shop_id: 'seller-c', price_toman: 405000, product_title: 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330' },
      { shop_name: 'فروشنده د', shop_id: 'seller-d', price_toman: 120000, product_title: 'کاور سیلیکونی ریموت 433 مدل RX-4330' },
      { shop_name: 'پیشنهاد مشکوک', shop_id: 'seller-cheap', price_toman: 90000, product_title: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330' },
    ],
  }
  const compatibleSecondCard = {
    prk: 'compatible-second-2',
    name_fa: 'ریموت بلوتوثی بتا فرکانس 433 RX-4330',
    price_toman: 415000,
    shop_count: 2,
    offers: [
      { shop_name: 'فروشنده الف', shop_id: 'seller-a', price_toman: 415000, product_title: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330' },
      { shop_name: 'فروشنده ه', shop_id: 'seller-e', price_toman: 430000, product_title: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330' },
    ],
  }

  const fake = makeMcpHarness({
    searchFn: () => [
      { prk: mixedCard.prk, name_fa: mixedCard.name_fa, price_toman: mixedCard.price_toman, shop_count: 6 },
      { prk: compatibleSecondCard.prk, name_fa: compatibleSecondCard.name_fa, price_toman: compatibleSecondCard.price_toman, shop_count: 2 },
    ],
    detailsMap: {
      [mixedCard.prk]: makeDetailsPayload(mixedCard),
      [compatibleSecondCard.prk]: makeDetailsPayload(compatibleSecondCard),
    },
  })
  t.after(fake.restore)

  const res = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    ...target,
    matchConfig: { ownShopNames: ['فروشگاه خودمان'], ownShopIds: ['own-ekg'] },
    now: NOW,
  })

  // Sellers A, B (card 1) and E (card 2) are MATCH_CONFIRMED; A is deduplicated across both PRKs
  const sellerAOffers = res.offers.filter((o) => o.shopId === 'seller-a' && o.torobIdentity.status === 'MATCH_CONFIRMED')
  assert.equal(sellerAOffers.length, 1, 'Duplicate shopId across compatible PRKs must be deduplicated')
  assert.equal(res.offers.find((o) => o.shopId === 'seller-b').torobIdentity.status, 'MATCH_CONFIRMED')
  assert.equal(res.offers.find((o) => o.shopId === 'seller-e').torobIdentity.status, 'MATCH_CONFIRMED')

  // Seller C (wrong freq 315) and Seller D (accessory cover) are independently rejected without invalidating A & B!
  assert.equal(res.offers.find((o) => o.shopId === 'seller-c').torobIdentity.status, 'IDENTITY_MISMATCH')
  assert.equal(res.offers.find((o) => o.shopId === 'seller-d').torobIdentity.status, 'IDENTITY_MISMATCH')
  assert.deepEqual(new Set(res.torob.selectedPanelPrks), new Set([mixedCard.prk, compatibleSecondCard.prk]))

  // Pricing excludes own-store, excludes mismatches, and guards suspiciously low outlier (90,000)
  const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
  cfg.filters = { ...cfg.filters, ownShopNames: ['فروشگاه خودمان'], ownShopIds: ['own-ekg'] }
  cfg.supervisor = { ...cfg.supervisor, enabled: false }
  const priced = runPricingPipeline(res, {
    productId: 502,
    productName: target.productName,
    sku: target.sku,
    costPrice: 320000,
    supplierQuotes: [],
    currentFinalPrice: 400000,
    config: cfg,
    now: NOW,
  })
  assert.equal(priced.torobInquiry.status, 'MATCH_CONFIRMED')
  assert.ok(priced.lowestValid >= 410000 && priced.lowestValid <= 420000, `Expected competitive floor 410-420k (not own store 390k or suspicious 90k), got ${priced.lowestValid}`)
  assert.ok(!priced.offers.find((o) => o.shopId === 'own-ekg')?.included)
  assert.ok(!priced.offers.find((o) => o.shopId === 'seller-c')?.included)
  assert.ok(!priced.offers.find((o) => o.shopId === 'seller-d')?.included)
})

test('ST-Hybrid & Seller Vocabulary Extraction: hybrid index surfaces seller-titled cards and preserves uninspected diagnostics in links', () => {
  const index = new InMemoryTorobHybridIndex()
  index.upsertCards([
    {
      prk: incident.relatedSimilarCard.prk,
      titleFa: incident.relatedSimilarCard.name_fa,
      specs: incident.relatedSimilarCard.specs,
      sellerTitles: incident.relatedSimilarCard.offers.map((o) => o.product_title),
      reportedSellerCount: 3,
      lastPriceToman: 340000,
    },
    {
      prk: 'bad-315-card',
      titleFa: 'ریموت بلوتوثی فانتزی 315 رنگی',
      sellerTitles: ['ریموت بلوتوثی 315 سیلیکونی'],
      reportedSellerCount: 2,
      lastPriceToman: 340000,
    },
  ])
  const hits = index.search({
    productName: incident.target.productName,
    anchorPriceToman: incident.target.anchorPriceToman,
  }, 5)
  assert.ok(hits.some((h) => h.prk === incident.relatedSimilarCard.prk))
  assert.ok(!hits.some((h) => h.prk === 'bad-315-card'))

  const profile = decomposeTargetProduct(incident.target.productName)
  const seen = new Set(['ریموت بلوتوثی رنگی 433'])
  const expansions = extractVocabularyExpansions(
    profile,
    incident.relatedSimilarCard.offers.map((o) => o.product_title),
    [],
    seen,
    3,
  )
  assert.ok(expansions.some((q) => q.query.includes('سیلیکونی') || q.query.includes('مکعب')))

  const links = buildLinkRecordsFromSource({
    productId: 503,
    now: NOW,
    source: {
      source: 'torob',
      offers: [],
      totalSellerCount: 0,
      fetchedAt: NOW,
      ok: true,
      torob: {
        status: 'REVIEW_REQUIRED',
        reason: 'test',
        sellerRows: 0,
        reportedSellers: 0,
        panelEvidence: [],
        discoveryDiagnostics: [{
          prk: 'uninspected-promising-9',
          canonicalCardTitle: 'ریموت بلوتوثی 433',
          sellerSpecificTitles: [],
          retrievalOrigin: 'similar_products',
          similarProductSeed: 'lux-bt-433-1',
          classification: 'NOT_YET_INSPECTED',
          adminState: 'discovered_not_inspected',
          technicalAttributeMatches: ['frequency:433000000', 'bluetooth:yes'],
          missingIdentityEvidence: ['جزئیات کارت دریافت نشد'],
          hardContradictions: [],
          candidateInspectionPriority: 82,
          inspectionCompleted: false,
          confirmedSellerCount: 0,
          reviewRequiredSellerCount: 0,
          rejectedSellerCount: 0,
          externalCompetitorCount: 0,
          reasonForInclusionOrExclusion: 'نیازمند بررسی جزئیات',
        }],
      },
    },
  })
  assert.equal(links.length, 1)
  assert.equal(links[0].prk, 'uninspected-promising-9')
  assert.equal(links[0].relationStatus, 'review_required')
})

test('ST-MixedClusters: Conflicting confirmed seller clusters within one generic card never combine into one pricing group', () => {
  const { inspectSellerOffers } = loadTsModule('src/lib/sources/torob-identity.ts')
  const { parseTitle: parse } = loadTsModule('src/lib/pricing/match/parse.ts')
  // Suppose target allows an attribute-less remote family/model matched differently by two clusters:
  // Cluster 1 (433MHz, missing in target) vs Cluster 2 (315MHz, missing in target)
  const target = { productName: 'ریموت بلوتوثی بتا مدل RX-9000', sku: 'RX-9000', anchorPriceToman: 400000 }
  const tTitle = parse(target.productName, { sku: target.sku })
  const cardRes = evaluateTorobCandidate(target, { prk: 'ambig-clusters', titleFa: 'ریموت بلوتوثی' })
  const inspected = inspectSellerOffers(
    target,
    tTitle,
    cardRes,
    [
      { shopName: 'سایت ۱', shopId: 's1', price: 390000, currency: 'toman', observedAt: NOW, listingTitle: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-9000' },
      { shopName: 'سایت ۲', shopId: 's2', price: 410000, currency: 'toman', observedAt: NOW, listingTitle: 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-9000' },
    ],
    { complete: true, truncated: false, cardSource: 'product_details' },
  )
  assert.equal(inspected.mixedVariants, true)
  assert.equal(inspected.result.status, 'REVIEW_REQUIRED')
  assert.ok(inspected.offers.every((o) => o.torobIdentity.status === 'REVIEW_REQUIRED'))
})

