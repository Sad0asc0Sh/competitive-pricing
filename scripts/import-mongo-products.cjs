const mongoose = require("mongoose");
const { Pool } = require("pg");
const path = require("path");

// مسیرها از متغیر محیطی خوانده می‌شوند تا اسکریپت به یک سرور/مسیر خاص قفل نباشد؛
// مقادیر پیش‌فرض همان مسیرهای فعلی سرور دبیان‌اند تا دیپلوهای موجود نشکنند:
//   PRICING_APP_DIR      پوشه همین سامانه قیمت‌گذاری (حاوی .env)
//   EKGKALA_BACKEND_DIR  پوشه ekgkala-backend فروشگاه (حاوی .env و models/)
const PRICING_APP_DIR = process.env.PRICING_APP_DIR || "/home/debian/apps/ai-driven-competitive-pricing-system";
const EKGKALA_BACKEND_DIR = process.env.EKGKALA_BACKEND_DIR || "/home/debian/apps/ekgkala-project/ekgkala-backend";

require("dotenv").config({ path: path.join(PRICING_APP_DIR, ".env") });

const beEnv = {};
require("dotenv").config({ path: path.join(EKGKALA_BACKEND_DIR, ".env"), processEnv: beEnv });

async function run() {
  const mongoUri = beEnv.MONGODB_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI not found");
  
  const pgUrl = process.env.DATABASE_URL;
  if (!pgUrl) throw new Error("DATABASE_URL not found");

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);

  const Product = require(path.join(EKGKALA_BACKEND_DIR, "models/Product"));
  const Category = require(path.join(EKGKALA_BACKEND_DIR, "models/Category"));

  console.log("Fetching active products from MongoDB...");
  const mongoProducts = await Product.find({ isActive: true })
    .populate("category", "name")
    .sort({ createdAt: -1 })
    .lean();

  console.log(`Found ${mongoProducts.length} active products in MongoDB.`);

  const pool = new Pool({ connectionString: pgUrl });
  const client = await pool.connect();

  let imported = 0;
  let skipped = 0;
  const seenSkus = new Set();

  try {
    for (const p of mongoProducts) {
      let rawSku = (p.sku && String(p.sku).trim()) || (p.productCode && String(p.productCode).trim()) || String(p._id);
      let sku = rawSku;
      let counter = 1;
      while (seenSkus.has(sku.toLowerCase())) {
        sku = `${rawSku}-${counter++}`;
      }
      seenSkus.add(sku.toLowerCase());

      const name = p.name ? String(p.name).trim() : `محصول ${sku}`;
      const category = (p.category && p.category.name) ? String(p.category.name).trim() : null;
      const storeExternalId = (p.productCode && String(p.productCode).trim()) || String(p._id);
      const costPrice = Math.max(0, Math.round(Number(p.costPrice) || 0));
      const basePrice = Math.max(0, Math.round(Number(p.price) || 0));
      const discount = Math.max(0, Number(p.discount) || 0);
      const finalPrice = discount > 0 ? Math.round(basePrice * (1 - discount / 100)) : basePrice;

      const query = `
        INSERT INTO products (
          sku, name, category, store_external_id, source_type,
          cost_price, current_base_price, current_final_price, current_discount_pct,
          preferred_campaign_type, show_in_featured, auto_apply, status,
          supplier_quotes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, NOW(), NOW()
        )
        ON CONFLICT (sku) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          store_external_id = EXCLUDED.store_external_id,
          current_base_price = EXCLUDED.current_base_price,
          current_final_price = EXCLUDED.current_final_price,
          current_discount_pct = EXCLUDED.current_discount_pct,
          updated_at = NOW()
        RETURNING id;
      `;

      const values = [
        sku,
        name,
        category,
        storeExternalId,
        "torob",
        costPrice,
        basePrice,
        finalPrice,
        discount,
        "auto",
        true,
        true,
        "active",
        JSON.stringify([]),
      ];

      await client.query(query, values);
      imported++;
    }

    console.log(`Successfully imported/updated ${imported} products into PostgreSQL.`);
  } finally {
    client.release();
    await pool.end();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
