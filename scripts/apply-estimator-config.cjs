#!/usr/bin/env node
'use strict'
/**
 * اعمال امن بخش `estimator` روی پروفایل قیمت‌گذاری در PostgreSQL (۴.۲.۰)
 *
 *   # مدل اعتمادِ بازتنظیم‌شده با دادهٔ واقعی (خروجی eval/market/fit-confidence.cjs --data ... --write model.json)
 *   node scripts/apply-estimator-config.cjs --file model.json --default            # فقط نمایش تغییرات (dry-run)
 *   node scripts/apply-estimator-config.cjs --file model.json --default --apply    # اعمال (با بک‌آپ)
 *
 *   # پروفایل ریسک (conservative | balanced | aggressive؛ اعداد: docs/ESTIMATOR_V2.md §۷)
 *   node scripts/apply-estimator-config.cjs --preset conservative --profile-id 1 --apply
 *
 * ایمنی:
 *  - پیش‌فرض dry-run است؛ بدون --apply هیچ‌چیز نوشته نمی‌شود.
 *  - فقط زیرشاخهٔ config.estimator ادغام می‌شود؛ بقیهٔ پروفایل (کف سود، پله‌ها، ناظر، …) دست‌نخورده می‌ماند
 *    و پیش‌فرض‌ها در پروفایل «پین» نمی‌شوند (برخلاف POST /api/profiles که کل config را با پیش‌فرض‌ها ادغام می‌کند).
 *  - هر کلید با مقدار پیش‌فرضِ کد و بازهٔ منطقی سنجیده می‌شود؛ ترکیب‌های غیرممکن (لنگر نامحقق) رد می‌شوند.
 *  - پیش از نوشتن، نسخهٔ قبلی config در یک فایل JSON بک‌آپ گرفته می‌شود.
 *  - تغییر بعد از چرخهٔ بعدی قیمت‌گذاری اثر می‌کند (config در هر اجرا خوانده می‌شود).
 */
const fs = require('node:fs')
const path = require('node:path')
const lib = require('./lib/estimator-config.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const flag = (name) => process.argv.includes('--' + name)

async function main() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
  } catch (e) {
    if (!e || e.code !== 'MODULE_NOT_FOUND') throw e
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL تنظیم نشده است')

  const file = arg('file', null)
  const preset = arg('preset', null)
  if (!!file === !!preset) throw new Error('دقیقاً یکی از --file یا --preset را بدهید')
  const profileId = arg('profile-id', null)
  if (!!profileId === flag('default')) throw new Error('دقیقاً یکی از --profile-id یا --default را بدهید')

  let input
  if (preset) {
    if (!lib.PRESETS[preset]) throw new Error(`پروفایل ناشناخته: ${preset} (conservative | balanced | aggressive)`)
    input = { estimator: lib.PRESETS[preset] }
  } else {
    input = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const checked = lib.validateEstimatorPatch(input)
  if (!checked.ok) {
    console.error('وصلهٔ estimator نامعتبر است:\n - ' + checked.errors.join('\n - '))
    process.exit(2)
  }
  if (!Object.keys(checked.patch).length) {
    console.log('وصله خالی است؛ کاری برای انجام نیست.')
    return
  }

  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: url })
  try {
    const q = profileId
      ? await pool.query('SELECT id, name, is_default, config FROM pricing_profiles WHERE id = $1', [Number(profileId)])
      : await pool.query('SELECT id, name, is_default, config FROM pricing_profiles WHERE is_default = true ORDER BY id LIMIT 1')
    if (!q.rows.length) throw new Error('پروفایل پیدا نشد')
    const row = q.rows[0]
    const stored = row.config && typeof row.config === 'object' ? row.config : {}

    const eff = lib.effectiveEstimator(stored.estimator, checked.patch)
    const effOk = lib.validateEffective(eff)
    if (!effOk.ok) {
      console.error('ترکیب نهایی نامعتبر است:\n - ' + effOk.errors.join('\n - '))
      process.exit(2)
    }

    const rows = lib.diffEstimator(stored.estimator, checked.patch)
    console.log(`پروفایل #${row.id} «${row.name}»${row.is_default ? ' (پیش‌فرض)' : ''}`)
    for (const r of rows) {
      console.log(`  ${r.changed ? '≠' : '='} ${r.path}: ${JSON.stringify(r.before)} (${r.beforeFrom}) → ${JSON.stringify(r.after)}`)
    }
    if (!rows.some((r) => r.changed)) {
      console.log('هیچ تغییری لازم نیست.')
      return
    }
    if (!flag('apply')) {
      console.log('\ndry-run: چیزی نوشته نشد. برای اعمال، --apply را اضافه کنید.')
      return
    }

    const next = lib.mergeEstimatorPatch(stored, checked.patch)
    const dir = arg('backup-dir', process.cwd())
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(dir, `profile-${row.id}-config-backup-${stamp}.json`)
    fs.writeFileSync(backup, JSON.stringify({ id: row.id, name: row.name, config: stored }, null, 2))
    await pool.query('UPDATE pricing_profiles SET config = $1::jsonb, updated_at = now() WHERE id = $2', [JSON.stringify(next), row.id])
    await pool
      .query("INSERT INTO activity_logs (level, scope, message, meta) VALUES ('info', 'profile', $1, $2::jsonb)", [
        `estimator پروفایل #${row.id} با اسکریپت apply-estimator-config به‌روز شد (${rows.filter((r) => r.changed).length} تغییر)`,
        JSON.stringify({ profileId: row.id, changes: rows.filter((r) => r.changed).map((r) => ({ path: r.path, from: r.before, to: r.after })) }),
      ])
      .catch(() => {})
    console.log(`\nاعمال شد. بک‌آپ config قبلی: ${backup}`)
    console.log('اثر: از اجرای بعدی قیمت‌گذاری. بازگشت: همان فایل بک‌آپ را در pricing_profiles.config برگردانید.')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : e)
    process.exit(1)
  })
}
