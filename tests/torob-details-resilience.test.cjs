'use strict'
// رگرسیون P0 «Eliminate Avoidable First-Inquiry Torob Details Timeouts»:
// بازیابی واجدشرط جزئیات در مهلت کل، fallback مستقیم، حفظ نتایج سالم، طبقه‌بندی دقیق خطا،
// کش موفقیت‌ها (بدون کشِ شکست‌ها)، single-flight سالم، و حفظ نوارهای هویت/قیمت‌گذاری.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTsModule } = require('./helpers/ts-loader.cjs')
const { mcpOffer } = require('./helpers/fake-torob-mcp.cjs')

const { fetchViaTorobMcpServer } = loadTsModule('src/lib/sources/torob-mcp-client.ts')
const { retrieveTorobDetailsWithRecovery, TOROB_DETAILS_FAILURE_MESSAGES } = loadTsModule('src/lib/sources/torob-details-resilience.ts')
const { runPricingPipeline } = loadTsModule('src/lib/pricing/engine.ts')
const { DEFAULT_PROFILE_CONFIG } = loadTsModule('src/lib/pricing/types.ts')
const { TorobDiscoveryCache } = loadTsModule('src/lib/sources/torob-cache.ts')

const NOW = new Date('2026-11-28T10:00:00.000Z')
const NAME = 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1023G0E-I'
const TARGET = { productName: NAME, sku: 'DS-2CD1023G0E-I', anchorPriceToman: 2400000 }
// بودجهٔ فشرده برای تست: تلاش اول ≈۲.۴ث، بازیابی ≈۱.۱ث، کل ۸ث — بدون کند کردن کل مجموعه
const TEST_BUDGETS = { detailsTimeoutMs: 4000, detailsBudgetMs: 8000, searchTimeoutMs: 2000, searchBudgetMs: 8000 }

const sleepWithAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('The operation was aborted', 'AbortError'))
  const timer = setTimeout(() => resolve(), ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('The operation was aborted', 'AbortError'))
  }, { once: true })
})

const goodCard = (prk, title) => ({ prk, name_fa: title, name_en: 'Hikvision DS-2CD1023G0E-I IP Camera', price_toman: 2400000, available: true, shop_name: 'در ۵ فروشگاه', shop_count: 5, url: `https://torob.com/p/${prk}/` })
const GOOD_A = goodCard('good-a', NAME)
const GOOD_B = goodCard('good-b', NAME)

const payloadFor = (prk) => detailPayload(prk === GOOD_B.prk ? GOOD_B : GOOD_A)

const detailPayload = (card) => ({
  prk: card.prk,
  name_fa: card.name_fa,
  name_en: card.name_en,
  cheapest_price_toman: card.price_toman,
  available: true,
  offer_count: 2,
  offers: [
    { ...mcpOffer({ shop: 'فروشنده تأیید', price: 2380000 }), product_title: card.name_fa },
    { ...mcpOffer({ shop: 'فروشنده دوم', price: 2420000 }), product_title: card.name_fa },
  ],
  in_person_sellers: [],
})

/**
 * مک fetch با تزریق خرابی:
 *   detailsScript: نقشهٔ رفتار product_details به‌ازای هر prk —
 *     { [prk]: [{ kind: 'ok' | 'timeout' | 'slow-ok' | 'hang-body' | 'http' | 'challenge' | 'rate' | 'notfound', delayMs? }] }
 */
