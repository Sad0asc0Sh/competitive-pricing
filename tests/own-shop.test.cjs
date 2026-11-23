// ۴.۲.۱ — تشخیص مقاوم «پیشنهاد خودِ فروشگاه» و گارد پژواک قیمت خودی (مسابقهٔ کاهشی با خودمان)
const assert = require('node:assert/strict')
const test = require('node:test')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { compactShopKey, makeOwnShopMatcher, detectOwnPriceEcho, BUILTIN_OWN_SHOP_ALIASES } = loadTsModule('src/lib/pricing/own-shop.ts')
const { applyValidityFilters } = loadTsModule('src/lib/pricing/filters.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')

const now = new Date('2026-10-14T08:00:00Z')

const OWN_VARIANTS = [
  'ای‌کا‌جی کالا', 'ای کا جی کالا', 'ای کی جی کالا', 'ای‌کی‌جی کالا', 'ایکی جی کالا', 'ایکاجی کالا', 'ای‌کا‌جی‌کالا',
  'EKG Kala', 'EKGKala', 'ekgkala.ir', 'ekg kala', 'فروشگاه ای‌کا‌جی کالا', 'ای.کا.جی کالا', 'ای-کا-جی کالا', 'اِی‌کا‌جی کالا', 'sgeooole',
  'ایکاجی‌کالا (مشهد)', 'ك‌ا‌ي'.length ? 'ای كا جي كالا' : '',
].filter(Boolean)
const NOT_OWN = ['دیجی‌کالا', 'تکنولایف', 'شرق دیجیتال', 'کالاتیک', 'پلازا مشهد', 'ای‌کی‌جی تجارت‌گستر', 'گروه کالا', 'ekg', 'کالا']

test('A1. کلید فشرده: فاصله/نیم‌فاصله/نقطه/اعراب/حروف عربی و لاتین یکسان می‌شوند', () => {
  assert.equal(compactShopKey('ای‌کا‌جی کالا'), compactShopKey('ای کا جی کالا'))
  assert.equal(compactShopKey('EKG Kala'), 'ekgkala')
  assert.equal(compactShopKey('ekgkala.ir'), 'ekgkalair')
  assert.equal(compactShopKey('اِی‌کا‌جی کالا'), 'ایکاجیکالا')
  assert.equal(compactShopKey('ای كا جي كالا'), 'ایکاجیکالا')
  assert.equal(compactShopKey(null), '')
})

test('A2. همهٔ املاهای محتمل نام فروشگاه خودمان شناسایی می‌شوند و رقبا نه', () => {
  const isOwn = makeOwnShopMatcher(DEFAULT_PROFILE_CONFIG.filters.ownShopNames, DEFAULT_PROFILE_CONFIG.filters.ownShopIds)
  for (const n of OWN_VARIANTS) assert.equal(isOwn({ shopName: n }), true, `باید خودی باشد: ${n}`)
  for (const n of NOT_OWN) assert.equal(isOwn({ shopName: n }), false, `نباید خودی باشد: ${n}`)
})

test('A3. پروفایل قدیمی بدون املاهای جدید هم از املاهای داخلی بهره می‌برد', () => {
  const isOwn = makeOwnShopMatcher(['sgeooole', 'ekgkala'], undefined) // پروفایل ذخیره‌شدهٔ قدیمی
  assert.equal(isOwn({ shopName: 'ای کی جی کالا' }), true)
  assert.equal(isOwn({ shopName: 'EKG Kala' }), true)
  assert.ok(BUILTIN_OWN_SHOP_ALIASES.length >= 6)
})

test('A4. نام کوتاه (کمتر از ۵ نویسهٔ فشرده) هرگز زیررشته‌یاب نمی‌شود', () => {
  const isOwn = makeOwnShopMatcher(['ekg', 'ab'], undefined)
  assert.equal(isOwn({ shopName: 'ekg shop' }), false)
  assert.equal(isOwn({ shopName: 'abc' }), false)
})

test('A5. شناسهٔ فروشندهٔ ترب (ownShopIds): برابری دقیق، نه زیررشته', () => {
  const isOwn = makeOwnShopMatcher([], ['78123'])
  assert.equal(isOwn({ shopName: 'هر نام دیگری', shopId: '78123' }), true)
  assert.equal(isOwn({ shopName: 'هر نام دیگری', shopId: '781234' }), false)
  assert.equal(isOwn({ shopName: 'هر نام دیگری', shopId: '7812' }), false)
})

