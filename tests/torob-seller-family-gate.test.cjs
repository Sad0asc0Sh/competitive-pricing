'use strict'
// §10/§13 سند رخداد — ناوردای هشت‌گانهٔ شواهد فروشنده، دروازهٔ کارت والد (PARENT_*)،
// طبقه‌بندی متن‌آگاه خانوادهٔ نام‌دار (بدون بلک‌لیست سراسری) و نگاتیوهای انکودینگ.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { parseTitle, parseIdentityTitle, normalizeChipEncoding } = loadTsModule('src/lib/pricing/match/parse.ts')
const {
  classifyDescriptorToken,
  compareNamedFamilies,
  namedFamilyRootsCompatible,
  familyNounExplained,
} = loadTsModule('src/lib/pricing/match/descriptors.ts')
const { evaluateTorobCandidate, areCompatibleConfirmedIdentities } = loadTsModule('src/lib/pricing/matcher.ts')
const {
  assessDiscoveryEligibility,
  inspectSellerOffers,
  conflictingEvidence,
} = loadTsModule('src/lib/sources/torob-identity.ts')

const NOW = new Date('2026-11-27T14:00:00.000Z')

const makeOffer = (shopName, shopId, price, listingTitle, listingSpecs) => ({
  shopName,
  shopId,
  price,
  currency: 'toman',
  observedAt: NOW,
  listingTitle,
  ...(listingSpecs ? { listingSpecs } : {}),
  inStock: true,
  sellerType: 'online',
})

// ─── §5: طبقه‌بندی متن‌آگاه نام خانواده (بدون بلک‌لیست) ───

test('F1. Named design family extraction is context-aware «طرح X» — marketing/cosmetic/color/material words never become families', () => {
  assert.equal(parseTitle('ریموت بلوتوثی 433 طرح پرلا').designFamily, 'پرلا')
  assert.equal(parseTitle('ریموت بلوتوثی 433 طرح بنزی').designFamily, 'بنزی')
  assert.equal(parseTitle('ریموت لرن دیواری 3 کانال طرح درپا 433MHz').designFamily, 'درپا')
  // واژه‌های بازاریابی/ظاهر/جنس/رنگ بعد از «طرح» خانواده نمی‌سازند (نخوانی «طرح لوکس» به‌عنوان خانواده)
  for (const neutral of ['ریموت بلوتوثی 433 طرح لوکس', 'ریموت بلوتوثی 433 طرح ممتاز', 'ریموت بلوتوثی 433 طرح فانتزی',
    'ریموت بلوتوثی 433 طرح رنگی', 'ریموت بلوتوثی 433 طرح سیلیکونی', 'ریموت بلوتوثی 433 طرح ساده',
    'ریموت بلوتوثی 433 طرح جدید', 'ریموت بلوتوثی 433 طرح مات']) {
    assert.equal(parseTitle(neutral).designFamily, null, `${neutral} must not create a named family`)
  }
  // «طرح اصل/سامسونگ» کانترفیت است (رفتار تاریخی حفظ شده)
  assert.equal(parseTitle('ریموت طرح اصل 315').counterfeit, 'طرح اصل')
  assert.equal(parseTitle('ریموت طرح سامسونگ 315').counterfeit, 'طرح سامسونگ')
})

test('F2. compareNamedFamilies spelling tolerance: بنز↔بنزی and پرلا↔پرلاها same family; پرلا↔بنزی mismatch (both named only)', () => {
  assert.equal(namedFamilyRootsCompatible('بنز', 'بنزی'), true)
  assert.equal(namedFamilyRootsCompatible('پرلا', 'پرلاها'), true)
  assert.equal(namedFamilyRootsCompatible('پرلا', 'پرلا'), true)
  assert.equal(namedFamilyRootsCompatible('پرلا', 'بنزی'), false)
  assert.equal(namedFamilyRootsCompatible('رازی', 'درپا'), false)
  const oneSidedCand = compareNamedFamilies(null, 'پرلا')
  assert.equal(oneSidedCand.familyMismatch, false, 'one-sided marker is ambiguity, never a proven conflict')
  assert.deepEqual(oneSidedCand.unexplainedCandFamily, ['پرلا'])
  const oneSidedTarget = compareNamedFamilies('پرلا', null)
  assert.deepEqual(oneSidedTarget.unexplainedTargetFamily, ['پرلا'])
  assert.equal(compareNamedFamilies('پرلا', 'بنزی').familyMismatch, true)
})

