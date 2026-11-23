const assert = require('node:assert/strict')
const test = require('node:test')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { evaluateTorobCandidate, selectBestTorobSearchMatch, resetMatcherFlags } = loadTsModule('src/lib/pricing/matcher.ts')

resetMatcherFlags()

const target = { productName: 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', sku: 'KY-100200', anchorPriceToman: 2500000 }
const card = (prk, titleFa, priceToman, extra = {}) => ({ prk, titleFa, priceToman, sellerCount: 8, available: true, ...extra })

test('M1. تایید خودکار فقط با شناسایی مثبت: کد مدل یکسان (فارسی یا انگلیسی) → approve', () => {
  for (const title of ['دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', 'Dahua DH-HAC-HFW1200T 2MP Bullet Camera']) {
    const r = evaluateTorobCandidate(target, card('x', title, 2450000))
    assert.equal(r.verdict, 'approve', title)
    assert.ok(r.score >= 80)
    assert.equal(r.codeRelation, 'equal')
  }
})

test('M2. مدل هم‌خانواده (پسوند متفاوت / سری دیگر) تایید خودکار نمی‌شود — پیشین ۴.۱.۲ آن را بالای ۸۰٪ می‌برد', () => {
  for (const title of ['دوربین مداربسته داهوا مدل DH-HAC-HFW1200TP', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1500T']) {
    const r = evaluateTorobCandidate(target, card('x', title, 2400000))
    assert.notEqual(r.verdict, 'approve', title)
    assert.ok(r.score < 80, `${title} → ${r.score}`)
  }
})

test('M3. لوازم جانبی، پک چندتایی، برند/کد دیگر و نوع کالای متفاوت رد می‌شوند', () => {
  const wrong = [
    ['bracket', 'پایه دوربین مداربسته داهوا DH-HAC-HFW1200T', 150000],
    ['4pack', 'پک ۴ عددی دوربین مداربسته داهوا DH-HAC-HFW1200T', 9800000],
    ['otherbrand', 'دوربین مداربسته هایک ویژن مدل DS-2CE16D0T-IT3F', 2300000],
    ['psu', 'آداپتور دوربین مداربسته 12 ولت 2 آمپر', 200000],
  ]
  for (const [id, t, p] of wrong) {
    const r = evaluateTorobCandidate(target, card(id, t, p))
    assert.equal(r.verdict, 'reject', `${id} → ${r.verdict} (${r.score})`)
    assert.equal(r.rejected, true)
    assert.ok(r.rejectReason && r.rejectReason.length > 0)
  }
})

test('M4. عنوان خالی رد می‌شود و استثنا نمی‌دهد', () => {
  const r = evaluateTorobCandidate(target, card('x', '', 1))
  assert.equal(r.verdict, 'reject')
  assert.equal(r.score, 0)
})

test('M5. انتخاب بهترین کارت: کارت درست بین کارت‌های نویزی انتخاب و confident است', () => {
  const cards = [
    card('sib', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200TP', 2400000),
    card('ok', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', 2450000),
    card('brk', 'پایه دوربین مداربسته داهوا DH-HAC-HFW1200T', 150000),
    card('oth', 'دوربین مداربسته هایک ویژن مدل DS-2CE16D0T-IT3F', 2300000),
  ]
  const out = selectBestTorobSearchMatch(target, cards)
  assert.equal(out.best.candidate.prk, 'ok')
  assert.equal(out.confident, true)
  assert.equal(out.verdict, 'approve')
})

test('M6. اگر فقط کارت‌های اشتباه موجود باشد، هیچ کارتی انتخاب نمی‌شود (۰٪ تایید خودکار اشتباه)', () => {
  const cards = [
    card('sib', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200TP', 2400000),
    card('ser', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1500T', 3400000),
    card('brk', 'پایه دوربین مداربسته داهوا DH-HAC-HFW1200T', 150000),
    card('4p', 'پک ۴ عددی دوربین مداربسته داهوا DH-HAC-HFW1200T', 9800000),
  ]
  const out = selectBestTorobSearchMatch(target, cards)
  assert.equal(out.best, null)
  assert.equal(out.confident, false)
  assert.equal(out.verdict, 'reject')
})

test('M7. ابهام بین‌کارتی: دو کارت با هویت متفاوت که هر دو منطبق‌اند، هیچ‌کدام خودکار تایید نمی‌شود', () => {
  const loose = { productName: 'دوربین داهوا 2MP', anchorPriceToman: 2500000 }
  const out = selectBestTorobSearchMatch(loose, [
    card('a', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200T', 2450000),
    card('b', 'دوربین مداربسته داهوا مدل DH-HAC-HFW1200R', 2450000),
  ])
  assert.equal(out.confident, false)
  assert.notEqual(out.verdict, 'approve')
})

test('M8. فهرست خالی نتیجه → reject بدون استثنا', () => {
  const out = selectBestTorobSearchMatch(target, [])
  assert.equal(out.best, null)
  assert.equal(out.verdict, 'reject')
})

test('M9. v4.2.0+ (H02): تضاد میلی‌متر لنز حتی با کد مدل یکسان قفل بازبینی می‌شود و خودکار تایید نمی‌شود', () => {
  const lensTarget = {
    productName: 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 2.8 میلی متر',
    sku: 'DH-IPC-HFW2431S-S-S2',
    anchorPriceToman: 3700000,
  }
  const sameLens = evaluateTorobCandidate(lensTarget, card('ok', 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 2.8mm', 3720000))
  assert.equal(sameLens.verdict, 'approve')

  const diffLens = evaluateTorobCandidate(lensTarget, card('conflict', 'دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW2431S-S-S2 لنز 3.6 میلی متر', 3780000))
  assert.notEqual(diffLens.verdict, 'approve')
  assert.ok(diffLens.score < 80)
})

test('M10. v4.2.0+ (H06/H22): کالای عمومی بدون کد مدل و بدون برند شناخته‌شده خودکار تایید نمی‌شود', () => {
  const genericTarget = {
    productName: 'آداپتور 12 ولت 5 آمپر دوربین مداربسته',
    sku: null,
    anchorPriceToman: 280000,
  }
  const r = evaluateTorobCandidate(genericTarget, card('gen', 'آداپتور 12 ولت 5 آمپر مخصوص دوربین مداربسته', 270000))
  assert.notEqual(r.verdict, 'approve')
  assert.ok(r.score < 80)
})

// ── ۴.۲.۱: «نسل/شمارهٔ سری» در نام‌های بدون کد (eval/matching/realistic3.cjs، N12)
const { parseTitle } = loadTsModule('src/lib/pricing/match/parse.ts')

test('M11. v4.2.1: نسل/شمارهٔ سری — Buds 4 ≠ Buds 3 و Band 8 ≠ Band 7 خودکار تایید نمی‌شوند', () => {
  const buds = { productName: 'هدفون بی سیم شیائومی مدل Redmi Buds 4 Lite', sku: null, anchorPriceToman: 1450000 }
  for (const t of ['هدفون بی سیم شیائومی مدل Redmi Buds 3 Lite']) {
    const r = evaluateTorobCandidate(buds, card('g', t, 1300000))
    assert.notEqual(r.verdict, 'approve', t)
    assert.ok(r.score < 80, `${t} → ${r.score}`)
  }
  const band = { productName: 'مچ بند هوشمند شیائومی مدل Mi Band 8', sku: null, anchorPriceToman: 2400000 }
  const r2 = evaluateTorobCandidate(band, card('g2', 'مچ بند هوشمند شیائومی مدل Mi Band 7', 1900000))
  assert.notEqual(r2.verdict, 'approve')
})

test('M12. v4.2.1: استخراج gen — املاهای یکسان یک مقدارند؛ عدد واحددار/تعداد gen نمی‌شود', () => {
  const g = (s) => parseTitle(s).attrs.gen
  assert.deepEqual(g('Samsung Galaxy Buds2 Pro'), ['buds:2'])
  assert.deepEqual(g('Samsung Galaxy Buds 2 Pro'), ['buds:2'])
  assert.deepEqual(g('Apple iPhone 14 Pro Max 256GB'), ['iphone:14'])
  assert.notDeepEqual(g('Apple iPhone 13 Pro'), g('Apple iPhone 14 Pro'))
  assert.deepEqual(g('Xiaomi Redmi Note 12 4G'), ['note:12'])
  // اعداد دارای واحد، اعشار، تعداد و عدد چهاررقمی gen نیستند
  assert.equal(g('Dahua camera 2 MP lens 2.8 mm'), undefined)
  assert.equal(g('Kingston SSD 64 GB'), undefined)
  assert.equal(g('HDMI cable 3 m'), undefined)
  assert.equal(g('Pack 2 pcs mouse'), undefined)
  assert.equal(g('Intel Core i5 12400'), undefined)
})

test('M13. v4.2.1: gen هم‌خوان تضاد نمی‌سازد؛ املای یکسان با کد یکسان تایید می‌شود', () => {
  const t = { productName: 'هدفون بی سیم سامسونگ مدل Galaxy Buds2 Pro SM-R510', sku: 'SM-R510', anchorPriceToman: 7200000 }
  const same = evaluateTorobCandidate(t, card('ok', 'هدفون بلوتوثی سامسونگ مدل Galaxy Buds2 Pro SM-R510', 7300000))
  assert.equal(same.verdict, 'approve')
  // املای فاصله‌دار («Buds 2»): gen یکی است و نباید تضاد «نسل/شمارهٔ سری» گزارش شود
  // (پایین‌آمدن به review به‌خاطر منطق چندکدی است که پیش از این هم بود، نه gen)
  const spaced = evaluateTorobCandidate(t, card('sp', 'هدفون بلوتوثی سامسونگ مدل Galaxy Buds 2 Pro SM-R510', 7300000))
  assert.ok(!spaced.notes.join(' ').includes('نسل/شمارهٔ سری'))
})

test('M14. v4.2.1: gen یک‌طرفه به‌خاطر تفاوت نوشتار (Cat6 ⟷ «کت ۶») کارت درست را به ریویو نمی‌برد', () => {
  const t = { productName: 'کابل شبکه دی نت Cat6 UTP 305 متری', sku: null, anchorPriceToman: 9500000 }
  const r = evaluateTorobCandidate(t, card('c', 'دی نت کابل شبکه کت 6 UTP 305 متری', 9400000))
  assert.equal(r.verdict, 'approve', `${r.verdict} ${r.score}`)
})

test('M15. v4.2.1: gen یک‌طرفه وقتی طرف مقابل همان واژهٔ سری را بدون عدد دارد (Buds Pro ⟷ Buds2 Pro) تایید خودکار نمی‌شود', () => {
  const t = { productName: 'هدفون بی سیم سامسونگ مدل Galaxy Buds2 Pro', sku: null, anchorPriceToman: 7200000 }
  const r = evaluateTorobCandidate(t, card('g', 'هدفون بی سیم سامسونگ مدل Galaxy Buds Pro', 5200000))
  assert.notEqual(r.verdict, 'approve', `${r.verdict} ${r.score}`)
})
