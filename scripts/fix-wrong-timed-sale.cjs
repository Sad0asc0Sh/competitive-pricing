#!/usr/bin/env node
/**
 * اسکریپت تشخیص، گزارش‌گیری و پاک‌سازی کامل کارت اشتباه در دسته ۳ («فرصت‌های زمان‌دار مالی و تخفیف» / timed_sale)
 * + بازگردانی خودکار سند Sale و قیمت محصول در MongoDB فروشگاه (ekgkala-backend)
 */
const mongoose = require("mongoose");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PRICING_APP_DIR = process.env.PRICING_APP_DIR || "/home/debian/apps/ai-driven-competitive-pricing-system";
const EKGKALA_BACKEND_DIR = process.env.EKGKALA_BACKEND_DIR || "/home/debian/apps/ekgkala-project/ekgkala-backend";

require("dotenv").config({ path: path.join(PRICING_APP_DIR, ".env") });
const beEnv = {};
require("dotenv").config({ path: path.join(EKGKALA_BACKEND_DIR, ".env"), processEnv: beEnv });

async function main() {
  const pgUrl = process.env.DATABASE_URL;
  if (!pgUrl) throw new Error("DATABASE_URL در فایل .env یافت نشد");

  const pool = new Pool({ connectionString: pgUrl });
  const client = await pool.connect();

  try {
    console.log("=== ۱. بررسی کارت‌های قرارگرفته در دسته ۳ (timed_sale) در PostgreSQL ===");
    const { rows: wrongProducts } = await client.query(`
      SELECT id, sku, name, store_external_id, cost_price, torob_prk,
             current_base_price, current_final_price, current_discount_pct,
             current_campaign, current_campaign_name, last_decision_id
      FROM products
      WHERE current_campaign = 'timed_sale'
         OR (cost_price = 0 AND torob_prk IS NOT NULL)
      ORDER BY id ASC
    `);

    console.log(`تعداد کارت‌های نیازمند پاک‌سازی در PostgreSQL: ${wrongProducts.length}`);
    for (const p of wrongProducts) {
      console.log(
        `  -> کارت #${p.id} | SKU: ${p.sku} | نام: ${p.name} | کمپین فعلی: ${p.current_campaign} (${p.current_campaign_name}) | تخفیف: ${p.current_discount_pct}% | سقف: ${p.current_base_price} | کف: ${p.current_final_price} | PRK ترب: ${p.torob_prk}`,
      );
    }

    const { rows: wrongDecisions } = await client.query(`
      SELECT d.id, d.product_id, p.sku, p.name, d.status, d.campaign_type, d.campaign_name,
             d.base_price, d.final_price, d.discount_pct, d.effective_cost_price
      FROM price_decisions d
      JOIN products p ON p.id = d.product_id
      WHERE d.campaign_type = 'timed_sale' OR d.status = 'applied'
      ORDER BY d.id DESC
    `);

    console.log(`تعداد تصمیم‌های ثبت‌شده با timed_sale یا applied: ${wrongDecisions.length}`);
    for (const d of wrongDecisions) {
      console.log(
        `  -> تصمیم #${d.id} | محصول: ${d.name} (${d.sku}) | وضعیت: ${d.status} | کمپین: ${d.campaign_type} | تخفیف: ${d.discount_pct}% | سقف: ${d.base_price} -> کف: ${d.final_price}`,
      );
    }

    // ۲. پاک‌سازی در PostgreSQL
    await client.query(`
      UPDATE products
      SET current_campaign = 'none',
          current_campaign_name = NULL,
          current_discount_pct = 0,
          current_show_in_featured = false,
          torob_prk = CASE WHEN cost_price <= 0 THEN NULL ELSE torob_prk END,
          torob_details_url = CASE WHEN cost_price <= 0 THEN NULL ELSE torob_details_url END,
          auto_apply = CASE WHEN cost_price <= 0 THEN false ELSE auto_apply END,
          status = 'active',
          updated_at = NOW()
      WHERE current_campaign = 'timed_sale' OR cost_price <= 0
    `);

    await client.query(`
      UPDATE price_decisions
      SET campaign_type = 'none',
          campaign_name = NULL,
          show_in_featured = false,
          status = CASE WHEN status = 'applied' THEN 'rejected' ELSE status END
      WHERE campaign_type = 'timed_sale'
    `);

    // غیرفعال کردن کمپین پیش‌فرض timed_sale با تخفیف ۳٪ تا دوباره خودکار فعال نشود
    await client.query(`
      UPDATE discount_campaigns
      SET active = false,
          min_discount_pct = 10,
          card_range_from = 21,
          card_range_to = 50
      WHERE type = 'timed_sale' AND min_discount_pct <= 5
    `);

    console.log("✅ دیتابیس PostgreSQL پاک‌سازی شد (current_campaign='none' و auto_apply=false برای کالاهای بدون قیمت خرید).");

    // ۳. پاک‌سازی کمپین Sale در MongoDB فروشگاه (ekgkala-backend)
    const mongoUri = beEnv.MONGODB_URI || process.env.MONGODB_URI;
    if (mongoUri && fs.existsSync(path.join(EKGKALA_BACKEND_DIR, "models/Sale.js"))) {
      console.log("=== ۲. پاک‌سازی کمپین‌های Sale هوشمند در MongoDB فروشگاه ===");
      await mongoose.connect(mongoUri);
      const Sale = require(path.join(EKGKALA_BACKEND_DIR, "models/Sale"));
      const delRes = await Sale.deleteMany({
        name: { $in: ["فروش ویژه زمان‌دار (مالی و تخفیف + منتخب‌ها)", "فروش ویژه هوشمند", "فروش ویژه مشهد"] },
      });
      console.log(`✅ تعداد کمپین‌های Sale خودکار حذف‌شده از MongoDB: ${delRes.deletedCount}`);
      await mongoose.disconnect();
    }

    // ۴. حذف کش قفل ضدربات (Wall) در torob-mcp
    const cacheDirs = [
      path.join(os.homedir(), ".cache", "torob-mcp"),
      "/tmp/torob-mcp-cache",
      "/home/debian/.cache/torob-mcp",
    ];
    for (const dir of cacheDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`✅ کش قفل ضدربات torob-mcp پاک شد: ${dir}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