test('F3. familyNounExplained: a family marker is «explained» when the noun exists in the other title even without «طرح»', () => {
  // هدفِ «ریموت بلوتوثی 315 بنزی 5 دکمه» در برابر کارتِ «طرح بنزی»: مارکر توضیح‌داده شده (رفتار CAT1 حفظ می‌شود)
  const target = parseTitle('ریموت بلوتوثی 315 بنزی 5 دکمه Hsp')
  assert.equal(familyNounExplained('بنزی', target.words, target.norm), true)
  const plain = parseTitle('ریموت بلوتوثی رنگی فرکانس 433 لوکس')
  assert.equal(familyNounExplained('پرلا', plain.words, plain.norm), false)
  // خانوادهٔ بی‌نام هیچ‌گاه تعارض نمی‌سازد
  assert.equal(familyNounExplained('', [], ''), true)
})

// ─── §4 مرحلهٔ A: دروازهٔ کارت والد ───

test('F4. Parent gate classification: HARD_CONFLICT only for proven both-named family mismatch; ambiguous stays discoverable', () => {
  const targetNamed = parseTitle('ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا')
  const targetResult = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'target-self', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا' },
  )
  const perlaCard = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'cand-perla', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا' },
  )
  const benziCard = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'cand-benzi', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433 طرح بنزی' },
  )
  const genericCard = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'cand-generic', titleFa: 'ریموت بلوتوثی 433' },
  )
  const noFamilyTarget = parseTitle('ریموت بلوتوثی رنگی فرکانس 433 لوکس')
  const noFamilyResult = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 },
    { prk: 'cand-perla', titleFa: 'ریموت بلوتوثی ۴۳۳ رنگی طرح پرلا' },
  )

  assert.equal(assessDiscoveryEligibility({ productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا' }, targetNamed, perlaCard).parentGate, 'PARENT_COMPATIBLE')
  const hard = assessDiscoveryEligibility({ productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا' }, targetNamed, benziCard)
  assert.equal(hard.parentGate, 'PARENT_HARD_CONFLICT', 'proven both-named family mismatch is a hard conflict')
  assert.equal(hard.eligible, false, 'hard family conflict is outside the discovery/probe gate')
  assert.ok(hard.hardContradictions.some((c) => c.includes('خانوادهٔ طراحی')))
  const marked = assessDiscoveryEligibility({ productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس' }, noFamilyTarget, noFamilyResult)
  assert.equal(marked.parentGate, 'PARENT_AMBIGUOUS', 'one-sided named family is a marked ambiguity')
  assert.equal(marked.eligible, true, 'marked ambiguity must NOT close discovery (recall preserved)')
  const missingTitle = { ...benziCard, titleState: 'source_missing', parsed: undefined }
  assert.equal(assessDiscoveryEligibility({ productName: 'x' }, targetNamed, missingTitle).parentGate, undefined)
  assert.ok(targetResult && genericCard) // استفاده‌شده در گارد ساختار
})

test('F5. Proven family conflict never auto-confirms and cannot be rescued by any seller evidence (invariant 1)', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 }
  const targetTitle = parseTitle(target.productName)
  const cardResult = evaluateTorobCandidate(target, { prk: 'cand-benzi', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433 طرح بنزی' })
  assert.equal(cardResult.status, 'IDENTITY_MISMATCH', 'family veto rejects the card')
  assert.equal(cardResult.familyConflict, true)
  assert.ok(cardResult.rejectReason.includes('خانوادهٔ طراحی نام‌دار متفاوت است'))
  // فروشندهٔ با عنوان دقیقاً برابر هدف هم کارت ناسازگار را نجات نمی‌دهد
  const inspected = inspectSellerOffers(target, targetTitle, cardResult, [
    makeOffer('فروشنده بنزی', 'benzi-s1', 355000, 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا'),
    makeOffer('فروشنده سازگار', 'benzi-s2', 350000, 'ریموت بلوتوثی رنگی فرکانس 433'),
  ], { cardSource: 'product_details', complete: true, truncated: false })
  for (const offer of inspected.offers) {
    assert.ok(offer.torobIdentity.status !== 'MATCH_CONFIRMED', 'no seller may confirm a hard-conflicted parent')
  }
  // تضاد خانواده در conflictingEvidence هم سطح شواهد می‌آید
  const benziParsed = cardResult.parsed
  assert.match(conflictingEvidence(targetTitle, benziParsed) ?? '', /خانوادهٔ طراحی/)
})

// ─── §10: ناوردای هشت‌گانهٔ شواهد فروشنده ───

test('F6. Invariant 2 — generic parent wording does not prevent discovery', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 }
  const targetTitle = parseTitle(target.productName)
  const generic = evaluateTorobCandidate(target, { prk: 'gen-1', titleFa: 'ریموت بلوتوثی' })
  const elig = assessDiscoveryEligibility(target, targetTitle, generic)
  assert.equal(elig.eligible, true)
  assert.notEqual(elig.parentGate, 'PARENT_HARD_CONFLICT')
})

test('F7. Invariants 3+4 — seller evidence fills missing info but cannot silently override a contradicting technical attribute', () => {
  // هدف فرکانس‌دار: فروشندهٔ 433 اطلاعات ناقص کارت عمومی را تکمیل می‌کند؛ فروشندهٔ 315 تعارض فنی صریح دارد.
  const target = { productName: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330', sku: 'RX-4330', anchorPriceToman: 400000 }
  const targetTitle = parseTitle(target.productName, { sku: target.sku })
  const cardResult = evaluateTorobCandidate(target, { prk: 'gen-card', titleFa: 'ریموت بلوتوثی' })
  const inspected = inspectSellerOffers(target, targetTitle, cardResult, [
    makeOffer('سایت ۴۳۳', 's-433', 395000, 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330'),
    makeOffer('سایت ۳۱۵', 's-315', 405000, 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330'),
  ], { cardSource: 'product_details', complete: true, truncated: false })
  const s433 = inspected.offers.find((o) => o.shopId === 's-433')
  const s315 = inspected.offers.find((o) => o.shopId === 's-315')
  assert.equal(s433.torobIdentity.status, 'MATCH_CONFIRMED', 'seller evidence may complete missing info (invariant 3)')
  assert.equal(s315.torobIdentity.status, 'IDENTITY_MISMATCH', 'seller cannot override the frequency contradiction (invariant 4)')
  assert.equal(inspected.mixedVariants, false, 'target-resolved contradiction partitions sellers without mixing variants')
})

test('F7b. Invariant 7 — two incompatible seller variants on a generic card never merge into one pricing group', () => {
  // هدف بدون فرکانس: 433 و 315 دو واریانت‌اند نه تعارض با هدف؛ باید پارتیشن و ریویو شوند نه ادغام.
  const target = { productName: 'ریموت بلوتوثی بتا مدل RX-4330', sku: 'RX-4330', anchorPriceToman: 400000 }
  const targetTitle = parseTitle(target.productName, { sku: target.sku })
  const cardResult = evaluateTorobCandidate(target, { prk: 'gen-card', titleFa: 'ریموت بلوتوثی' })
  const inspected = inspectSellerOffers(target, targetTitle, cardResult, [
    makeOffer('سایت ۴۳۳', 's-433', 395000, 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330'),
    makeOffer('سایت ۳۱۵', 's-315', 405000, 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330'),
  ], { cardSource: 'product_details', complete: true, truncated: false })
  assert.equal(inspected.mixedVariants, true)
  assert.equal(inspected.result.status, 'REVIEW_REQUIRED')
  assert.ok(inspected.offers.every((o) => o.torobIdentity.status !== 'MATCH_CONFIRMED'))
})

test('F8. Invariant 5+6 — an incompatible seller cannot validate the parent card; seller assessment stays independent and auditable', () => {
  const target = { productName: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330', sku: 'RX-4330', anchorPriceToman: 400000 }
  const targetTitle = parseTitle(target.productName, { sku: target.sku })
  const cardResult = evaluateTorobCandidate(target, { prk: 'ambig-parent', titleFa: 'ریموت بلوتوثی بتا فرکانس 433' })
  const inspected = inspectSellerOffers(target, targetTitle, cardResult, [
    makeOffer('سایت ۳۱۵ ناسازگار', 's-bad', 395000, 'ریموت بلوتوثی بتا فرکانس 315 مدل RX-4330'),
    makeOffer('سایت سازگار', 's-good', 400000, 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330'),
  ], { cardSource: 'product_details', complete: true, truncated: false })
  const bad = inspected.offers.find((o) => o.shopId === 's-bad')
  const good = inspected.offers.find((o) => o.shopId === 's-good')
  assert.equal(bad.torobIdentity.status, 'IDENTITY_MISMATCH')
  assert.equal(good.torobIdentity.status, 'MATCH_CONFIRMED', 'verified compatible offer must not be discarded because another seller is incompatible (invariant 8)')
  // ممیزی‌پذیری: هر ارزیابی ساختار SellerIdentityAssessment مستقل دارد
  for (const offer of inspected.offers) {
    assert.ok(offer.torobIdentity.assessment)
    assert.equal(offer.torobIdentity.assessment.sellerListingTitle.length > 0, true)
  }
  // نتیجهٔ والد به‌خاطر فروشندهٔ سازگار با شواهد مستقل احراز می‌شود نه با فروشندهٔ ناسازگار
  assert.ok(inspected.result.status === 'MATCH_CONFIRMED' || inspected.result.status === 'REVIEW_REQUIRED')
  assert.equal(inspected.offers.find((o) => o.shopId === 's-bad').torobIdentity.status, 'IDENTITY_MISMATCH')
})

test('F9. Invariant 7 — incompatible variants (different family / encoding) never aggregate into one identity', () => {
  const base = { prk: 'a', titleFa: 'ریموت بلوتوثی بتا مدل RX-4330', specs: [] }
  const mk = (patch) => evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی بتا مدل RX-4330', sku: 'RX-4330' },
    { ...base, ...patch },
  )
  const perlaSide = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'p1', titleFa: 'ریموت بلوتوثی رنگی 433 طرح پرلا' },
  )
  const benziSide = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی رنگی فرکانس 433 طرح پرلا', anchorPriceToman: 360000 },
    { prk: 'p2', titleFa: 'ریموت بلوتوثی رنگی 433 طرح بنزی' },
  )
  assert.equal(areCompatibleConfirmedIdentities(perlaSide, benziSide), false, 'different named families never merge')
  const evChip = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی بتا مدل RX-4330', sku: 'RX-4330' },
    { prk: 'ev1', titleFa: 'ریموت بلوتوثی بتا RX-4330', specs: [{ key: 'انکودینگ', value: 'EV1527' }] },
  )
  const ptChip = evaluateTorobCandidate(
    { productName: 'ریموت بلوتوثی بتا مدل RX-4330', sku: 'RX-4330' },
    { prk: 'pt1', titleFa: 'ریموت بلوتوثی بتا RX-4330', specs: [{ key: 'انکودینگ', value: 'PT2262' }] },
  )
  assert.equal(areCompatibleConfirmedIdentities(evChip, ptChip), false, 'different encodings never merge')
  assert.equal(areCompatibleConfirmedIdentities(evChip, evChip), true, 'identical encodings are compatible')
  assert.ok(mk({})) // ساختار پایه دست‌نخورده
})

// ─── §13: مرزهای والد مارک‌دار و مجرای spec ───

test('F10. Spec-only family marker («طرح: پرلا» with clean title) → AMBIGUOUS-marked parent, borrowing forbidden', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 }
  const targetTitle = parseTitle(target.productName)
  const specOnly = parseIdentityTitle('ریموت بلوتوثی رنگی فرکانس 433', [{ key: 'طرح', value: 'پرلا' }])
  assert.equal(specOnly.designFamily, 'پرلا', 'spec channel fills the family when the title has none')
  assert.deepEqual(specOnly.evidenceConflicts ?? [], [])
  const cardResult = evaluateTorobCandidate(target, { prk: 'spec-perla', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433', specs: [{ key: 'طرح', value: 'پرلا' }] })
  const elig = assessDiscoveryEligibility(target, targetTitle, cardResult)
  assert.equal(elig.parentGate, 'PARENT_AMBIGUOUS')
  assert.deepEqual(elig.familyMarkers, ['پرلا'])
  assert.equal(elig.eligible, true, 'spec-only marker stays discoverable')
  // قرض‌دادن عنوان/اسپک والد به ارزیابی فروشنده ممنوع است — نتیجه فقط با شواهد مستقل فروشنده صادر می‌شود
  const inspected = inspectSellerOffers(target, targetTitle, cardResult, [
    makeOffer('فروشندهٔ بی‌خانواده', 'sp-1', 350000, 'ریموت بلوتوثی رنگی فرکانس 433'),
  ], { cardSource: 'product_details', complete: true, truncated: false })
  assert.notEqual(inspected.offers[0].torobIdentity.status, 'MATCH_CONFIRMED', 'borrowing a family-marked parent must not confirm a seller')
})

test('F11. Title-vs-spec family contradiction becomes an explicit evidenceConflict (never silent rewrite)', () => {
  const parsed = parseIdentityTitle('ریموت بلوتوثی رنگی 433 طرح پرلا', [{ key: 'طرح', value: 'بنزی' }])
  assert.equal(parsed.designFamily, 'پرلا', 'title value is never silently rewritten by spec')
  assert.deepEqual(parsed.evidenceConflicts, ['خانوادهٔ طراحی در عنوان و مشخصات کارت متفاوت است'])
  // با تحمل املایی «پرلا↔پرلاها» تعارض کاذب ساخته نمی‌شود
  const tolerant = parseIdentityTitle('ریموت بلوتوثی رنگی 433 طرح پرلا', [{ key: 'طرح', value: 'پرلاها' }])
  assert.deepEqual(tolerant.evidenceConflicts ?? [], [])
})

// ─── §13: نگاتیو و پوزیتیو انکودینگ ───

test('F12. Encoding normalization and channels — chip is a technical attr, never a model code or descriptor', () => {
  assert.equal(normalizeChipEncoding('EV 1527'), 'ev1527')
  assert.equal(normalizeChipEncoding('EV1527'), 'ev1527')
  assert.equal(normalizeChipEncoding('PT-2262'), 'pt2262')
  assert.equal(normalizeChipEncoding('کد لرن'), null, 'non-chip values never become encodings')
  const titleEnc = parseTitle('ریموت بلوتوثی RX-4330 انکودینگ EV1527')
  assert.deepEqual(titleEnc.attrs.encoding, ['ev1527'])
  assert.ok(!titleEnc.codes.some((c) => c.canon === 'EV1527'), 'chip token never becomes a model code (latent-bug regression)')
  const splitTitle = parseTitle('ریموت بلوتوثی RX-4330 انکودینگ EV 1527')
  assert.deepEqual(splitTitle.attrs.encoding, ['ev1527'])
  const specEnc = parseIdentityTitle('ریموت بلوتوثی RX-4330', [{ key: 'انکودینگ', value: 'PT 2262' }])
  assert.deepEqual(specEnc.attrs.encoding, ['pt2262'])
  assert.ok(!specEnc.codes.some((c) => c.canon === 'PT2262'))
  const bothEnc = parseIdentityTitle('ریموت بلوتوثی RX-4330 انکودینگ EV1527', [{ key: 'انکودینگ', value: 'PT2262' }])
  assert.deepEqual(bothEnc.evidenceConflicts, ['مقادیر متناقض برای encoding در عنوان و مشخصات ترب'])
})

test('F13. Encoding gate: two-sided proven conflict never auto-confirms; one-sided keeps recall; codeless stays fail-closed', () => {
  const codedTarget = { productName: 'ریموت بلوتوثی بتا مدل RX-4330 انکودینگ EV1527', sku: 'RX-4330', anchorPriceToman: 400000 }
  const conflictCard = evaluateTorobCandidate(codedTarget, {
    prk: 'enc-diff', titleFa: 'ریموت بلوتوثی بتا RX-4330', specs: [{ key: 'انکودینگ', value: 'PT2262' }],
  })
  assert.ok(conflictCard.status === 'REVIEW_REQUIRED' || conflictCard.status === 'IDENTITY_MISMATCH', 'different chip must never auto-confirm')
  assert.ok((conflictCard.blockers ?? []).some((b) => b.includes('انکودینگ')), 'encoding conflict carries an explicit reason')

  const sameChip = evaluateTorobCandidate(codedTarget, { prk: 'enc-same', titleFa: 'ریموت بلوتوثی بتا RX-4330 انکودینگ EV1527' })
  assert.equal(sameChip.status, 'MATCH_CONFIRMED', 'identical chips confirm positively')

  const chiplessCoded = evaluateTorobCandidate(codedTarget, { prk: 'enc-none', titleFa: 'ریموت بلوتوثی بتا مدل RX-4330' })
  assert.equal(chiplessCoded.status, 'MATCH_CONFIRMED', 'a correct coded card without chip mention stays confirmable (recall preserved)')

  // باگ نهفتهٔ بازگشتی: هدف انکودینگ‌دار در برابر کارت بی‌چیپ دیگر «کد مدل متناقض» نمی‌گیرد
  const tParsed = parseTitle(codedTarget.productName, { sku: codedTarget.sku })
  const cardParsed = parseIdentityTitle('ریموت بلوتوثی بتا مدل RX-4330')
  assert.equal(conflictingEvidence(tParsed, cardParsed), undefined)

  // هدف کدلس در برابر کارت چیپ‌دار: fail-closed (بدون تأیید خودکار)
  const codelessTarget = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 }
  const chipCard = evaluateTorobCandidate(codelessTarget, {
    prk: 'enc-codeless', titleFa: 'ریموت بلوتوثی رنگی 433 لوکس', specs: [{ key: 'انکودینگ', value: 'EV1527' }],
  })
  assert.notEqual(chipCard.status, 'MATCH_CONFIRMED', 'codeless target must fail closed on an unexplained chip attribute')
})

// ─── پین‌های رفتاری نرم ───

test('F14. Soft descriptor blocker asymmetry fixed — a lone marketing adjective in the target no longer disables the candidate-side soft blocker', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 }
  // کارت با توصیف نرم متفاوت (مکعب) و بدون خانواده/کد — باید بلاکر توصیف نرم بگیرد نه تایید خودکار
  const shaped = evaluateTorobCandidate(target, { prk: 'cube-1', titleFa: 'ریموت بلوتوثی 433 مکعب' })
  assert.notEqual(shaped.status, 'MATCH_CONFIRMED')
})

test('F15. Coverage floor cannot reach cards that share none of the target words (root cause 1 regression)', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 }
  const perla = evaluateTorobCandidate(target, { prk: 'perla-1', titleFa: 'ریموت بلوتوثی ۴۳۳ رنگی طرح پرلا' })
  // پرلا هیچ واژهٔ هدف را ندارد؛ کف پوشش 0.55 و جریمهٔ حذف‌شدهٔ قدیمی نباید امتیاز آن را تا سطح مرجع بالا ببرد
  const lux = evaluateTorobCandidate(target, { prk: 'lux-1', titleFa: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس' })
  assert.ok(perla.rawScore < lux.rawScore - 10, `perla raw (${perla.rawScore}) must stay clearly below lux raw (${lux.rawScore})`)
  assert.deepEqual(perla.unexplainedFamily, ['پرلا'])
  // کلید هویت دیگر بین دو محصول فیزیکی متفاوت فرونمی‌پاشد (root cause 6 regression)
  assert.notEqual(perla.identityKey, lux.identityKey)
  assert.ok(perla.identityKey.includes('fam:'), 'identity key includes the named family channel')
})
