'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { installFakeTorob, mcpOffer } = require('./helpers/fake-torob-mcp.cjs')

const client = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')

const NOW = new Date('2026-10-23T08:00:00.000Z')
const NAME = 'دوربین مداربسته تحت شبکه بولت هایک ویژن مدل DS-2CD1023G0E-I'
const card = (prk, fa, en, price = 2400000, n = 12) => ({ prk, name_fa: fa, name_en: en, price_toman: price, available: true, shop_name: `در ${n} فروشگاه`, shop_count: n, url: `https://torob.com/p/${prk}/`, details_url: `https://api.torob.com/v4/base-product/details/?prk=${prk}` })

const GOOD = card('good', 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I', 'Hikvision DS-2CD1023G0E-I IP Camera')
const MOUNT = card('mount', 'پایه دوربین هایک ویژن مدل DS-1280ZJ-DM18', 'Hikvision DS-1280ZJ-DM18 Bracket', 350000)
const SIBLING = card('sib', 'دوربین مداربسته تحت شبکه هایک ویژن مدل DS-2CD1043G0-I', 'Hikvision DS-2CD1043G0-I IP Camera', 3100000)

function market(prices) {
  return prices.map((p, i) => mcpOffer({ shop: `ف${i}`, price: p, ageDays: 0.2 + i * 0.1, score: 4.7, votes: 90 }))
}

test('buildSearchQueries: نام کامل ← کد مدل ← برند+کد، بدون تکرار', () => {
  const qs = client.buildSearchQueries(NAME, null)
  assert.equal(qs[0], NAME)
  assert.ok(qs.includes('DS-2CD1023G0E-I'), 'پرس‌وجوی فقط-کد باید ساخته شود')
  assert.ok(qs.length <= 3)
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, qs.length)
  // کد داخل «مناسب برای ...» هویت کالا نیست
  const acc = client.buildSearchQueries('پایه دوربین مناسب برای هایک ویژن DS-2CD1023G0E-I', null)
  assert.ok(!acc.includes('DS-2CD1023G0E-I'), 'کد لوازم جانبی نباید پرس‌وجوی مستقل شود')
})

test('جستجوی چندمرحله‌ای: مرحلهٔ اول فقط کارت‌های نامرتبط، مرحلهٔ دوم (کد مدل) کارت درست', async () => {
  const fake = installFakeTorob({
    search: (q) => (q === NAME ? [MOUNT, SIBLING] : [GOOD, MOUNT]),
    details: { good: { prk: 'good', name_fa: GOOD.name_fa, name_en: GOOD.name_en, cheapest_price_toman: 2380000, available: true, offers: market([2380000, 2400000, 2410000, 2450000, 2470000]) } },
  })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    assert.ok(r && r.ok, 'باید نتیجه بدهد')
    assert.equal(r.prk, 'good')
    assert.equal(r.productTitleEn, 'Hikvision DS-2CD1023G0E-I IP Camera')
    assert.equal(r.meta.searchQueries.length, 2, 'دو پرس‌وجو انجام شده')
    assert.equal(r.offers.length, 5)
    assert.equal(r.meta.offersTruncated, false)
  } finally {
    fake.restore()
  }
})

test('جستجو به محض «تایید خودکار» متوقف می‌شود (بدون پرس‌وجوی اضافه)', async () => {
  const fake = installFakeTorob({
    search: () => [GOOD, MOUNT],
    details: { good: { prk: 'good', name_fa: GOOD.name_fa, name_en: GOOD.name_en, cheapest_price_toman: 2380000, available: true, offers: market([2380000, 2400000, 2410000]) } },
  })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    assert.equal(r.meta.searchQueries.length, 1)
    assert.equal(fake.calls.filter((c) => c.name === 'search_products').length, 1)
  } finally {
    fake.restore()
  }
})

test('همهٔ کارت‌ها نامرتبط ⇒ رد در جستجو (بدون قیمت‌گذاری روی کارت اشتباه)', async () => {
  const fake = installFakeTorob({ search: () => [MOUNT, SIBLING], details: {} })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    assert.ok(r && !r.ok)
    assert.equal(r.meta.rejectedInSearch, true)
    assert.equal(fake.calls.filter((c) => c.name === 'product_details').length, 0, 'برای کارت ردشده جزئیات نباید گرفته شود')
  } finally {
    fake.restore()
  }
})

