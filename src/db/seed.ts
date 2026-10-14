import "dotenv/config";
import { db, pool } from "./index";
import { products } from "./schema";

const sample = [
  { sku: "MOB-S23-256", name: "گوشی سامسونگ Galaxy S23 حافظه 256GB", category: "موبایل", costPrice: 38_500_000, sourceType: "mock" },
  { sku: "LAP-ASUS-X515", name: "لپ‌تاپ ایسوس VivoBook X515 Core i5", category: "لپ‌تاپ", costPrice: 27_200_000, sourceType: "mock" },
  { sku: "HP-QC35", name: "هدفون بی‌سیم Bose QC35 II", category: "صوتی", costPrice: 9_800_000, sourceType: "mock" },
  { sku: "TV-LG-55UQ", name: "تلویزیون ال‌جی 55 اینچ UQ8000", category: "تلویزیون", costPrice: 24_900_000, sourceType: "mock" },
  { sku: "WCH-MI-8", name: "ساعت هوشمند شیائومی Smart Band 8", category: "پوشیدنی", costPrice: 1_450_000, sourceType: "mock" },
  { sku: "PS5-SLIM", name: "کنسول PlayStation 5 Slim استاندارد", category: "گیمینگ", costPrice: 31_000_000, sourceType: "mock", autoApply: false },
];

async function main() {
  const existing = await db.select({ sku: products.sku }).from(products);
  const have = new Set(existing.map((e) => e.sku));
  const toInsert = sample.filter((s) => !have.has(s.sku));
  if (toInsert.length) await db.insert(products).values(toInsert);
  console.log(`seeded ${toInsert.length} products`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