function makeMcpHarness({ detailsScript = {}, fallbackDetails: fallbackOption, similarResults = [] } = {}) {
  const calls = []
  let fetchSpy = null
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(init.body)
    const { name, arguments: args } = body.params
    calls.push({ name, args })
    const reply = (payload, isError = false) => new Response(
      JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { isError, content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    if (name === 'search_products') return reply({ products: [GOOD_A, GOOD_B] })
    if (name === 'similar_products') return reply({ products: similarResults })
    if (name === 'price_history') return reply({ series: [] })
    if (name === 'product_details') {
      const prkScript = detailsScript[args.prk] ?? [{ kind: 'ok' }]
      const step = prkScript.length > 1 ? prkScript.shift() : (prkScript[0] ?? { kind: 'ok' })
      switch (step.kind) {
        case 'timeout': {
          // کل فراخوانی (سر تا ته) از مهلت تلاش طولانی‌تر است؛ signal باعث AbortError می‌شود
          await sleepWithAbort(step.delayMs ?? 9000, init.signal)
          return reply(payloadFor(args.prk))
        }
        case 'slow-ok': {
          // پاسخ درست ولی دیر — با abort قطع می‌شود؛ تلاش بعدی سریع است
          await sleepWithAbort(step.delayMs ?? 9000, init.signal)
          return reply(payloadFor(args.prk))
        }
        case 'hang-body': {
          // هدرها می‌رسند ولی بدنه هرگز کامل نمی‌شود (خواندن body باید با signal قطع شود)
          return new Response(new ReadableStream({ start() { /* هرگز بسته نمی‌شود */ } }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        case 'http':
          return new Response('down', { status: step.status ?? 502, headers: { 'content-type': 'text/plain' } })
        case 'challenge':
          return reply('Torob challenged the request (HTTP 490)', true)
        case 'rate':
          return new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain' } })
        case 'notfound':
          return reply('not found', true)
        default:
          return reply(payloadFor(args.prk))
      }
    }
    return reply('unknown tool', true)
  }
  const install = () => {
    const original = globalThis.fetch
    fetchSpy = async (url, init) => fetchImpl(url, init)
    globalThis.fetch = fetchSpy
    return () => { globalThis.fetch = original }
  }
  const fallbackCalls = []
  // fallbackDetails: false ⇒ بدون fallback؛ undefined ⇒ پیش‌فرضِ همیشه‌موفق برای سناریوهای fallback
  const fallbackDetails = fallbackOption === false
    ? undefined
    : (fallbackOption ?? ((card, timeoutMs) => {
      fallbackCalls.push({ prk: card.prk, timeoutMs })
      const base = payloadFor(card.prk)
      return Promise.resolve({ origin: 'torob_v4', data: { ...base, titleFa: base.name_fa, titleEn: base.name_en ?? null, titleEvidence: { fields: ['name1'], parsed: true }, specs: [], imageUrls: [], offers: base.offers.map((o) => ({ shopName: o.shop_name, shopId: o.shop_id, price: o.price_toman, currency: 'toman', observedAt: NOW, listingTitle: o.product_title, sellerType: 'online', shopScore: 4.6, shopVotes: 60, priceUnreliable: false, isAd: false, inStock: true, deliveredPrice: o.price_toman })), sellerRows: base.offers.length, totalSellerCount: base.offers.length, inPersonSellerCount: 0, onlineOfferCount: base.offers.length, offersTruncated: false } })
    }))
  return { calls, fallbackCalls, install, fallbackDetails }
}

const inquiryOpts = (world, extra = {}) => ({
  mcpUrl: 'http://fake-mcp.local/mcp',
  ...TARGET,
  now: NOW,
  budgets: TEST_BUDGETS,
  fallbackDetails: world.fallbackDetails,
  ...extra,
})

test('1. اولین تلاش جزئیات time-out می‌شود؛ تلاش بازیابیِ محدود در همان مهلت کل موفق است', async () => {
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const started = Date.now()
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk }))
    const elapsed = Date.now() - started
    assert.equal(res.ok, true, `استعلام باید با بازیابی موفق شود: ${res.error ?? ''}`)
    assert.equal(res.torob.status, 'MATCH_CONFIRMED')
    const attempts = res.meta?.detailsAttempts ?? []
    assert.ok(attempts.length >= 2, `دو تلاش ثبت شده باشد: ${attempts.length}`)
    assert.equal(attempts[0].failureKind, 'MCP_DETAILS_TIMEOUT')
    assert.equal(attempts[0].recoveredByLaterAttempt, true)
    assert.equal(attempts[1].failureKind, null)
    assert.equal(res.meta?.detailsRecovery, 'recovered')
    assert.equal(res.meta?.detailsCorrelationId.startsWith('dtl-'), true)
    // بازیابی داخل مهلت کل: مجموع مهلت تلاش‌ها از بودجهٔ جزئیات بیشتر نیست
    const totalAllocated = attempts.filter((a) => a.attempt > 0).reduce((s, a) => s + a.timeoutMs, 0)
    assert.ok(totalAllocated <= TEST_BUDGETS.detailsTimeoutMs + 400, `allocated=${totalAllocated}`)
    assert.ok(attempts.every((a) => a.durationMs <= a.timeoutMs + 250), 'هیچ تلاشی از مهلت اختصاصی خود عبور نکرده')
    assert.ok(elapsed < TEST_BUDGETS.detailsBudgetMs + 500, `elapsed=${elapsed}`)
  } finally {
    restore()
  }
})

