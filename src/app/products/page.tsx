import { db } from "@/db";
import { products } from "@/db/schema";
import { ProductsClient, type ProductListItem } from "@/components/products-client";
import { toIsoString } from "@/lib/format";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const rows = await db.select().from(products).orderBy(asc(products.id));

  const serialized: ProductListItem[] = rows.map((p, idx) => ({
    id: p.id,
    cardIndex: idx + 1,
    sku: p.sku,
    name: p.name,
    category: p.category,
    sourceType: p.sourceType,
    costPrice: p.costPrice,
    currentHardFloorPrice: p.currentHardFloorPrice,
    currentBasePrice: p.currentBasePrice,
    currentFinalPrice: p.currentFinalPrice,
    currentDiscountPct: p.currentDiscountPct,
    currentCampaign: p.currentCampaign,
    currentCampaignName: p.currentCampaignName,
    currentShowInFeatured: p.currentShowInFeatured,
    status: p.status,
    lastCheckedAt: p.lastCheckedAt ? toIsoString(p.lastCheckedAt) || null : null,
  }));

  return <ProductsClient products={serialized} />;
}