test('چالش امنیتی ۴۹۰ در جستجو ⇒ نتیجهٔ challenged (بدون تلاش‌های بعدی)', async () => {
  const fake = installFakeTorob({ challenge: (name) => name === 'search_products', search: () => [] })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    assert.equal(r.ok, false)
    assert.equal(r.meta.challenged, true)
    assert.equal(fake.calls.length, 1)
  } finally {
    fake.restore()
  }
})

test('prk ذخیره‌شده: جستجو انجام نمی‌شود ولی عنوان کارت برای گیت هویت در موتور می‌آید', async () => {
  const fake = installFakeTorob({
    details: { good: { prk: 'good', name_fa: GOOD.name_fa, name_en: GOOD.name_en, cheapest_price_toman: 2380000, available: true, offers: market([2380000, 2400000, 2410000, 2420000]) } },
  })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', prk: 'good', productName: NAME, now: NOW })
    assert.equal(fake.calls.filter((c) => c.name === 'search_products').length, 0)
    assert.ok(r.ok && r.productTitle === GOOD.name_fa && r.productTitleEn)
  } finally {
    fake.restore()
  }
})

test('prk ذخیره‌شده‌ی اشتباه (کارت لوازم جانبی) توسط گیت هویت موتور هم‌چنان گرفته می‌شود', async () => {
  const fake = installFakeTorob({
    details: { mount: { prk: 'mount', name_fa: MOUNT.name_fa, name_en: MOUNT.name_en, cheapest_price_toman: 350000, available: true, offers: market([350000, 360000, 370000, 380000]) } },
  })
  try {
    const src = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', prk: 'mount', productName: NAME, now: NOW })
    const res = runPricingPipeline(src, { productId: 1, productName: NAME, costPrice: 2000000, supplierQuotes: [], config: JSON.parse(JSON.stringify(DEFAULT_PROFILE_CONFIG)), now: NOW })
    assert.equal(res.needsReview, true)
    assert.ok(res.reviewReasons.some((x) => /هویت/.test(x)), 'باید دلیل هویتی ثبت شود')
  } finally {
    fake.restore()
  }
})

test('برش خروجی ۳۰تایی: پرچم truncated و تعداد کل پیشنهادها به موتور می‌رسد', async () => {
  const many = []
  for (let i = 0; i < 45; i++) many.push(mcpOffer({ shop: `ف${i}`, price: 2400000 + i * 5000, ageDays: 0.3 }))
  const fake = installFakeTorob({
    search: () => [GOOD],
    details: { good: { prk: 'good', name_fa: GOOD.name_fa, name_en: GOOD.name_en, cheapest_price_toman: 2400000, available: true, offers: many } },
  })
  try {
    const r = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    assert.equal(r.meta.offersTruncated, true)
    assert.equal(r.meta.onlineOfferCount, 45)
    assert.equal(r.offers.length, 30)
    assert.equal(r.totalSellerCount, 45)
  } finally {
    fake.restore()
  }
})

test('کل مسیر: جستجو ← جزئیات ← موتور ⇒ قیمت رتبه ۱ زیر ارزان‌ترین معتبر', async () => {
  const fake = installFakeTorob({
    search: () => [GOOD, MOUNT],
    details: { good: { prk: 'good', name_fa: GOOD.name_fa, name_en: GOOD.name_en, cheapest_price_toman: 2380000, available: true, offers: market([2380000, 2395000, 2410000, 2420000, 2440000, 2460000]) } },
  })
  try {
    const src = await client.fetchViaTorobMcpServer({ mcpUrl: 'http://fake', productName: NAME, now: NOW })
    const res = runPricingPipeline(src, { productId: 1, productName: NAME, costPrice: 2000000, supplierQuotes: [], config: JSON.parse(JSON.stringify(DEFAULT_PROFILE_CONFIG)), now: NOW })
    assert.ok(res.finalPrice != null && res.finalPrice < 2380000 && res.finalPrice >= 2370000, `قیمت ${res.finalPrice}`)
    assert.ok(res.finalPrice > res.supply.hardFloorPrice - 1)
  } finally {
    fake.restore()
  }
})
