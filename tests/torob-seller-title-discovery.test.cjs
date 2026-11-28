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
  // §13 نگاتیو مطلق پرلا — کشف حفظ می‌شود (recall) ولی با مارکر خانوادهٔ نام‌دار، والد ابهام مارک‌دار است نه سازگار.
  const perlaParsed = parseTitle(incident.negativePerlaCard.name_fa)
  assert.equal(perlaParsed.designFamily, 'پرلا', 'named family must be extracted contextually (no blacklist needed)')
  assert.equal(classifyDescriptorToken('پرلا', 'acc:remote').group, 'unknown', 'پرلا is not a hard-coded group term (context-aware named family only)')
  const perlaScored = evaluateTorobCandidate(incident.target, { prk: incident.negativePerlaCard.prk, titleFa: incident.negativePerlaCard.name_fa })
  const perlaElig = assessDiscoveryEligibility(incident.target, parsedTarget, perlaScored)
  assert.equal(perlaElig.eligible, true, 'Perla stays discoverable (recall preserved)')
  assert.equal(perlaElig.parentGate, 'PARENT_AMBIGUOUS', 'Perla parent gate is ambiguous (family marker), never COMPATIBLE')
  assert.deepEqual(perlaElig.familyMarkers, ['پرلا'])
  // والد با مارکر خانواده هرگز COMPATIBLE و هرگز تأیید خودکار نمی‌شود؛ و فروشندهٔ آن هم.
  assert.notEqual(perlaScored.status, 'MATCH_CONFIRMED')
  for (const offer of incident.negativePerlaCard.offers) {
    const sellerScored = evaluateTorobCandidate(incident.target, { prk: incident.negativePerlaCard.prk, titleFa: offer.product_title })
    assert.notEqual(sellerScored.status, 'MATCH_CONFIRMED', `Perla seller "${offer.product_title}" must never be auto-confirmed`)
  }
  for (const badTitle of ['ریموت بلوتوثی رنگی فرکانس 315 لوکس', 'کاور سیلیکونی ریموت 433', 'پک ۵ عددی ریموت بلوتوثی 433']) {
    const scored = evaluateTorobCandidate(incident.target, { prk: 'bad', titleFa: badTitle })
    const elig = assessDiscoveryEligibility(incident.target, parsedTarget, scored)
    assert.equal(elig.eligible, false, `${badTitle} must be rejected by Stage A hard constraints`)
  }
  // §13 نگاتیوهای دیگر سند — آرایش دکمه، تعداد بسته، لیست فقط-متعلقات، خانوادهٔ مدل متفاوت؛ هیچ‌کدام تأیید خودکار نمی‌شوند.
  for (const [label, badTitle] of [
    ['incompatible buttons', incident.negativeCases.incompatibleButtons],
    ['different pack quantity', incident.negativeCases.differentPackQuantity],
    ['accessory-only listing', incident.negativeCases.accessoryOnlyListing],
    ['different model family', incident.negativeCases.differentModelFamily],
    ['visually similar but incompatible', incident.negativeCases.similarButIncompatibleRemote],
  ]) {
    const scored = evaluateTorobCandidate(incident.target, { prk: 'neg2', titleFa: badTitle, priceToman: 365000 })
    assert.notEqual(scored.status, 'MATCH_CONFIRMED', `${label} (${badTitle}) must never auto-confirm`)
  }
  // نگاتیو انکودینگ در سطح عنوان هدف: چیپ به attrs می‌رود و دیگر کد مدل نمی‌شود (باگ نهفتهٔ پیشین).
  const encTarget = parseTitle('ریموت بلوتوثی رنگی فرکانس 433 لوکس انکودینگ EV 1527')
  assert.deepEqual(encTarget.attrs.encoding, ['ev1527'], 'chip normalization «EV 1527»→«ev1527»')
  assert.ok(!encTarget.codes.some((c) => c.canon === 'EV1527'), 'chip token must never become a model code')
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
      // §13 سند رخداد — کارت منفی پرلا و کارت «طرح ساده» در نتایج پیش‌فرض همان جست‌وجوی اصلی دیده می‌شوند.
      return [
        { prk: incident.initialCard.prk, name_fa: incident.initialCard.name_fa, price_toman: incident.initialCard.price_toman, shop_count: 1 },
        {
          prk: incident.negativePerlaCard.prk,
          name_fa: incident.negativePerlaCard.name_fa,
          price_toman: incident.negativePerlaCard.price_toman,
          shop_count: incident.negativePerlaCard.shop_count,
        },
        {
          prk: incident.simpleDesignCard.prk,
          name_fa: incident.simpleDesignCard.name_fa,
          price_toman: incident.simpleDesignCard.price_toman,
          shop_count: incident.simpleDesignCard.shop_count,
        },
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
      [incident.negativePerlaCard.prk]: makeDetailsPayload(incident.negativePerlaCard),
      [incident.simpleDesignCard.prk]: makeDetailsPayload(incident.simpleDesignCard),
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
  // بودجهٔ API با افزودن کارت پرلا و «طرح ساده» اندازه‌گیری و پین شد (اجرای واقعی §15):
  // 14 درخواست در این دنیا (5 جزئیات + 1 similar + جست‌وجوها؛ اندازه‌گیری با پروب مستقل همین دنیا)؛ سقف با حاشیه 18 حفظ شد.
  assert.ok(res.torob.coverage.apiRequestsMade <= 18, `Bounded API requests (${res.torob.coverage.apiRequestsMade})`)

  // §11 سند رخداد — مرجع درست باسلام (lux) باید نامزد اول پنل بماند و هرگز پشت کارت چندفروشندهٔ پرلا نرود.
  assert.equal(res.prk, incident.initialCard.prk, 'باسلام card (lux-bt-433-1) must be the primary panel candidate')
  const panelOrder = res.torob.panelEvidence.map((p) => p.prk)
  assert.equal(panelOrder[0], incident.initialCard.prk, 'panelEvidence[0] must be the باسلام reference card')
  // ترتیب هویتی: lux (سازگار) > فانتزی/ساده (ابهام نرم) > پرلا (مارکر خانوادهٔ نام‌دار)
  const luxIdx = panelOrder.indexOf(incident.initialCard.prk)
  const fancyIdx = panelOrder.indexOf(incident.relatedSimilarCard.prk)
  const simpleIdx = panelOrder.indexOf(incident.simpleDesignCard.prk)
  const perlaIdx = panelOrder.indexOf(incident.negativePerlaCard.prk)
  assert.ok(fancyIdx > luxIdx && simpleIdx > luxIdx, `fancy/simple must rank below lux reference (got ${JSON.stringify(panelOrder)})`)
  assert.ok(perlaIdx > fancyIdx && perlaIdx > simpleIdx, `perla (family-marked) must rank below soft-ambiguous cards (got ${JSON.stringify(panelOrder)})`)

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

  // §13 — کارت «طرح ساده» کشف و بازرسی کامل می‌شود ولی تأیید خودکار نمی‌شود.
  const simpleDiag = res.torob.discoveryDiagnostics.find((d) => d.prk === incident.simpleDesignCard.prk)
  assert.ok(simpleDiag, 'Simple-design card must be discovered')
  assert.equal(simpleDiag.inspectionCompleted, true)
  assert.equal(simpleDiag.classification, 'POTENTIAL_MATCH')
  const simpleOffer = res.offers.find((o) => o.shopName === 'فروشگاه ساده')
  assert.ok(simpleOffer, 'Simple-design card seller must be extracted')
  assert.equal(simpleOffer.torobIdentity.status, 'REVIEW_REQUIRED', 'Simple-design seller must stay REVIEW_REQUIRED')

  // §13 نگاتیو مطلق پرلا — بازرسی می‌شود، هرگز تأیید نمی‌شود و هرگز primary/مشمول قیمت نمی‌شود.
  const perlaDiag = res.torob.discoveryDiagnostics.find((d) => d.prk === incident.negativePerlaCard.prk)
  assert.ok(perlaDiag, 'Perla negative card must be discovered and inspected (recall preserved)')
  assert.equal(perlaDiag.inspectionCompleted, true)
  assert.ok(
    perlaDiag.classification === 'POTENTIAL_MATCH' || perlaDiag.classification === 'CONFIRMED_INCOMPATIBLE',
    `Perla must never be CONFIRMED_COMPATIBLE (got ${perlaDiag.classification})`,
  )
  assert.ok(perlaDiag.sellerAssessments.length === 3, 'Perla sellers must be individually assessed')
  const perlaOffers = res.offers.filter((o) => o.torobIdentity.prk === incident.negativePerlaCard.prk)
  assert.equal(perlaOffers.length, 3)
  for (const off of perlaOffers) {
    assert.ok(
      off.torobIdentity.status === 'REVIEW_REQUIRED' || off.torobIdentity.status === 'IDENTITY_MISMATCH',
      `Perla seller ${off.shopName} must be REVIEW_REQUIRED or IDENTITY_MISMATCH (got ${off.torobIdentity.status})`,
    )
    assert.ok(
      (off.torobIdentity.reason ?? '').includes('پرلا') || (off.torobIdentity.reason ?? '').length > 0,
      'Perla sellers must carry a structured reason',
    )
  }
  assert.ok(!res.torob.selectedPanelPrks.includes(incident.negativePerlaCard.prk), 'Perla must never join selected panel')
  assert.equal(res.torob.selectedPanelPrks.length, 0, 'Nothing is auto-confirmed in this codeless ambiguous world')

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

  // پوزیتیو باسلام: آفر مرجع موجود است و وضعیتش بدتر از REVIEW_REQUIRED نمی‌شود.
  const basalamOffer = res.offers.find((o) => o.shopName === 'باسلام')
  assert.ok(basalamOffer, 'باسلام reference offer must be extracted')
  assert.equal(basalamOffer.torobIdentity.status, 'REVIEW_REQUIRED', 'باسلام offer must stay REVIEW_REQUIRED (brandless world)')

  // Closed-loop seller-title vocabulary expansion must issue follow-up queries using observed seller adjectives.
  // با افزودن کارت پرلا، توکن اختصاصی فروشندهٔ آن («پرلا») هم به واژگان اضافه می‌شود — حفظ عمدیِ تزریق واژگان (§8/§9).
  assert.ok(
    searchQueriesSeen.some((q) => ['سیلیکونی', 'فانتزی', 'مکعب', 'پرلا', 'ساده'].some((w) => q.includes(w))),
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
  // §13 — هیچ آفر پرلا (حتی با قیمت ۱۴۹٬۰۰۰ ارزان‌تر) وارد محاسبهٔ قیمت خودکار نمی‌شود.
  assert.ok(!priced.offers.find((o) => o.torobIdentity?.prk === incident.negativePerlaCard.prk)?.included, 'Perla offer must be excluded from pricing')
  assert.notEqual(priced.lowestValid, 149000, 'lowestValid must never be the cheap perla price')
})