test('2. MCP دوبار time-out می‌شود؛ fallback مستقیم ترب در مهلت باقی‌مانده موفق است', async () => {
  // بودجهٔ بزرگ‌تر تا سه تلاش (۲×MCP + fallback) با reserve نگه‌داشته‌شده برای fallback جا شود
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'timeout' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, {
      prk: GOOD_A.prk,
      budgets: { ...TEST_BUDGETS, detailsTimeoutMs: 6000, detailsBudgetMs: 12000 },
    }))
    assert.equal(res.ok, true, `fallback باید نجات دهد: ${res.error ?? ''}`)
    assert.equal(res.torob.status, 'MATCH_CONFIRMED')
    const attempts = res.meta?.detailsAttempts ?? []
    const transports = attempts.filter((a) => a.attempt > 0).map((a) => a.transport)
    assert.deepEqual(transports, ['mcp', 'mcp', 'torob_direct'])
    assert.equal(attempts.at(-1).failureKind, null)
    assert.equal(res.meta?.detailsRecovery, 'recovered')
  } finally {
    restore()
  }
})

test('3. پاسخ اول کُند است (headers+body دیر) و تلاش بعدی سریع — بازیابی ثبت می‌شود', async () => {
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'slow-ok', delayMs: 9000 }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk }))
    assert.equal(res.ok, true)
    const attempts = res.meta?.detailsAttempts ?? []
    assert.equal(attempts[0].failureKind, 'MCP_DETAILS_TIMEOUT')
    assert.equal(attempts[1].failureKind, null)
    assert.ok(attempts[1].durationMs < 1200, `تلاش دوم باید سریع باشد: ${attempts[1].durationMs}ms`)
  } finally {
    restore()
  }
})

test('4. هدرها می‌رسند ولی بدنه هرگز کامل نمی‌شود — خواندن body با مهلت تلاش قطع و بازیابی می‌شود', async () => {
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'hang-body' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk }))
    assert.equal(res.ok, true, `بدنِ معلق باید با مهلت تلاش قطع شود: ${res.error ?? ''}`)
    const attempts = res.meta?.detailsAttempts ?? []
    assert.equal(attempts[0].failureKind, 'MCP_DETAILS_TIMEOUT')
    assert.ok(attempts[0].durationMs <= attempts[0].timeoutMs + 300, 'قطع بدنه در مهلت تلاش رخ داده نه بی‌نهایت')
    assert.equal(attempts[1].failureKind, null)
  } finally {
    restore()
  }
})

test('5. timeout یک PRK، دادهٔ سالم PRK دیگر را دور نمی‌ریزد؛ کارت سالم primary می‌شود', async () => {
  const world = makeMcpHarness({
    fallbackDetails: false,
    detailsScript: {
      [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'timeout' }],
      [GOOD_B.prk]: [{ kind: 'ok' }],
    },
  })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world))
    assert.equal(res.ok, true, `استعلام با کارت سالم باید ادامه یابد: ${res.error ?? ''}`)
    assert.equal(res.prk, GOOD_B.prk, 'کارتِ با جزئیات سالم primary می‌شود')
    assert.equal(res.torob.status, 'MATCH_CONFIRMED')
    const perPrk = (res.meta?.detailsAttempts ?? []).filter((a) => a.prk === GOOD_A.prk && a.attempt > 0)
    assert.ok(perPrk.length >= 1 && perPrk.every((a) => a.failureKind === 'MCP_DETAILS_TIMEOUT'), 'شکست PRK اول با کد دقیق ثبت شده')
    // کارت ناموفق به‌عنوان شواهد کشفِ قابل‌retry حفظ می‌شود
    const diag = (res.torob.discoveryDiagnostics ?? []).find((d) => d.prk === GOOD_A.prk)
    assert.ok(diag, 'کارت ناموفق در تشخیص‌ها حفظ شده')
  } finally {
    restore()
  }
})

