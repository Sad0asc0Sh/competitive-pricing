'use strict'
// §12 سند رخداد — اعتبارسنجی مجدد ایمن روابط ذخیره‌شده: تفکیک valid/review_required/incompatible/stale
// با گاردهای admin_review و «رد هرگز زنده نمی‌شود» و «بدون حذف» + تست ایستای اسکریپت CLI به سبک migration-safety.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const { classifyStoredLink } = loadTsModule('src/lib/sources/torob-link-revalidation.ts')

const NOW = new Date('2026-11-27T14:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000)

const TARGET = { productName: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330', sku: 'RX-4330', anchorPriceToman: 400000 }
const CODED_CARD = { prk: 'coded-rx-1', titleFa: 'ریموت بلوتوثی بتا فرکانس 433 مدل RX-4330', specs: [] }
const PERLA_CARD = {
  prk: 'perla-1',
  titleFa: 'ریموت بلوتوثی ۴۳۳ رنگی طرح پرلا',
  specs: [{ key: 'طرح', value: 'پرلا' }, { key: 'فرکانس', value: '433 مگاهرتز' }, { key: 'نوع ریموت', value: 'بلوتوثی' }],
}

function classify(overrides = {}) {
  return classifyStoredLink({
    record: { prk: 'coded-rx-1', relationStatus: 'confirmed', origin: 'auto_discovery', lastVerifiedAt: NOW },
    card: CODED_CARD,
    target: TARGET,
    now: NOW,
    ...overrides,
  })
}

test('R1. valid — fresh full re-confirmation keeps the stored status and only refreshes evidence', () => {
  const re = classify()
  assert.equal(re.identityStatus, 'MATCH_CONFIRMED', 'the coded card fully re-confirms against the coded target')
  assert.equal(re.status, 'valid')
  assert.equal(re.suggestedRelationStatus, 'confirmed', 'valid never silently changes the stored relation')
  assert.equal(re.requiresManualUnbind, false)
})

test('R2. review_required — a stored confirmation that no longer re-confirms is downgraded (not a permanent search hint)', () => {
  // کالای بی‌کد رخداد: پرلا در راستی‌آزمایی تازه تأیید نمی‌شود (ابهام مارک‌دار) — تأیید تاریخی downgrade می‌شود.
  const re = classifyStoredLink({
    record: { prk: 'perla-1', relationStatus: 'confirmed', origin: 'auto_discovery', lastVerifiedAt: NOW },
    card: PERLA_CARD,
    target: { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 },
    now: NOW,
  })
  assert.equal(re.status, 'review_required')
  assert.equal(re.suggestedRelationStatus, 'review_required', 'incorrect historical confirmation is downgraded to review_required')
  assert.equal(re.identityStatus !== 'MATCH_CONFIRMED', true)
})

test('R3. incompatible — proven hard contradiction maps to rejected (existing enum) and flags the bound product PRK', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 315 مدل RZ-100', sku: 'RZ-100', anchorPriceToman: 360000 }
  const wrongCard = { prk: 'wrong-433', titleFa: 'ریموت بلوتوثی رنگی 433 مدل RZ-100', specs: [] }
  const re = classifyStoredLink({
    record: { prk: 'wrong-433', relationStatus: 'confirmed', origin: 'auto_discovery', lastVerifiedAt: NOW },
    card: wrongCard,
    target,
    now: NOW,
    isBoundProductPrk: true,
  })
  assert.equal(re.status, 'incompatible')
  assert.equal(re.suggestedRelationStatus, 'rejected', 'incompatible maps to the existing rejected relation_status')
  assert.equal(re.requiresManualUnbind, true, 'products.torob_prk bound to an incompatible PRK is flagged for manual unbind')
})

test('R4. admin_review rows are never auto-downgraded — they surface as review_required for a human decision', () => {
  const re = classifyStoredLink({
    record: { prk: 'perla-1', relationStatus: 'confirmed', origin: 'admin_review', lastVerifiedAt: NOW },
    card: PERLA_CARD,
    target: { productName: 'ریموت بلوتوثی رنگی فرکانس 433 لوکس', anchorPriceToman: 360000 },
    now: NOW,
  })
  assert.equal(re.status, 'review_required')
  assert.equal(re.suggestedRelationStatus, 'confirmed', 'admin_review rows are never auto-downgraded')
  assert.equal(re.requiresManualUnbind, false, 'even a bound admin-confirmed PRK is never auto-unbound')
})

test('R5. rejected rows are never revived automatically', () => {
  const re = classify({ record: { prk: 'coded-rx-1', relationStatus: 'rejected', origin: 'auto_discovery', lastVerifiedAt: NOW } })
  assert.equal(re.suggestedRelationStatus, 'rejected', 'fresh positive evidence never auto-revives a rejected link')
  assert.equal(re.status, 'review_required', 'revival needs a human decision')
})

test('R6. stale — evidence older than the freshness window keeps its status and only refreshes the audit trail', () => {
  const re = classify({ record: { prk: 'coded-rx-1', relationStatus: 'confirmed', origin: 'auto_discovery', lastVerifiedAt: daysAgo(45) } })
  assert.equal(re.status, 'stale')
  assert.equal(re.suggestedRelationStatus, 'confirmed', 'stale keeps the stored status (only freshness/audit updates)')
  const missingTimestamp = classify({ record: { prk: 'coded-rx-1', relationStatus: 'confirmed', origin: 'auto_discovery', lastVerifiedAt: null } })
  assert.equal(missingTimestamp.status, 'stale')
})

test('R7. missing card — no invented verdicts; the link is marked stale, not invalid', () => {
  const re = classify({ card: null })
  assert.equal(re.status, 'stale')
  assert.equal(re.suggestedRelationStatus, 'confirmed')
})

test('R8. incompatible wins over stale (safety first) and incompatible is reported even for self_only rows', () => {
  const target = { productName: 'ریموت بلوتوثی رنگی فرکانس 315 مدل RZ-100', sku: 'RZ-100', anchorPriceToman: 360000 }
  const re = classifyStoredLink({
    record: { prk: 'wrong-433', relationStatus: 'self_only', origin: 'auto_discovery', lastVerifiedAt: daysAgo(90) },
    card: { prk: 'wrong-433', titleFa: 'ریموت بلوتوثی رنگی 433 مدل RZ-100', specs: [] },
    target,
    now: NOW,
  })
  assert.equal(re.status, 'incompatible')
  assert.equal(re.suggestedRelationStatus, 'rejected')
})

// ─── تست ایستای اسکریپت CLI (سبک tests/migration-safety.test.cjs) ───

test('R9. revalidate-torob-links.cjs is UPDATE-only, guarded, and never deletes history', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'revalidate-torob-links.cjs'), 'utf8')
  // فقط UPDATE — بدون DELETE/DROP/TRUNCATE
  assert.doesNotMatch(script, /DELETE\s+FROM/i, 'script must never delete rows')
  assert.doesNotMatch(script, /DROP\s+(?:TABLE|INDEX|COLUMN)/i, 'script must never drop objects')
  assert.doesNotMatch(script, /TRUNCATE/i, 'script must never truncate tables')
  assert.match(script, /UPDATE "product_torob_links"/, 'links are only updated in place')
  // گارد admin_review: ردیف مدیر هرگز خودکار downgrade نمی‌شود (شرط داخل UPDATE)
  assert.match(script, /NOT \("origin" = 'admin_review'/, 'UPDATE carries the admin_review guard')
  // گارد قفل مدیریتی برای --unbind-stale-prk: فقط بدون torob_link_confirmation
  assert.match(script, /"torob_link_confirmation" IS NULL/, 'unbind only applies without an admin confirmation lock')
  // فقط ستون‌های مجاز در UPDATE محصولات
  assert.match(script, /SET "torob_prk" = NULL/, 'unbind clears only products.torob_prk')
  // پیش‌فرض dry-run
  assert.match(script, /mode: args\.apply \? 'apply' : 'dry-run'/, 'dry-run is the default mode')
  // پرچم requiresManualUnbind در گزارش
  assert.match(script, /requiresManualUnbind/, 'the report includes requiresManualUnbind flags')
  // مجرای سوم در classifyStoredLink هم پرچم می‌خورد
  const reval = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'sources', 'torob-link-revalidation.ts'), 'utf8')
  assert.match(reval, /requiresManualUnbind/, 'classifyStoredLink reports manual-unbind requirements')
  assert.doesNotMatch(reval, /DELETE\s+FROM/i)
})

test('R10. revalidation script is registered as an npm script and the new tests are in the test suite', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['revalidate:torob-links'], 'node scripts/revalidate-torob-links.cjs')
  assert.ok(pkg.scripts.test.includes('tests/torob-seller-family-gate.test.cjs'), 'family-gate tests are wired into npm test')
  assert.ok(pkg.scripts.test.includes('tests/torob-link-revalidation.test.cjs'), 'revalidation tests are wired into npm test')
  assert.ok(pkg.scripts.test.includes('tests/torob-seller-title-discovery.test.cjs'), 'seller-title incident tests stay wired into npm test')
})
