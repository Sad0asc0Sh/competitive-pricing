#!/usr/bin/env node
/**
 * §12 سند رخداد — اسکریپت اعتبارسنجی مجدد ایمن روابط ذخیره‌شدهٔ product_torob_links.
 *
 * کارکرد:
 *  - برای هر ردیف product_torob_links (با join کارت ترب کاتالوگ)، راستی‌آزمایی تازه با classifyStoredLink اجرا می‌شود
 *    و چهار وضعیت valid / review_required / incompatible / stale جدا می‌شود.
 *  - پیش‌فرض dry-run است؛ با --apply فقط UPDATE ستون‌های relation_status / last_reason / last_verified_at / updated_at
 *    انجام می‌شود — بدون DELETE و بدون DROP و بدون دست‌زدن تاریخچهٔ بی‌ربط.
 *  - ردیف‌های origin='admin_review' هرگز خودکار downgrade نمی‌شوند (گارد هم در کد و هم در شرط UPDATE).
 *  - products.torob_prk باند‌شده به PRK ناسازگار در خروجی «requiresManualUnbind» پرچم می‌شود.
 *    فلگ اختیاری --unbind-stale-prk فقط وقتی torob_link_confirmation خالی است (قفل مدیریتی) products.torob_prk را خالی می‌کند؛
 *    ردیف‌های دارای confirmation فقط پرچم می‌خورند.
 *
 * اجرای واقعی DB خارج از تست‌هاست؛ برای اجرا DATABASE_URL لازم است. خروجی JSON شمارشی است.
 *
 * Usage:
 *   node scripts/revalidate-torob-links.cjs --product-id 42
 *   node scripts/revalidate-torob-links.cjs --all --apply
 *   node scripts/revalidate-torob-links.cjs --all --apply --unbind-stale-prk
 */
'use strict'

const path = require('node:path')
const { loadTsModule } = require(path.join(__dirname, '..', 'tests', 'helpers', 'ts-loader.cjs'))

const { classifyStoredLink } = loadTsModule('src/lib/sources/torob-link-revalidation.ts')
const { pool } = loadTsModule('src/db/index.ts')

