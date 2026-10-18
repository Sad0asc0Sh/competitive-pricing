#!/usr/bin/env node
/**
 * پاک‌سازی کنترل‌شده‌ی «کارت اشتباه timed_sale» + محصولات بدون قیمت خرید.
 *
 * نسخه ۴.۱.۲ (بستن N2):
 *  - پیش‌فرض dry-run است؛ هیچ نوشتنی بدون --apply انجام نمی‌شود.
 *  - دامنه‌ی UPDATE دقیقاً همان دامنه‌ی SELECT است:
 *      A) current_campaign = 'timed_sale'            → فقط پاک‌سازی کمپین
 *      B) cost_price = 0 AND torob_prk IS NOT NULL   → فقط پاک‌سازی لینک/PRK ترب
 *    دیگر هیچ محصول سالمی با «cost_price <= 0» قربانی نمی‌شود.
 *  - تاریخچه‌ی تصمیم‌ها بازنویسی نمی‌شود: status تصمیم‌های applied هرگز rejected نمی‌شود.
 *  - همه‌ی نوشتن‌های PostgreSQL در یک تراکنش انجام می‌شوند.
 *  - مسیرها/رفتارها با env و فلگ‌ها قابل تطبیق‌اند (بدون hardcode سرور).
 *
 * نمونه:
 *   node scripts/fix-wrong-timed-sale.cjs                 # فقط گزارش (dry-run)
 *   node scripts/fix-wrong-timed-sale.cjs --json
 *   node scripts/fix-wrong-timed-sale.cjs --apply
 *   node scripts/fix-wrong-timed-sale.cjs --apply --mongo-mode=deactivate --no-cache
 *
 * env:
 *   PRICING_APP_DIR، EKGKALA_BACKEND_DIR، DATABASE_URL، MONGODB_URI
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const PRICING_APP_DIR = process.env.PRICING_APP_DIR || path.resolve(__dirname, '..')
const DEFAULT_BACKEND_CANDIDATES = [
  process.env.EKGKALA_BACKEND_DIR,
  path.resolve(PRICING_APP_DIR, '..', 'sgeooole', 'ekgkala-backend'),
  path.resolve(PRICING_APP_DIR, '..', 'ekgkala-project', 'ekgkala-backend'),
  '/home/debian/apps/ekgkala-project/ekgkala-backend',
].filter(Boolean)

const EKGKALA_BACKEND_DIR = DEFAULT_BACKEND_CANDIDATES.find((dir) =>
  fs.existsSync(path.join(dir, 'models', 'Sale.js')),
) || DEFAULT_BACKEND_CANDIDATES[0]

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const AS_JSON = argv.includes('--json')
const SKIP_CACHE = argv.includes('--no-cache')
const mongoModeArg = argv.find((a) => a.startsWith('--mongo-mode='))
const MONGO_MODE = mongoModeArg ? mongoModeArg.split('=')[1] : 'delete' // delete | deactivate | skip
if (!['delete', 'deactivate', 'skip'].includes(MONGO_MODE)) {
  console.error(`--mongo-mode نامعتبر است: ${MONGO_MODE} (delete | deactivate | skip)`)
  process.exit(1)
}

const TIMED_SALE_NAMES = [
  'فروش ویژه زمان‌دار (مالی و تخفیف + منتخب‌ها)',
  'فروش ویژه هوشمند',
  'فروش ویژه مشهد',
]

require('dotenv').config({ path: path.join(PRICING_APP_DIR, '.env') })
const beEnv = {}
require('dotenv').config({ path: path.join(EKGKALA_BACKEND_DIR, '.env'), processEnv: beEnv })

const {
  SELECT_PRODUCTS,
  SELECT_DECISIONS,
  SELECT_CAMPAIGNS,
  UPDATE_PRODUCT_CAMPAIGN,
  UPDATE_PRODUCT_NO_COST,
  UPDATE_DECISIONS,
  UPDATE_CAMPAIGN_SETTINGS,
} = require('./lib/timed-sale-cleanup.cjs')

const log = (...args) => {
  if (!AS_JSON) console.log(...args)
}
const emit = (payload) => {
  if (AS_JSON) console.log(JSON.stringify(payload, null, 2))
}

const maskUrl = (value) => String(value || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')

async function main() {
  const pgUrl = process.env.DATABASE_URL
  if (!pgUrl) throw new Error('DATABASE_URL در .env یا محیط یافت نشد')

  const { Pool } = require('pg')
  const pool = new Pool({ connectionString: pgUrl })
  const client = await pool.connect()
  const report = {
    dryRun: !APPLY,
    database: maskUrl(pgUrl),
    backendDir: EKGKALA_BACKEND_DIR,
    products: [],
    decisions: [],
    campaigns: [],
    actions: {},
    mongo: null,
    cache: [],
  }

  try {
    log('=== ۱) محصولات در دامنه‌ی پاک‌سازی (PostgreSQL) ===')
    const { rows: wrongProducts } = await client.query(SELECT_PRODUCTS)
    report.products = wrongProducts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      reason: p.current_campaign === 'timed_sale' ? 'timed_sale' : 'no-cost-prk',
      campaign: p.current_campaign,
      discountPct: p.current_discount_pct,
      price: p.current_final_price,
      torobPrk: p.torob_prk,
    }))
    log(`تعداد: ${wrongProducts.length}`)
    for (const p of report.products) {
      log(`  #${p.id} | ${p.sku || '-'} | ${p.name || '-'} | دلیل: ${p.reason} | کمپین: ${p.campaign} | تخفیف: ${p.discountPct}% | قیمت: ${p.price}`)
    }

    log('\n=== ۲) تصمیم‌های تاریخی timed_sale (فقط گزارش) ===')
    const { rows: wrongDecisions } = await client.query(SELECT_DECISIONS)
    report.decisions = wrongDecisions.map((d) => ({
      id: d.id,
      productId: d.product_id,
      sku: d.sku,
      name: d.name,
      status: d.status,
      campaign: d.campaign_type,
      discountPct: d.discount_pct,
    }))
    const appliedTimed = wrongDecisions.filter((d) => d.status === 'applied')
    log(`تعداد: ${wrongDecisions.length} (applied: ${appliedTimed.length} — تاریخچه دست‌نخورده می‌ماند)`)

    log('\n=== ۳) کمپین‌های پیش‌فرض timed_sale با تخفیف ≤ ۵٪ ===')
    const { rows: campaigns } = await client.query(SELECT_CAMPAIGNS)
    report.campaigns = campaigns
    log(`تعداد: ${campaigns.length}`)

    if (!APPLY) {
      report.actions = {
        message: 'DRY-RUN: هیچ تغییری در PostgreSQL/MongoDB/کش اعمال نشد. برای اجرا --apply بدهید.',
      }
      log('\n🛑 حالت DRY-RUN: هیچ تغییری اعمال نشد.')
      emit(report)
      return
    }

    log('\n=== ۴) اعمال تراکنشی پاک‌سازی (PostgreSQL) ===')
    await client.query('BEGIN')
    try {
      // A) فقط کارت‌های timed_sale؛ status محصول و لینک ترب دست‌نخورده می‌ماند.
      const campaignCleanup = await client.query(UPDATE_PRODUCT_CAMPAIGN)

      // B) فقط محصولات بدون قیمت خرید که PRK ترب دارند (همان شرط SELECT).
      const torobCleanup = await client.query(UPDATE_PRODUCT_NO_COST)

      // C) تصمیم‌های غیر-applied فقط برچسب کمپینشان پاک می‌شود. status هرگز بازنویسی نمی‌شود.
      const decisionsCleanup = await client.query(UPDATE_DECISIONS)

      const campaignSetting = await client.query(UPDATE_CAMPAIGN_SETTINGS)

      await client.query('COMMIT')
      report.actions = {
        productsCampaignCleaned: campaignCleanup.rowCount,
        productsNoCostTorobCleaned: torobCleanup.rowCount,
        decisionsCampaignCleared: decisionsCleanup.rowCount,
        campaignsDisabled: campaignSetting.rowCount,
      }
      log(`✅ محصولات timed_sale: ${campaignCleanup.rowCount}`)
      log(`✅ محصولات بدون قیمت خرید (PRK پاک شد): ${torobCleanup.rowCount}`)
      log(`✅ تصمیم‌های غیر-applied (برچسب کمپین پاک شد، status حفظ شد): ${decisionsCleanup.rowCount}`)
      log(`✅ کمپین پیش‌فرض timed_sale غیرفعال شد: ${campaignSetting.rowCount}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }

    // ۵) MongoDB: حذف/غیرفعال‌سازی فقط Saleهای autoManaged با نام‌های مشخص.
    const mongoUri = beEnv.MONGODB_URI || process.env.MONGODB_URI
    if (MONGO_MODE === 'skip') {
      log('\n⏭️ پاک‌سازی MongoDB به‌درخواست رد شد (--mongo-mode=skip).')
      report.mongo = { mode: 'skip' }
    } else if (mongoUri && fs.existsSync(path.join(EKGKALA_BACKEND_DIR, 'models', 'Sale.js'))) {
      log(`\n=== ۵) Saleهای خودکار مرتبط (MongoDB، حالت ${MONGO_MODE}) ===`)
      const mongoose = require(require.resolve('mongoose', { paths: [EKGKALA_BACKEND_DIR] }))
      await mongoose.connect(mongoUri)
      try {
        const Sale = require(path.join(EKGKALA_BACKEND_DIR, 'models', 'Sale'))
        const filter = { autoManaged: true, name: { $in: TIMED_SALE_NAMES } }
        const matched = await Sale.countDocuments(filter)
        let affected = 0
        if (MONGO_MODE === 'delete') {
          const res = await Sale.deleteMany(filter)
          affected = res.deletedCount || 0
        } else if (MONGO_MODE === 'deactivate') {
          const res = await Sale.updateMany(filter, { $set: { isActive: false } })
          affected = res.modifiedCount || 0
        } else {
          throw new Error(`--mongo-mode نامعتبر: ${MONGO_MODE}`)
        }
        report.mongo = { mode: MONGO_MODE, matched, affected }
        log(`✅ Saleهای autoManaged: ${matched} تطبیق، ${affected} تحت تأثیر (${MONGO_MODE}).`)
      } finally {
        await mongoose.disconnect()
      }
    } else {
      log('\n⏭️ MongoDB/MONGODB_URI یا مدل Sale در دسترس نیست؛ مرحله Mongo رد شد.')
      report.mongo = { mode: 'unavailable' }
    }

    // ۶) کش قفل ضدربات torob-mcp (اختیاری با --no-cache خاموش می‌شود).
    if (!SKIP_CACHE) {
      const cacheDirs = [
        path.join(os.homedir(), '.cache', 'torob-mcp'),
        '/tmp/torob-mcp-cache',
        path.join(EKGKALA_BACKEND_DIR, '.cache', 'torob-mcp'),
      ]
      for (const dir of [...new Set(cacheDirs)]) {
        if (!fs.existsSync(dir)) continue
        fs.rmSync(dir, { recursive: true, force: true })
        report.cache.push(dir)
        log(`✅ کش torob-mcp پاک شد: ${dir}`)
      }
    }

    report.actions.message = 'APPLY: پاک‌سازی انجام شد.'
    emit(report)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  if (AS_JSON) console.log(JSON.stringify({ error: err.message }, null, 2))
  console.error('Cleanup failed:', err.message)
  process.exit(1)
})
