'use strict'
/**
 * قابلیت اطمینان همگام‌سازی فروشگاه (۴.۲.۰): dry-run بسته‌شونده (fail-closed)، retry محدود، idempotency،
 * تطبیق پاسخ فروشگاه و قرارداد امضا. fetch جعلی است؛ هیچ شبکه/دیتابیسی لازم نیست.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

// connectors.ts به @/db وابسته است؛ Pool تنبل است و این آزمون‌ها هیچ کوئری‌ای نمی‌زنند،
// پس یک آدرس ساختگی کافی است (هیچ اتصال واقعی برقرار نمی‌شود).
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/test'
const conn = loadTsModule('src/lib/store/connectors.ts')
const { verifyStoreDryRun, sgeoooleAdapter, buildSgeoooleRequestPayload, computePricingSyncSignature } = conn

const CFG = { baseUrl: 'https://store.test', apiKey: 'k9Qz-Lm3vXp7-Rt2WuYb-8NcHs4Dj1A', retryDelayMs: '0' }
const PAYLOAD = {
  productId: 1,
  sku: 'CAM-1',
  storeExternalId: 'KY-100',
  effectiveCostPrice: 2000000,
  hardFloorPrice: 2100000,
  basePrice: 2700000,
  finalPrice: 2430000,
  discountPct: 10,
  campaignType: 'flash',
  decisionId: 42,
  confidence: 0.95,
}

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

/** fetch جعلی با صف پاسخ؛ هر پاسخ می‌تواند Error (پرتاب) باشد */
function mockFetch(responder) {
  const calls = []
  const orig = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const r = await responder(String(url), init, calls.length)
    if (r instanceof Error) throw r
    return r
  }
  return { calls, restore: () => (global.fetch = orig) }
}

const isDry = (u) => u.includes('dryRun=1')
const okDry = jsonRes(200, { ok: true, valid: true, success: true })
const okLive = (price = PAYLOAD.finalPrice, extra = {}) => jsonRes(200, { success: true, ok: true, valid: true, data: { finalPrice: price }, ...extra })

test('S1. dry-run: خطای شبکه ⇒ ok=false و هیچ push زنده‌ای انجام نمی‌شود', async () => {
  const m = mockFetch(async () => new Error('ECONNRESET'))
  try {
    const r = await verifyStoreDryRun(CFG, PAYLOAD)
    assert.equal(r.ok, false)
    assert.equal(r.code, 'DRY_RUN_NETWORK_ERROR')
    const p = await sgeoooleAdapter.push({ ...CFG, maxRetries: '1' }, PAYLOAD)
    assert.equal(p.ok, false)
    assert.ok(m.calls.every((c) => isDry(c.url)), 'نباید به اندپوینت زنده رسید')
  } finally {
    m.restore()
  }
})

test('S2. dry-run: HTTP غیر 2xx، بدنه خالی، JSON خراب و نبود تایید صریح همگی ⇒ ok=false', async () => {
  const cases = [
    [jsonRes(500, { message: 'boom' }), /HTTP_500|DRY_RUN_HTTP_500/],
    [jsonRes(401, { code: 'PRICING_SYNC_UNAUTHORIZED', message: 'x' }), /UNAUTHORIZED/],
    [jsonRes(200, ''), /EMPTY_RESPONSE/],
    [jsonRes(200, 'not-json{'), /INVALID_JSON/],
    [jsonRes(200, '[]'), /INVALID_JSON/],
    [jsonRes(200, { success: true }), /DRY_RUN_REJECTED/],
    [jsonRes(200, { ok: true }), /DRY_RUN_REJECTED/],
    [jsonRes(200, { ok: true, valid: false, code: 'BELOW_COST_PRICE' }), /BELOW_COST_PRICE/],
    [jsonRes(200, { ok: false, valid: true }), /DRY_RUN_REJECTED/],
  ]
  for (const [res, codeRe] of cases) {
    const m = mockFetch(async () => res)
    try {
      const r = await verifyStoreDryRun(CFG, PAYLOAD)
      assert.equal(r.ok, false, JSON.stringify(res))
      assert.match(String(r.code), codeRe)
    } finally {
      m.restore()
    }
  }
  const m = mockFetch(async () => okDry)
  try {
    assert.equal((await verifyStoreDryRun(CFG, PAYLOAD)).ok, true)
  } finally {
    m.restore()
  }
})

