#!/usr/bin/env node
/**
 * ۴.۱.۲ — اجراکننده‌ی مهاجرت‌های SQL با ردیابی، dry-run و مسیر قابل‌تطبیق.
 *
 * چرا: دستور ممیزی «psql "$DATABASE_URL" -f drizzle/0001..." به مسیر/محیط خاص وابسته
 * بود و معلوم نمی‌شد کدام فایل قبلاً اجرا شده. این اسکریپت:
 *  - همه‌ی فایل‌های drizzle/NNNN_*.sql را به ترتیب اجرا می‌کند؛
 *  - در جدول schema_migrations (filename, checksum, applied_at) ثبت می‌کند؛
 *  - اگر فایل تغییر کرده باشد هشدار drift می‌دهد و دوباره اجرا نمی‌کند؛
 *  - تراکنش/قفل advisory دارد و dry-run پیش‌فرضِ --status است.
 *
 * استفاده:
 *   node scripts/migrate.cjs --dry-run
 *   node scripts/migrate.cjs
 *   node scripts/migrate.cjs --file 0002_v412_audit_fixes.sql
 *   node scripts/migrate.cjs --to 0001
 *   node scripts/migrate.cjs --baseline --to=0001   # فقط ثبت وضعیت فعلی تا ۰۰۰۱ (بدون اجرا)
 *                                                   # سپس ۰۰۰۲ را با --file اجرا کنید
 *   node scripts/migrate.cjs --json
 *
 * env: DATABASE_URL
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const MIGRATIONS_DIR = path.join(__dirname, '..', 'drizzle')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run') || argv.includes('--status')
const BASELINE = argv.includes('--baseline')
const AS_JSON = argv.includes('--json')
const fileArg = argv.find((a) => a.startsWith('--file='))
const toArg = argv.find((a) => a.startsWith('--to='))

const maskUrl = (value) => String(value || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) throw new Error(`پوشه‌ی مهاجرت پیدا نشد: ${MIGRATIONS_DIR}`)
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const full = path.join(MIGRATIONS_DIR, name)
      const sql = fs.readFileSync(full, 'utf8')
      return { name, full, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16) }
    })
}

function selectMigrations(all) {
  let selected = all
  if (fileArg) {
    const wanted = fileArg.split('=')[1]
    selected = all.filter((m) => m.name === wanted || m.name.startsWith(wanted))
    if (!selected.length) throw new Error(`فایل مهاجرت پیدا نشد: ${wanted}`)
  }
  if (toArg) {
    const to = toArg.split('=')[1]
    const index = all.findIndex((m) => m.name === to || m.name.startsWith(to))
    if (index < 0) throw new Error(`--to پیدا نشد: ${to}`)
    selected = selected.filter((m) => all.indexOf(m) <= index)
  }
  return selected
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL در .env یا محیط یافت نشد')
  const migrations = selectMigrations(listMigrations())

  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  const output = { database: maskUrl(url), dryRun: DRY, baseline: BASELINE, migrations: [] }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT NOW()
      )
    `)
    const { rows: applied } = await client.query('SELECT filename, checksum, applied_at FROM schema_migrations')
    const appliedMap = new Map(applied.map((r) => [r.filename, r]))

    await client.query("SELECT pg_advisory_lock(hashtext('pricing_schema_migrations'))")
    try {
      for (const m of migrations) {
        const prev = appliedMap.get(m.name)
        let action = 'apply'
        if (prev) action = prev.checksum === m.checksum ? 'already-applied' : 'drift'
        if (BASELINE) action = prev ? 'already-applied' : 'baseline-record'
        if (DRY && action === 'apply') action = 'would-apply'
        output.migrations.push({ name: m.name, checksum: m.checksum, action, appliedAt: prev?.applied_at || null })

        if (action === 'already-applied' || action === 'drift' || action === 'would-apply') continue
        if (action === 'baseline-record') {
          if (!DRY) {
            await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.name, m.checksum])
          }
          continue
        }
        if (DRY) continue

        // فایل‌های ما BEGIN/COMMIT دارند؛ اگر نداشتند خودمان تراکنش می‌سازیم.
        const hasTx = /\bBEGIN\b/i.test(m.sql) && /\bCOMMIT\b/i.test(m.sql)
        try {
          if (!hasTx) await client.query('BEGIN')
          await client.query(m.sql)
          if (!hasTx) {
            await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.name, m.checksum])
            await client.query('COMMIT')
          } else {
            await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [m.name, m.checksum])
          }
        } catch (error) {
          try { await client.query('ROLLBACK') } catch { /* ignore */ }
          throw new Error(`${m.name}: ${error.message}`)
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('pricing_schema_migrations'))")
    }

    if (AS_JSON) {
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log(`دیتابیس: ${output.database} | حالت: ${DRY ? 'DRY-RUN' : BASELINE ? 'BASELINE' : 'APPLY'}`)
      for (const m of output.migrations) console.log(`  ${m.name}  →  ${m.action}`)
      const pending = output.migrations.filter((m) => m.action === 'would-apply' || m.action === 'apply').length
      const drift = output.migrations.filter((m) => m.action === 'drift').length
      console.log(`جمع: ${pending} در انتظار اجرا${drift ? ` | ${drift} drift (فایل پس از اجرا تغییر کرده)` : ''}`)
    }
    if (output.migrations.some((m) => m.action === 'drift')) process.exitCode = 2
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  if (AS_JSON) console.log(JSON.stringify({ error: error.message }, null, 2))
  console.error('migrate failed:', error.message)
  process.exit(1)
})