test('ST11-Pin: verified باسلام panel is never outranked by the 3-seller Perla card, and a stale review_required hint cannot bypass the Stage-A gate', async (t) => {
  const distractors = Array.from({ length: 8 }, (_, i) => ({
    prk: `distractor-315-${i}`,
    name_fa: `ریموت کنترل بلوتوثی 315 کد R${10 + i}`,
    price_toman: 350000,
    shop_count: 2,
  }))
  const fake = makeMcpHarness({
    searchFn: () => [
      { prk: incident.initialCard.prk, name_fa: incident.initialCard.name_fa, price_toman: incident.initialCard.price_toman, shop_count: 1 },
      {
        prk: incident.negativePerlaCard.prk,
        name_fa: incident.negativePerlaCard.name_fa,
        price_toman: incident.negativePerlaCard.price_toman,
        shop_count: incident.negativePerlaCard.shop_count,
      },
      ...distractors,
    ],
    similarFn: () => [],
    detailsMap: {
      [incident.initialCard.prk]: makeDetailsPayload(incident.initialCard),
      [incident.negativePerlaCard.prk]: makeDetailsPayload(incident.negativePerlaCard),
    },
  })
  t.after(fake.restore)

  // (ب) §11 — دنیای با مرجع تأییدشدهٔ باسلام (قفل مدیریتی confirmation؛ مجرای واقعی «تأییدشده»):
  const confirmedWorld = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    productName: incident.target.productName,
    sku: incident.target.sku,
    anchorPriceToman: incident.target.anchorPriceToman,
    now: NOW,
    confirmation: { prk: incident.initialCard.prk, confirmedAt: incident.observedAt, origin: 'admin_review', decisionId: 1 },
  })
  assert.equal(confirmedWorld.prk, incident.initialCard.prk, 'verified باسلام card must be the primary panel')
  assert.deepEqual(confirmedWorld.torob.selectedPanelPrks, [incident.initialCard.prk], 'selectedPanelPrks must contain only the verified باسلام card')
  assert.ok(
    confirmedWorld.torob.reviewPanelPrks.includes(incident.negativePerlaCard.prk),
    'Perla must sit in reviewPanelPrks (tier below the verified panel) — seller count must never outrank verified identity',
  )
  const confirmedPanelOrder = confirmedWorld.torob.panelEvidence.map((p) => p.prk)
  assert.equal(confirmedPanelOrder[0], incident.initialCard.prk)
  const perlaEvidence = confirmedWorld.torob.panelEvidence.find((p) => p.prk === incident.negativePerlaCard.prk)
  assert.ok(perlaEvidence && perlaEvidence.identityStatus !== 'MATCH_CONFIRMED', 'Perla must never carry MATCH_CONFIRMED panel identity')
  assert.ok(
    !confirmedWorld.offers.some((o) => o.torobIdentity.prk === incident.negativePerlaCard.prk && o.torobIdentity.status === 'MATCH_CONFIRMED'),
    'No Perla seller may be auto-confirmed in the verified world either',
  )

  // (ج) §12 — hint ذخیره‌شدهٔ review_required برای پرلا: گیت مرحلهٔ A دور زده نمی‌شود و primary نمی‌شود.
  const hintedWorld = await fetchViaTorobMcpServer({
    mcpUrl: 'http://fixture.invalid/mcp',
    productName: incident.target.productName,
    sku: incident.target.sku,
    anchorPriceToman: incident.target.anchorPriceToman,
    now: NOW,
    knownPrkHints: [
      { prk: incident.negativePerlaCard.prk, identityStatus: 'REVIEW_REQUIRED', externalCompetitorCount: 3, confidence: 0.7, lastVerifiedAt: NOW },
    ],
  })
  assert.equal(hintedWorld.prk, incident.initialCard.prk, 'A review_required hint for Perla must not make it the primary candidate')
  assert.ok(!hintedWorld.torob.selectedPanelPrks.includes(incident.negativePerlaCard.prk), 'Hinted Perla must not be auto-selected')
  const hintedPerlaEvidence = hintedWorld.torob.panelEvidence.find((p) => p.prk === incident.negativePerlaCard.prk)
  assert.ok(hintedPerlaEvidence && hintedPerlaEvidence.identityStatus !== 'MATCH_CONFIRMED', 'Hinted Perla identity stays unconfirmed on fresh evidence')
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