test('S3. رد dry-run (غیرقابل‌تکرار) بدون retry و بدون push زنده بسته می‌شود', async () => {
  const m = mockFetch(async () => jsonRes(200, { ok: false, valid: false, code: 'BELOW_HARD_FLOOR', message: 'کف' }))
  try {
    const r = await sgeoooleAdapter.push(CFG, PAYLOAD)
    assert.equal(r.ok, false)
    assert.equal(r.stage, 'dry_run')
    assert.equal(r.retryable, false)
    assert.equal(m.calls.length, 1)
  } finally {
    m.restore()
  }
})

test('S4. 5xx گذرا: retry محدود با backoff و در نهایت موفقیت؛ idempotency key در همهٔ تلاش‌ها ثابت است', async () => {
  let live = 0
  const m = mockFetch(async (url) => {
    if (isDry(url)) return okDry
    live++
    return live < 3 ? jsonRes(503, { message: 'down' }) : okLive()
  })
  try {
    const r = await sgeoooleAdapter.push({ ...CFG, maxRetries: '4' }, PAYLOAD)
    assert.equal(r.ok, true)
    assert.equal(r.attempts, 3)
    assert.equal(r.confirmedPrice, PAYLOAD.finalPrice)
    const keys = new Set(m.calls.map((c) => c.init.headers['X-Idempotency-Key']))
    assert.equal(keys.size, 1)
    assert.ok([...keys][0].includes('42'))
  } finally {
    m.restore()
  }
})

test('S5. retry سقف دارد: پس از maxRetries خطای 5xx ⇒ ok=false و retryable', async () => {
  let live = 0
  const m = mockFetch(async (url) => {
    if (isDry(url)) return okDry
    live++
    return jsonRes(500, { message: 'down' })
  })
  try {
    const r = await sgeoooleAdapter.push({ ...CFG, maxRetries: '2' }, PAYLOAD)
    assert.equal(r.ok, false)
    assert.equal(live, 2)
    assert.equal(r.retryable, true)
  } finally {
    m.restore()
  }
})

test('S6. خطای 4xx (اعتبارسنجی/احراز هویت) retry نمی‌شود و fallback ناامن PUT /api/products/:id وجود ندارد', async () => {
  let live = 0
  const m = mockFetch(async (url) => {
    if (isDry(url)) return okDry
    live++
    return jsonRes(404, { message: 'nf' })
  })
  try {
    const r = await sgeoooleAdapter.push({ ...CFG, maxRetries: '4' }, { ...PAYLOAD, storeExternalId: '507f1f77bcf86cd799439011' })
    assert.equal(r.ok, false)
    assert.equal(live, 1)
    assert.ok(m.calls.every((c) => c.init.method === 'POST'))
    assert.ok(m.calls.every((c) => !/\/api\/products\/[a-f0-9]{24}/.test(c.url)))
  } finally {
    m.restore()
  }
})

test('S7. تطبیق پاسخ فروشگاه: قیمت تاییدشدهٔ متفاوت ⇒ ok=false (STORE_RECONCILIATION_MISMATCH)؛ پاسخ بدون success ⇒ ok=false', async () => {
  let m = mockFetch(async (url) => (isDry(url) ? okDry : okLive(PAYLOAD.finalPrice + 5000)))
  try {
    const r = await sgeoooleAdapter.push(CFG, PAYLOAD)
    assert.equal(r.ok, false)
    assert.equal(r.code, 'STORE_RECONCILIATION_MISMATCH')
  } finally {
    m.restore()
  }
  m = mockFetch(async (url) => (isDry(url) ? okDry : jsonRes(200, { message: 'hmm' })))
  try {
    const r = await sgeoooleAdapter.push(CFG, PAYLOAD)
    assert.equal(r.ok, false)
  } finally {
    m.restore()
  }
  m = mockFetch(async (url) => (isDry(url) ? okDry : okLive(PAYLOAD.finalPrice, { idempotentReplay: true })))
  try {
    const r = await sgeoooleAdapter.push(CFG, PAYLOAD)
    assert.equal(r.ok, true)
    assert.equal(r.idempotentReplay, true)
  } finally {
    m.restore()
  }
})