test('A6. applyValidityFilters همهٔ املاها را «فروشگاه خودمان» حذف می‌کند و رقبا می‌مانند', () => {
  const offers = [...OWN_VARIANTS, ...NOT_OWN].map((n, i) => ({ shopName: n, shopId: `s${i}`, price: 1000000 + i, inStock: true, sellerType: 'online', lastChangedAt: now }))
  const res = applyValidityFilters(offers, DEFAULT_PROFILE_CONFIG.filters, now, DEFAULT_PROFILE_CONFIG.rank1)
  for (let i = 0; i < OWN_VARIANTS.length; i++) {
    assert.equal(res[i].included, false, `باید حذف شود: ${OWN_VARIANTS[i]}`)
    assert.equal(res[i].excludeReason, 'فروشگاه خودمان')
  }
  for (let i = OWN_VARIANTS.length; i < res.length; i++) assert.equal(res[i].included, true, `نباید حذف شود: ${NOT_OWN[i - OWN_VARIANTS.length]}`)
})

test('A7. ownShopIds در فیلتر هم کار می‌کند (نام کاملاً متفاوت)', () => {
  const cfg = structuredClone(DEFAULT_PROFILE_CONFIG)
  cfg.filters.ownShopIds = ['78123']
  const res = applyValidityFilters(
    [{ shopName: 'نام غیرمرتبط', shopId: '78123', price: 1000000, inStock: true, lastChangedAt: now }, { shopName: 'رقیب', shopId: '9', price: 1000001, inStock: true, lastChangedAt: now }],
    cfg.filters, now, cfg.rank1,
  )
  assert.equal(res[0].included, false)
  assert.equal(res[1].included, true)
})

test('A8. detectOwnPriceEcho: فقط وقتی ارزان‌ترین پیشنهاد معتبر برابر قیمت اخیر خودمان باشد', () => {
  const offers = [
    { shopName: 'الف', price: 2450000, included: true },
    { shopName: 'ب', price: 2470000, included: true },
    { shopName: 'خودی-ناشناخته', price: 2440000, included: true },
    { shopName: 'حذف‌شده', price: 2000000, included: false },
  ]
  assert.deepEqual(detectOwnPriceEcho(offers, [2440000, 2458000]).shopNames, ['خودی-ناشناخته'])
  assert.equal(detectOwnPriceEcho(offers, [2440000]).cheapestIsEcho, true)
  assert.equal(detectOwnPriceEcho(offers, [2458000]).cheapestIsEcho, false) // قیمت ما در بازار ارزان‌ترین نیست
  assert.equal(detectOwnPriceEcho(offers, [2000000]).cheapestIsEcho, false) // پیشنهاد حذف‌شده شمرده نمی‌شود
  assert.equal(detectOwnPriceEcho(offers, undefined).cheapestIsEcho, false)
  assert.equal(detectOwnPriceEcho([], [1]).cheapestPrice, null)
})

