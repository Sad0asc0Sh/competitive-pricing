#!/usr/bin/env node
'use strict'
/**
 * خروجی گرفتن ردیف‌های برچسب‌دار برای بازتنظیم «اعتماد کالیبره» با دادهٔ واقعی (حالت سایه / ممیزی)
 *
 *   node scripts/export-calibration-data.cjs --out calibration-rows.json [--audit audit.csv] [--since 2026-10-01] [--limit 50000] [--no-review]
 *
 * سپس:
 *   node eval/market/fit-confidence.cjs --data calibration-rows.json --write model.json
 *
 * فقط خواندن از PostgreSQL (SELECT)؛ هیچ تغییری در دیتابیس نمی‌دهد و هیچ قیمت خرید/کفی را خارج نمی‌کند
 * (فقط احتمال‌ها/بولی‌ها، قیمت نهایی به‌صورت برچسب درست/نادرست). راهنما و پروتکل ممیزی: docs/EVALUATION.md
 */
const fs = require('node:fs')
const path = require('node:path')
const { buildRows, parseAuditCsv } = require('./lib/calibration-rows.cjs')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const flag = (name) => process.argv.includes('--' + name)

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL تنظیم نشده است')
  const out = arg('out', 'calibration-rows.json')
  const since = arg('since', null)
  const limit = Math.max(1, Math.min(200000, Number(arg('limit', 50000)) || 50000))

  let audit = new Map()
  const auditFile = arg('audit', null)
  if (auditFile) {
    const parsed = parseAuditCsv(fs.readFileSync(auditFile, 'utf8'))
    audit = parsed.audit
    if (parsed.problems.length) console.warn(`هشدار ممیزی (${parsed.problems.length} مورد): ${parsed.problems.slice(0, 5).join(' | ')}`)
    const wrongMarks = [...audit.values()].filter((v) => v === 'wrong').length
    console.log(`ممیزی: ${audit.size} سطر خوانده شد (${audit.size - wrongMarks} قیمت درست، ${wrongMarks} نشانهٔ wrong)`)
  }

  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: url })
  try {
    const params = []
    let where = `source IN ('torob','manual') AND steps IS NOT NULL`
    if (since) {
      params.push(since)
      where += ` AND created_at >= $${params.length}`
    }
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT id, status, final_price AS "finalPrice", confidence, steps, created_at AS "createdAt"
         FROM price_decisions WHERE ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    )
    const built = buildRows(rows.reverse(), { audit, useReview: !flag('no-review') })
    const pos = built.rows.filter((r) => r.label === 1).length
    const bySource = built.rows.reduce((a, r) => ((a[r.labelSource] = (a[r.labelSource] || 0) + 1), a), {})
    fs.writeFileSync(out, JSON.stringify({ meta: { exportedAt: new Date().toISOString(), since, decisionsRead: rows.length, skipped: built.skipped, labelSources: bySource }, rows: built.rows }, null, 2))
    console.log(`خوانده‌شده: ${rows.length} تصمیم | ردیف برچسب‌دار: ${built.rows.length} (درست=${pos}, نادرست=${built.rows.length - pos})`)
    console.log(`حذف‌شده: بدون ویژگی (تصمیم‌های قبل از ۴.۲.۰) = ${built.skipped.noFeatures} ، بدون برچسب = ${built.skipped.noLabel}`)
    console.log(`منبع برچسب: ${JSON.stringify(bySource)}  →  ${out}`)
    if (built.rows.length < 200) console.log('توجه: برای بازتنظیم معتبر دست‌کم ≈۲۰۰ ردیف (با ≥۳۰ درست و ≥۳۰ نادرست) لازم است.')
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