test('S8. گارد محلی: تمام کانکتورها حتی با مجوز سابق فروش زیر کف را قبل از ارسال متوقف می‌کنند', async () => {
  let m = mockFetch(async () => okDry)
  try {
    const r = await sgeoooleAdapter.push(CFG, { ...PAYLOAD, finalPrice: 1900000 })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'BELOW_COST_PRICE')
    const r2 = await sgeoooleAdapter.push(CFG, { ...PAYLOAD, finalPrice: 2050000 })
    assert.equal(r2.code, 'BELOW_HARD_FLOOR')
    assert.equal(m.calls.length, 0)
    // مجوز ناقص (دلیل کوتاه) هنوز مسدود
    const r3 = await sgeoooleAdapter.push(CFG, { ...PAYLOAD, finalPrice: 1900000, belowCostOverride: { allowBelowCost: true, reason: 'ab', authorizedBy: 'admin' } })
    assert.equal(r3.ok, false)
  } finally {
    m.restore()
  }
  m = mockFetch(async (url) => (isDry(url) ? okDry : okLive(1900000)))
  try {
    const r = await sgeoooleAdapter.push(CFG, {
      ...PAYLOAD,
      finalPrice: 1900000,
      basePrice: 1900000,
      discountPct: 0,
      campaignType: 'none',
      belowCostOverride: { allowBelowCost: true, reason: 'تصفیه انبار', authorizedBy: 'admin@ekgkala.ir' },
    })
    assert.equal(r.code, 'BELOW_COST_PRICE')
    for (const adapter of Object.values(conn.adapters)) {
      for (const patch of [
        { effectiveCostPrice: 0 },
        { basePrice: 2700000, finalPrice: 2430000, discountPct: 50 },
        { finalPrice: 1900000, belowCostOverride: { allowBelowCost: true, reason: 'clearance', authorizedBy: 'manager' } },
      ]) {
        const result = await adapter.push(CFG, { ...PAYLOAD, ...patch })
        assert.equal(result.stage, 'precheck', adapter.type)
        assert.equal(result.ok, false)
      }
    }
    assert.equal(m.calls.length, 0)
  } finally {
    m.restore()
  }
})

test('S9. قرارداد درخواست: idempotencyKey/decisionId و امضای HMAC با همان canonical سمت فروشگاه', async () => {
  const m = mockFetch(async (url) => (isDry(url) ? okDry : okLive()))
  try {
    await sgeoooleAdapter.push(CFG, PAYLOAD)
    const live = m.calls.find((c) => !isDry(c.url))
    const h = live.init.headers
    const body = JSON.parse(live.init.body)
    assert.equal(body.decisionId, 42)
    assert.equal(body.idempotencyKey, h['X-Idempotency-Key'])
    assert.equal(h['X-Pricing-Secret'], CFG.apiKey)
    assert.ok(h['X-Pricing-Timestamp'])
    const expected = computePricingSyncSignature(CFG.apiKey, h['X-Pricing-Timestamp'], body)
    assert.equal(h['X-Pricing-Signature'], `sha256=${expected}`)

    // سازگاری با پیاده‌سازی سمت sgeooole (دو ریپو باید یک canonical داشته باشند)
    const path = require('node:path')
    const auth = require(path.resolve(__dirname, '..', '..', 'sgeooole', 'ekgkala-backend', 'utils', 'pricingSyncAuth.js'))
    // main فروشگاه (ac48b90 به بعد) تأیید HMAC ندارد (فقط در commit حذف‌شدهٔ 29a2ff6 بود)؛
    // در آن صورت بخش تطبیق canonical بین دو ریپو رد می‌شود و بقیهٔ قرارداد امضا همچنان سنجیده می‌شود.
    if (typeof auth.verifyPricingSyncSignature !== 'function') return
    const v = auth.verifyPricingSyncSignature(
      { 'x-pricing-secret': CFG.apiKey, 'x-pricing-timestamp': h['X-Pricing-Timestamp'], 'x-pricing-signature': h['X-Pricing-Signature'] },
      body,
      { SGEOOOLE_PRICING_SECRET: CFG.apiKey },
    )
    assert.equal(v.ok, true, JSON.stringify(v))
    assert.equal(auth.verifyPricingSyncSignature({ 'x-pricing-secret': CFG.apiKey, 'x-pricing-timestamp': h['X-Pricing-Timestamp'], 'x-pricing-signature': h['X-Pricing-Signature'] }, { ...body, finalPrice: 1 }, { SGEOOOLE_PRICING_SECRET: CFG.apiKey }).ok, false)
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') return // ریپوی sgeooole در این محیط نیست
    throw e
  } finally {
    m.restore()
  }
})

test('S10. buildSgeoooleRequestPayload: کلید پیش‌فرض از decisionId ساخته می‌شود و صراحتاً داده‌شده حفظ می‌شود', () => {
  assert.match(buildSgeoooleRequestPayload(PAYLOAD).idempotencyKey, /42/)
  assert.equal(buildSgeoooleRequestPayload({ ...PAYLOAD, idempotencyKey: 'custom-1' }).idempotencyKey, 'custom-1')
})
