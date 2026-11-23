// ۴.۲.۱ — تفسیر پاسخ فروشگاه در سمت موتور: dry-run با کد خطا، و تأیید حلقه‌بسته «قیمت مؤثر» (F4)
const assert = require('node:assert/strict')
const test = require('node:test')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { interpretSgeoooleDryRun, interpretSgeoooleAck } = loadTsModule('src/lib/store/sgeooole-ack.ts')

const fa = (n) => n.toLocaleString('fa-IR')
// عبارتی که کوئری‌های K2 و K4 راهنمای پیاده‌سازی در push_error جست‌وجو می‌کنند (با کدنقطه‌های یونیکد صریح، تا فرم نوشتاری عوض نشود)
const EFFECTIVE_PHRASE = 'قیمت مؤثر' // «قیمت مؤثر»
const STORE_CODES = ['AMBIGUOUS_SKU', 'IDENTIFIER_MISMATCH', 'PRODUCT_NOT_FOUND', 'MISSING_PRODUCT_IDENTIFIER', 'VARIABLE_PRODUCT_UNSUPPORTED']

test('C1. dry-run با ok:false: کد خطای فروشگاه داخل [] در پیام می‌آید (K4 بتواند محصول متغیر را ببیند)', () => {
  for (const code of STORE_CODES) {
    const r = interpretSgeoooleDryRun({ ok: false, valid: false, dryRun: true, code, message: 'متن فارسی فروشگاه' })
    assert.equal(r.ok, false)
    assert.ok(r.message.includes(`[${code}]`), `کد ${code} باید در پیام باشد: ${r.message}`)
    assert.ok(r.message.includes('متن فارسی فروشگاه'))
  }
})

test('C2. dry-run با valid:false (بدون کد) پیام «نامعتبر» می‌دهد و [] نمی‌گذارد', () => {
  const r = interpretSgeoooleDryRun({ valid: false, reason: 'کف قطعی نقض شد' })
  assert.equal(r.ok, false)
  assert.ok(r.message.includes('نامعتبر دانست'))
  assert.ok(r.message.includes('کف قطعی نقض شد'))
  assert.ok(!r.message.includes('['))
  assert.ok(interpretSgeoooleDryRun({ ok: false }).message.includes('دلیل نامشخص'))
})

test('C3. dry-run پذیرفته یا بدون بدنه ⇒ null (push اصلی ادامه می‌یابد)', () => {
  assert.equal(interpretSgeoooleDryRun({ ok: true, valid: true }), null)
  assert.equal(interpretSgeoooleDryRun({}), null)
  assert.equal(interpretSgeoooleDryRun(null), null)
  assert.equal(interpretSgeoooleDryRun(undefined), null)
})

test('C4. ناهمخوانی قیمت مؤثر ⇒ شکست push با قیمت مؤثر، قیمت تصمیم و منبع در پیام', () => {
  const r = interpretSgeoooleAck(
    { data: { effectiveMismatch: true, effective: { currentPrice: 2_340_000, source: 'sale_campaign' } } },
    2_450_000,
  )
  assert.equal(r.ok, false)
  assert.ok(r.message.includes(EFFECTIVE_PHRASE))
  assert.ok(r.message.includes(fa(2_340_000)))
  assert.ok(r.message.includes(fa(2_450_000)))
  assert.ok(r.message.includes('sale_campaign'))
})

test('C5. ناهمخوانی بدون قیمت مؤثر قابل‌خواندن هم «اعمال موفق» نیست (محافظه‌کارانه)', () => {
  for (const effective of [null, undefined, {}, { currentPrice: null }, { currentPrice: Number.NaN }]) {
    const r = interpretSgeoooleAck({ data: { effectiveMismatch: true, effective } }, 1_000_000)
    assert.equal(r.ok, false)
    assert.ok(r.message.includes(EFFECTIVE_PHRASE))
    assert.ok(r.message.includes('نامشخص'))
    assert.ok(!r.message.includes(fa(0) + ' تومان'), 'قیمت صفرِ ساختگی نباید چاپ شود')
  }
})

test('C6. بدون ناهمخوانی، یا فروشگاه قدیمی بدون این فیلدها ⇒ null (رفتار قبلی)', () => {
  assert.equal(interpretSgeoooleAck({ data: { effectiveMismatch: false, effective: { currentPrice: 100 } } }, 100), null)
  assert.equal(interpretSgeoooleAck({ data: {} }, 100), null)
  assert.equal(interpretSgeoooleAck({}, 100), null)
  assert.equal(interpretSgeoooleAck(null, 100), null)
  assert.equal(interpretSgeoooleAck(undefined, 100), null)
})