// ---- شبیه‌سازی اجراهای متوالی: هر اجرا قیمت جدیدِ خودمان را در لیستینگ ترب می‌بیند (بدون تأخیر ترب)
function simulate(ownName, { feedEchoPrices }) {
  const comp = [
    { shopName: 'دیجی‌کالا', shopCity: 'تهران', price: 2480000, shopScore: 4.8 },
    { shopName: 'تکنولایف', shopCity: 'تهران', price: 2460000, shopScore: 4.9 },
    { shopName: 'شرق دیجیتال', shopCity: 'مشهد', price: 2470000, shopScore: 4.9 },
    { shopName: 'کالاتیک', shopCity: 'تهران', price: 2490000, shopScore: 4.7 },
    { shopName: 'پلازا مشهد', shopCity: 'مشهد', price: 2500000, shopScore: 4.6 },
  ].map((o, i) => ({ ...o, shopId: 's' + i, lastChangedAt: now, inStock: true, sellerType: 'online' }))
  let own = 2520000
  const history = [own]
  const traj = []
  for (let it = 0; it < 12; it++) {
    const offers = [...comp, { shopName: ownName, shopId: 'own', shopCity: 'مشهد', price: own, lastChangedAt: now, inStock: true, sellerType: 'online', shopScore: 4.5 }]
    const source = { source: 'torob', productTitle: 'دوربین داهوا 2MP', offers, totalSellerCount: offers.length, fetchedAt: now, ok: true }
    const r = runPricingPipeline(source, {
      productId: 1, productName: 'دوربین داهوا 2MP', costPrice: 2300000,
      supplierQuotes: [{ supplierName: 'پخش مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
      currentFinalPrice: own, ownRecentPrices: feedEchoPrices ? [...history] : undefined,
      config: structuredClone(DEFAULT_PROFILE_CONFIG), now,
    })
    traj.push({ it, own, final: r.finalPrice, review: r.needsReview, reasons: r.reviewReasons })
    if (r.finalPrice && !r.needsReview) { own = r.finalPrice; history.push(own) }
  }
  return traj
}

test('A9. کنترل: نام شناخته‌شده ⇒ پیشنهاد خودی حذف می‌شود و قیمت بعد از اولین تصمیم ثابت می‌ماند', () => {
  const t = simulate('ای‌کا‌جی کالا', { feedEchoPrices: true })
  assert.ok(t.every((x) => !x.review), 'نباید ریویو بخورد')
  assert.equal(new Set(t.slice(1).map((x) => x.final)).size, 1, 'بعد از اولین تصمیم قیمت ثابت است')
})

test('A10. املای دیگر («ای کی جی کالا») قبلاً نشت می‌کرد؛ حالا حذف می‌شود و مسابقهٔ کاهشی رخ نمی‌دهد', () => {
  const t = simulate('ای کی جی کالا', { feedEchoPrices: false })
  assert.equal(new Set(t.slice(1).map((x) => x.final)).size, 1)
  assert.equal(t[0].final, t[11].final)
})

test('A11. نام کاملاً ناشناخته: گارد پژواک اعمال خودکار را متوقف می‌کند (قیمت از کف سود پایین‌تر نمی‌لغزد)', () => {
  const t = simulate('فروشگاه با نام کاملاً ناشناخته', { feedEchoPrices: true })
  // اجرای اول: قیمت ما ۲٬۵۲۰٬۰۰۰ است و ارزان‌ترین رقیب ۲٬۴۶۰٬۰۰۰ ⇒ تصمیم عادی؛ اجرای بعد پژواک دیده می‌شود
  const flagged = t.filter((x) => x.review && x.reasons.some((r) => r.includes('پژواک') || r.includes('پیشنهاد خودی')))
  assert.ok(flagged.length >= 1, 'باید حداقل یک بار پژواک تشخیص داده شود')
  const applied = t.filter((x) => !x.review).map((x) => x.final)
  const floor = 2402000
  assert.ok(Math.min(...applied) >= floor)
  // بدون گارد (feedEchoPrices=false) همان لیستینگ هر اجرا یک پله پایین‌تر می‌رود — مبنای مقایسه
  const unguarded = simulate('فروشگاه با نام کاملاً ناشناخته', { feedEchoPrices: false })
  assert.ok(unguarded[11].final < unguarded[1].final, 'بدون گارد قیمت کاهش می‌یابد (رفتار قبلی)')
  assert.ok(applied.length < unguarded.length, 'با گارد اعمال خودکار متوقف می‌شود')
  const lastGuarded = t[11].final
  assert.ok(lastGuarded >= unguarded[11].final, 'با گارد پایین‌تر از حالت بدون گارد نمی‌رود')
})

test('A12. selfShopInListing در گیت هویت با املای نیم‌فاصله‌دار هم درست است (قبلاً false)', () => {
  const offers = ['دیجی‌کالا', 'تکنولایف', 'شرق دیجیتال', 'کالاتیک', 'ای‌کا‌جی‌کالا'].map((n, i) => ({ shopName: n, shopId: 's' + i, price: 2460000 + i * 10000, lastChangedAt: now, inStock: true, sellerType: 'online', shopScore: 4.5 }))
  const source = { source: 'torob', productTitle: 'دوربین داهوا 2MP', offers, totalSellerCount: offers.length, fetchedAt: now, ok: true }
  const r = runPricingPipeline(source, {
    productId: 1, productName: 'دوربین داهوا 2MP', costPrice: 2300000,
    supplierQuotes: [{ supplierName: 'پخش مشهد', rawPrice: 2320000, supplierCity: 'مشهد', priority: 9, inStock: true, updatedAt: now }],
    config: structuredClone(DEFAULT_PROFILE_CONFIG), now,
  })
  const idStep = r.steps.find((s) => s.step === 'identity' || (s.data && 'selfShopInListing' in s.data))
  assert.ok(idStep, 'گام هویت باید ثبت شود')
  assert.equal(idStep.data.selfShopInListing, true)
})