test('6. اتمام بودجهٔ کل پیش از هر درخواست جزئیات ⇒ DETAILS_GLOBAL_DEADLINE_EXCEEDED، نه پیام timeout', async () => {
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'ok' }] } })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, budgets: { ...TEST_BUDGETS, detailsBudgetMs: 0 } }))
    assert.equal(res.ok, false)
    assert.equal(res.torob.status, 'EXTRACTION_INCOMPLETE')
    assert.equal(res.meta?.detailsFailure?.kind, 'DETAILS_GLOBAL_DEADLINE_EXCEEDED')
    assert.match(String(res.error), /بودجهٔ کل استعلام جزئیات/)
    assert.doesNotMatch(String(res.error), /مهلت دریافت جزئیات کارت ترب از سرور MCP/)
    assert.equal(world.calls.filter((c) => c.name === 'product_details').length, 0, 'هیچ درخواست جزئیاتی شروع نشده')
  } finally {
    restore()
  }
})

test('7. ۴۲۹ و چالش امنیتی هرگز مثل timeout تکرار یا fallback نمی‌شوند', async () => {
  const rateWorld = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'rate' }] } })
  const rateRestore = rateWorld.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(rateWorld, { prk: GOOD_A.prk }))
    const attempts = (res.meta?.detailsAttempts ?? []).filter((a) => a.attempt > 0)
    assert.equal(attempts.length, 1, `فقط یک تلاش: ${attempts.length}`)
    assert.equal(attempts[0].failureKind, 'RATE_LIMITED')
    assert.equal(rateWorld.fallbackCalls.length, 0, 'برای 429 fallback زده نشده')
    assert.equal(res.ok, false)
  } finally {
    rateRestore()
  }
  const challengeWorld = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'challenge' }] } })
  const challengeRestore = challengeWorld.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(challengeWorld, { prk: GOOD_A.prk }))
    const attempts = (res.meta?.detailsAttempts ?? []).filter((a) => a.attempt > 0)
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].failureKind, 'ACCESS_CHALLENGE')
    assert.equal(challengeWorld.fallbackCalls.length, 0)
  } finally {
    challengeRestore()
  }
})

test('8. جزئیات موفق کش می‌شوند و استعلام دوم درخواست شبکه اضافه نمی‌زند', async () => {
  const cache = new TorobDiscoveryCache()
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'ok' }] } })
  const restore = world.install()
  try {
    const first = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache }))
    assert.equal(first.ok, true)
    const callsAfterFirst = world.calls.filter((c) => c.name === 'product_details').length
    assert.ok(callsAfterFirst >= 1)
    const second = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache, now: new Date(NOW.getTime() + 60_000) }))
    assert.equal(second.ok, true)
    assert.equal(world.calls.filter((c) => c.name === 'product_details').length, callsAfterFirst, 'استعلام دوم از کش خوانده: ۰ درخواست جدید')
    assert.equal((second.meta?.detailsAttempts ?? []).length, 0, 'مسیر کش ردّ تلاش شبکه تولید نمی‌کند')
  } finally {
    restore()
  }
})

test('9. شکست‌ها به‌عنوان موفقیت کش نمی‌شوند؛ بعد از بازیابی، دادهٔ سالم کش می‌شود', async () => {
  const cache = new TorobDiscoveryCache()
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'ok' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const first = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache }))
    assert.equal(first.ok, true)
    const attempts = first.meta?.detailsAttempts ?? []
    assert.equal(attempts[0].failureKind, 'MCP_DETAILS_TIMEOUT', 'شکست ثبت شده')
    const callsAfterRecovery = world.calls.filter((c) => c.name === 'product_details').length
    const second = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache, now: new Date(NOW.getTime() + 60_000) }))
    assert.equal(second.ok, true)
    assert.equal(world.calls.filter((c) => c.name === 'product_details').length, callsAfterRecovery,
      'دادهٔ بازیابی‌شدهٔ سالم کش شده و استعلام دوم شبکه نمی‌زند')
  } finally {
    restore()
  }
})

test('10. فراخواننده‌های هم‌زمانِ یک PRK با single-flight شریک می‌شوند و بازیابی برای هر دو کار می‌کند', async () => {
  const cache = new TorobDiscoveryCache()
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const [a, b] = await Promise.all([
      fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache })),
      fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk, cache, now: new Date(NOW.getTime() + 5) })),
    ])
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    const detailCalls = world.calls.filter((c) => c.name === 'product_details').length
    assert.ok(detailCalls <= 2, `single-flight: حداکثر ۲ فراخوانی شبکه (تلاش۱+بازیابی)، نه ۴: ${detailCalls}`)
    assert.equal(a.meta?.detailsRecovery, 'recovered')
    // شریکِ پرواز مشترک، «نتیجه» را به ارث می‌برد نه ردّ تلاش‌ها را (ردّ متعلق به مالک پرواز است)
    assert.equal(b.ok, true)
    assert.equal(b.torob.status, 'MATCH_CONFIRMED')
    assert.ok((b.meta?.detailsAttempts ?? []).length === 0 || b.meta?.detailsRecovery === 'recovered')
  } finally {
    restore()
  }
})