function parseArgs(argv) {
  const args = { productId: null, all: false, apply: false, unbindStalePrk: false, freshnessDays: null, limit: 500 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--product-id') args.productId = Number(argv[++i])
    else if (a === '--all') args.all = true
    else if (a === '--apply') args.apply = true
    else if (a === '--unbind-stale-prk') args.unbindStalePrk = true
    else if (a === '--freshness-days') args.freshnessDays = Number(argv[++i])
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--help' || a === '-h') args.help = true
    else {
      console.error(`فلگ ناشناخته: ${a}`)
      args.help = true
    }
  }
  if (args.help || (!args.all && !Number.isFinite(args.productId))) {
    console.error('Usage: node scripts/revalidate-torob-links.cjs [--product-id <id> | --all] [--apply] [--unbind-stale-prk] [--freshness-days <n>] [--limit <n>]')
    process.exit(args.help ? 0 : 1)
  }
  if (!Number.isFinite(args.productId) && !args.all) {
    console.error('--product-id باید عدد باشد')
    process.exit(1)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  const now = new Date()
  const classifyOpts = {}
  if (Number.isFinite(args.freshnessDays)) classifyOpts.freshnessDays = args.freshnessDays

  const where = args.all ? '' : 'WHERE l.product_id = $1'
  const params = args.all ? [] : [args.productId]
  const { rows } = await pool.query(
    `SELECT l.product_id, l.prk, l.relation_status, l.origin, l.last_verified_at,
            p.name AS product_name, p.sku AS product_sku, p.torob_prk AS product_torob_prk, p.torob_link_confirmation,
            c.title_fa, c.title_en, c.specs, c.last_price_toman, c.reported_seller_count
     FROM "product_torob_links" l
     JOIN "products" p ON p."id" = l."product_id"
     LEFT JOIN "torob_catalog_cards" c ON c."prk" = l."prk"
     ${where}
     ORDER BY l.product_id, l.prk
     LIMIT ${Number(args.limit) || 500}`,
    params,
  )

  const counts = { valid: 0, review_required: 0, incompatible: 0, stale: 0 }
  const results = []
  const requiresManualUnbind = []
  const unbindCandidates = []
  let appliedUpdates = 0
  let appliedUnbinds = 0

  for (const row of rows) {
    const card = row.title_fa || row.title_en
      ? {
          prk: row.prk,
          titleFa: row.title_fa ?? '',
          titleEn: row.title_en ?? null,
          specs: row.specs ?? [],
          priceToman: row.last_price_toman ?? null,
          sellerCount: row.reported_seller_count ?? null,
        }
      : null
    const isBoundProductPrk = row.product_torob_prk === row.prk
    // قفل مدیریتی فقط وقتی پر است که confirmation برای همین PRK ثبت شده باشد (الگوی torob.ts:318).
    const hasConfirmation = Boolean(
      row.torob_link_confirmation && row.torob_link_confirmation.prk === row.prk,
    )
    const re = classifyStoredLink({
      record: {
        prk: row.prk,
        relationStatus: row.relation_status,
        origin: row.origin,
        lastVerifiedAt: row.last_verified_at,
      },
      card,
      // هدف راستی‌آزمایی، هویت محصولِ سایت است (نه عنوان کارت).
      target: { productName: row.product_name ?? row.prk, sku: row.product_sku ?? null },
      now,
      isBoundProductPrk,
      ...classifyOpts,
    })
    counts[re.status]++
    const entry = {
      productId: row.product_id,
      prk: row.prk,
      previousRelationStatus: row.relation_status,
      status: re.status,
      suggestedRelationStatus: re.suggestedRelationStatus,
      reason: re.reason,
      adminProtected: row.origin === 'admin_review',
      requiresManualUnbind: re.requiresManualUnbind,
      ...(re.identityStatus ? { identityStatus: re.identityStatus } : {}),
      ...(re.matchScore != null ? { matchScore: re.matchScore } : {}),
    }
    results.push(entry)

    // مجرای سوم رابطهٔ ذخیره‌شده (products.torob_prk): فقط پرچم؛ آزادسازی مشروط.
    if (isBoundProductPrk && re.status === 'incompatible') {
      requiresManualUnbind.push({ productId: row.product_id, prk: row.prk, hasConfirmation })
      if (!hasConfirmation) unbindCandidates.push({ productId: row.product_id, prk: row.prk })
    }

    if (args.apply && re.suggestedRelationStatus !== row.relation_status) {
      // گارد دوبل: admin_review هرگز downgrade نمی‌شود؛ رد قبلی زنده نمی‌شود (پیشنهاد فقط هم‌وضعیت یا rejected).
      await pool.query(
        `UPDATE "product_torob_links"
         SET "relation_status" = $3,
             "last_reason" = $4,
             "last_verified_at" = $5,
             "updated_at" = $5
         WHERE "product_id" = $1 AND "prk" = $2
           AND NOT ("origin" = 'admin_review' AND "relation_status" <> 'rejected' AND $3 <> 'confirmed')`,
        [row.product_id, row.prk, re.suggestedRelationStatus, re.reason.slice(0, 400), now],
      )
      appliedUpdates++
    }
  }

  if (args.apply && args.unbindStalePrk && unbindCandidates.length) {
    for (const { productId } of unbindCandidates) {
      // فقط ستون torob_prk خالی می‌شود و فقط بدون قفل مدیریتی (torob_link_confirmation خالی)؛ هیچ ستون دیگری دست نمی‌خورد.
      await pool.query(
        `UPDATE "products" SET "torob_prk" = NULL WHERE "id" = $1 AND "torob_link_confirmation" IS NULL`,
        [productId],
      )
      appliedUnbinds++
    }
  }

  const summary = {
    ranAt: now.toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scope: args.all ? 'all' : `product_id=${args.productId}`,
    scanned: rows.length,
    counts,
    ...(args.apply ? { appliedUpdates, appliedUnbinds } : {}),
    requiresManualUnbind,
    ...(args.unbindStalePrk ? { unbindCandidates } : {}),
    results,
  }
  console.log(JSON.stringify(summary, null, 2))
  await pool.end()
}

main().catch((err) => {
  console.error(`اعتبارسنجی مجدد ناموفق بود: ${err?.message ?? err}`)
  process.exit(1)
})
