// ۴.۱.۲ (N2) — گارد رگرسیون برای اسکریپت پاک‌سازی timed_sale.
// ممیزی نشان داد UPDATE قبلی با شرط «cost_price <= 0» دامنه‌ی SELECT را می‌شکست و
// status تصمیم‌های applied را به rejected بازنویسی می‌کرد. این تست تضمین می‌کند
// دامنه‌ها دوباره باز نشوند.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const sql = require('../scripts/lib/timed-sale-cleanup.cjs')

test('SELECT محصولات: فقط timed_sale یا exact no-cost-prk — نه cost_price <= 0', () => {
  assert.match(sql.SELECT_PRODUCTS, /current_campaign = 'timed_sale'/)
  assert.match(sql.SELECT_PRODUCTS, /cost_price = 0 AND torob_prk IS NOT NULL/)
  assert.doesNotMatch(sql.SELECT_PRODUCTS, /cost_price\s*<=\s*0/)
})

test('UPDATE محصولات timed_sale فقط همان دامنه را می‌گیرد و لینک ترب را پاک نمی‌کند', () => {
  assert.match(sql.UPDATE_PRODUCT_CAMPAIGN, /WHERE current_campaign = 'timed_sale'/)
  assert.doesNotMatch(sql.UPDATE_PRODUCT_CAMPAIGN, /torob_prk/)
  assert.doesNotMatch(sql.UPDATE_PRODUCT_CAMPAIGN, /cost_price/)
})

test('UPDATE پاک‌سازی ترب دقیقاً همان شرط SELECT است (بدون دامنه‌ی گشادتر)', () => {
  assert.match(sql.UPDATE_PRODUCT_NO_COST, /WHERE cost_price = 0 AND torob_prk IS NOT NULL/)
  assert.doesNotMatch(sql.UPDATE_PRODUCT_NO_COST, /current_campaign\s*=\s*'timed_sale'/)
  assert.doesNotMatch(sql.UPDATE_PRODUCT_NO_COST, /cost_price\s*<=/)
})

test('تاریخچه‌ی تصمیم‌ها: status هرگز در UPDATE بازنویسی نمی‌شود', () => {
  assert.doesNotMatch(sql.UPDATE_DECISIONS, /\bstatus\s*=/i, 'هیچ انتساب status نباید باشد')
  assert.doesNotMatch(sql.UPDATE_DECISIONS, /rejected/i)
  assert.match(sql.UPDATE_DECISIONS, /status <> 'applied'/, 'appliedها باید کنار گذاشته شوند')
})

test('اسکریپت پیش‌فرض dry-run است و --apply صریح می‌خواهد', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fix-wrong-timed-sale.cjs'), 'utf8')
  assert.match(source, /const APPLY = argv\.includes\('--apply'\)/)
  assert.match(source, /if \(!APPLY\)/)
  assert.match(source, /DRY-RUN/)
})