test('11. بازیابی همیشه داخل مهلت کل می‌ماند (بدون backoff بی‌ضابطه)', async () => {
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'timeout' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const started = Date.now()
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk }))
    const elapsed = Date.now() - started
    assert.ok(elapsed < TEST_BUDGETS.detailsBudgetMs + 600, `elapsed=${elapsed} باید داخل بودجهٔ کل + slack باشد`)
    const attempts = (res.meta?.detailsAttempts ?? []).filter((a) => a.attempt > 0)
    let cursor = 0
    for (const a of attempts) {
      assert.ok(a.remainingDeadlineMs <= TEST_BUDGETS.detailsTimeoutMs, 'remaining مهلت کل این عملیات است')
      cursor += a.durationMs
    }
    assert.ok(cursor <= TEST_BUDGETS.detailsTimeoutMs + 700, `مجموع مدت تلاش‌ها=${cursor}`)
  } finally {
    restore()
  }
})

test('12. نوارهای هویت/قیمت‌گذاری با بازیابی هم دست‌نخورده‌اند؛ نگاتیو خانواده هرگز قیمت نمی‌گیرد', async () => {
  const perla = goodCard('perla-res', 'دوربین مداربسته بولت هایک ویژن مدل DS-2CD1043G0-I لنز 2.8')
  const world = makeMcpHarness({ detailsScript: { [GOOD_A.prk]: [{ kind: 'timeout' }, { kind: 'ok' }] } })
  const restore = world.install()
  try {
    const res = await fetchViaTorobMcpServer(inquiryOpts(world, { prk: GOOD_A.prk }))
    assert.equal(res.torob.status, 'MATCH_CONFIRMED')
    const priced = runPricingPipeline(res, { productId: 9, ...TARGET, costPrice: 2000000, supplierQuotes: [], now: NOW, config: structuredClone(DEFAULT_PROFILE_CONFIG) })
    const confirmed = priced.offers.filter((o) => o.included)
    assert.ok(confirmed.every((o) => o.torobIdentity?.status === 'MATCH_CONFIRMED'), 'فقط آفرهای تأییدشده وارد قیمت می‌شوند')
    assert.equal(priced.finalPrice != null, true)
    // نگاتیو (مدل متفاوت) در همان جستجو هرگز تأیید نمی‌شود
    const evalModule = loadTsModule('src/lib/pricing/matcher.ts')
    const verdict = evalModule.evaluateTorobCandidate(TARGET, { prk: perla.prk, titleFa: perla.name_fa, priceToman: perla.price_toman })
    assert.notEqual(verdict.status, 'MATCH_CONFIRMED', 'مدل متفاوت هرگز تأیید خودکار نمی‌شود')
  } finally {
    restore()
  }
})

test('13. wrapper مستقیم: not-found گذرا نیست (بدون تلاش دوم) و مهلت صفر ⇒ DETAILS_NOT_ATTEMPTED', async () => {
  let calls = 0
  const result = await retrieveTorobDetailsWithRecovery({
    prk: 'prk-x',
    correlationId: 'dtl-test',
    timeoutMs: 1200,
    transports: [{ kind: 'torob_direct', run: async () => { calls++; return { issue: 'not_found', unavailable: true } } }],
  })
  assert.equal(calls, 1, 'not_found تکرار نمی‌شود')
  assert.equal(result.failure?.kind, 'WRONG_PRK')

  const notAttempted = await retrieveTorobDetailsWithRecovery({
    prk: 'prk-y',
    correlationId: 'dtl-test-2',
    timeoutMs: 200,
    transports: [{ kind: 'torob_direct', run: async () => { calls++; return { data: null } } }],
  })
  assert.equal(notAttempted.failure?.kind, 'DETAILS_NOT_ATTEMPTED')
  assert.equal(calls, 1, 'با مهلت ناکافی هیچ تلاشی آغاز نمی‌شود')
  assert.equal(TOROB_DETAILS_FAILURE_MESSAGES.DETAILS_GLOBAL_DEADLINE_EXCEEDED !== TOROB_DETAILS_FAILURE_MESSAGES.MCP_DETAILS_TIMEOUT, true)
})
