// ۴.۱.۲ (N3) — گاردهای مهاجرت و هم‌خوانی schema/SQL.
//  - برچسب‌گذاری 4.1.0 → 3.6.0 نباید خودکار باشد؛ فقط با SET pricing.relabel_410='on'.
//  - مهاجرت 0002 باید idempotent باشد و ستون‌های رتبه و ایندکس push را اضافه کند.
//  - ایندکس باید در schema.ts هم باشد تا drizzle-kit push آن را drift نبیند.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('0001: relabel خودکار نیست و پشت current_setting اپراتور است', () => {
  const sql = read('drizzle/0001_v411_incremental.sql')
  const guardIndex = sql.indexOf("current_setting('pricing.relabel_410', true) = 'on'")
  const relabelIndex = sql.indexOf('WHERE "engine_version" = \'4.1.0\'')
  assert.ok(guardIndex > -1, 'گارد current_setting باید وجود داشته باشد')
  assert.ok(relabelIndex > guardIndex, 'UPDATE مربوط به 4.1.0 باید بعد از گارد باشد')
  assert.match(
    sql.slice(guardIndex, relabelIndex),
    /current_setting\('pricing\.relabel_410', true\) = 'on' THEN\s+UPDATE/,
    'UPDATE باید داخل شاخه‌ی IF باشد',
  )
})

test('0002: ستون‌های رتبه و ایندکس push به‌صورت idempotent اضافه می‌شوند', () => {
  const sql = read('drizzle/0002_v412_audit_fixes.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "rank_including_suspect"/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "total_sellers_including_suspect"/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "decisions_push_recovery_idx"/)
  assert.match(sql, /current_setting\('pricing\.relabel_410', true\) = 'on'/)
})

test('schema.ts: ایندکس decisions_push_recovery_idx و ستون‌های رتبه تعریف شده‌اند', () => {
  const schema = read('src/db/schema.ts')
  assert.match(schema, /index\("decisions_push_recovery_idx"\)\.on\(t\.status, t\.pushStatus, t\.createdAt\)/)
  assert.match(schema, /rankIncludingSuspect: integer\("rank_including_suspect"\)/)
  assert.match(schema, /totalSellersIncludingSuspect: integer\("total_sellers_including_suspect"\)/)
})

test('journal: 0002 ثبت شده تا migrate/runner آن را ببیند', () => {
  const journal = JSON.parse(read('drizzle/meta/_journal.json'))
  assert.ok(journal.entries.some((e) => e.tag === '0002_v412_audit_fixes'))
})
