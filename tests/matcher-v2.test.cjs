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
