#!/usr/bin/env node
/**
 * ۴.۱.۲ (N4) — آشتی «سیاست هزینه» در پروفایل‌های ذخیره‌شده.
 *
 * مشکل: پروفایل‌های ساخته‌شده توسط ۴.۱.۰ ممکن است costPolicy=replacement_floor را
 * صریح ذخیره کرده باشند، در حالی که neverBelowManualCost=true است. این دو متناقض‌اند:
 * با replacement_floor، فلگ neverBelowManualCost بی‌اثر است و قیمت می‌تواند زیر هزینه
 * انبار برود. نگاشت سازگاری mergeConfig فقط وقتی کار می‌کند که costPolicy غایب باشد.
 *
 * این اسکریپت پیش‌فرض dry-run است. با --apply فقط پروفایل‌های دارای تعارض/غایب را
 * اصلاح می‌کند و سیاست را صریح می‌نویسد.
 *
 * استفاده:
 *   node scripts/fix-cost-policy.cjs                       # گزارش
 *   node scripts/fix-cost-policy.cjs --apply               # اصلاح تعارض‌ها
 *   node scripts/fix-cost-policy.cjs --apply --policy=replacement_floor
 *   node scripts/fix-cost-policy.cjs --apply --policy=legacy_never_below_manual --all
 *
 * سیاست‌های مجاز:
 *   max_inventory_replacement | replacement_floor | legacy_never_below_manual
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const POLICIES = new Set(['max_inventory_replacement', 'replacement_floor', 'legacy_never_below_manual'])
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const ALL = argv.includes('--all')
const AS_JSON = argv.includes('--json')
const policyArg = argv.find((a) => a.startsWith('--policy='))
const EXPLICIT_POLICY = policyArg ? policyArg.split('=')[1] : null

if (EXPLICIT_POLICY && !POLICIES.has(EXPLICIT_POLICY)) {
  console.error(`--policy نامعتبر است: ${EXPLICIT_POLICY}`)
  process.exit(1)
}

const maskUrl = (value) => String(value || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL در .env یا محیط یافت نشد')
  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()

  try {
    const { rows } = await client.query(`
      SELECT id, name, is_default, config
      FROM pricing_profiles
      ORDER BY id ASC
    `)

    const report = []
    for (const row of rows) {
      const cfg = row.config || {}
      const sourcing = cfg.sourcing || {}
      const policy = sourcing.costPolicy ?? null
      const never = sourcing.neverBelowManualCost
      const conflict = policy === 'replacement_floor' && never === true
      const missing = policy == null
      // پیشنهاد: اگر neverBelowManualCost=true باشد، کف از بیشینه هزینه انبار و ریپلیس.
      // وگرنه replacement_floor. با --policy صریح، همان.
      const proposed =
        EXPLICIT_POLICY || (never === true ? 'max_inventory_replacement' : 'replacement_floor')
      const shouldFix = ALL ? policy !== proposed : conflict || missing

      report.push({
        id: row.id,
        name: row.name,
        isDefault: row.is_default,
        policy,
        neverBelowManualCost: never,
        conflict,
        missing,
        proposed,
        action: shouldFix ? (APPLY ? 'update' : 'would-update') : 'skip',
      })
    }

    if (AS_JSON) {
      console.log(JSON.stringify({ database: maskUrl(url), dryRun: !APPLY, profiles: report }, null, 2))
    } else {
      console.log(`دیتابیس: ${maskUrl(url)} | پروتکل: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
      for (const p of report) {
        console.log(
          `  #${p.id} ${p.isDefault ? '(default) ' : ''}${p.name || '-'} | policy=${p.policy ?? '∅'} | neverBelowManualCost=${p.neverBelowManualCost ?? '∅'} | conflict=${p.conflict} | ${p.action}${p.action.includes('update') ? ` → ${p.proposed}` : ''}`,
        )
      }
      const updates = report.filter((p) => p.action === 'would-update' || p.action === 'update')
      console.log(`جمع: ${updates.length} پروفایل نیازمند اصلاح${APPLY ? '' : ' (dry-run؛ --apply بدهید)'}`)
    }

    if (!APPLY) return

    await client.query('BEGIN')
    try {
      let changed = 0
      for (const p of report) {
        if (p.action !== 'update') continue
        const never = p.proposed === 'legacy_never_below_manual' || p.proposed === 'max_inventory_replacement'
        await client.query(
          `UPDATE pricing_profiles
           SET config = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     COALESCE(config, '{}'::jsonb),
                     '{sourcing}',
                     COALESCE(config->'sourcing', '{}'::jsonb),
                     true
                   ),
                   '{sourcing,costPolicy}',
                   to_jsonb($2::text),
                   true
                 ),
                 '{sourcing,neverBelowManualCost}',
                 to_jsonb($3::boolean),
                 true
               ),
               updated_at = NOW()
           WHERE id = $1`,
          [p.id, p.proposed, never],
        )
        changed += 1
      }
      await client.query('COMMIT')
      console.log(`✅ ${changed} پروفایل اصلاح شد.`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('fix-cost-policy failed:', error.message)
  process.exit(1)
})
