import { db } from "@/db";
import { competitorOffers, priceDecisions, products } from "@/db/schema";
import {
  ProductDetailClient,
  type SerializedDecision,
  type SerializedOffer,
  type SerializedProductDetail,
} from "@/components/product-detail-client";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** فاصله روز از آخرین تغییر قیمت — محاسبه‌شده در سرور برای پایداری رندر کلاینت */
function daysAgo(date: Date | string): number {
  return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p] = await db.select().from(products).where(eq(products.id, Number(id))).limit(1);
  if (!p) notFound();

  const decisions = await db
    .select()
    .from(priceDecisions)
    .where(eq(priceDecisions.productId, p.id))
    .orderBy(desc(priceDecisions.createdAt))
    .limit(20);
  const latest = decisions[0];
  const offers = latest
    ? await db
        .select()
        .from(competitorOffers)
        .where(eq(competitorOffers.decisionId, latest.id))
        .orderBy(competitorOffers.price)
    : [];

  const serializedProduct: SerializedProductDetail = {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    storeExternalId: p.storeExternalId,
    sourceType: p.sourceType,
    torobUrl: p.torobUrl,
    costPrice: p.costPrice,
    minMarginPct: p.minMarginPct,
    minProfitAmount: p.minProfitAmount,
    preferredCampaignType: p.preferredCampaignType,
    autoApply: p.autoApply,
    showInFeatured: p.showInFeatured,
    status: p.status,
    selectedSupplierName: p.selectedSupplierName,
    currentHardFloorPrice: p.currentHardFloorPrice,
    currentBasePrice: p.currentBasePrice,
    currentFinalPrice: p.currentFinalPrice,
    currentDiscountPct: p.currentDiscountPct,
    currentCampaign: p.currentCampaign,
    currentCampaignName: p.currentCampaignName,
    currentBadgeTheme: p.currentBadgeTheme,
    currentShowInFeatured: p.currentShowInFeatured,
    supplierQuotes: p.supplierQuotes,
  };

  const serializedDecisions: SerializedDecision[] = decisions.map((d) => ({
    id: d.id,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    offersUsed: d.offersUsed,
    offersTotal: d.offersTotal,
    effectiveCostPrice: d.effectiveCostPrice,
    hardFloorPrice: d.hardFloorPrice,
    localLowestValid: d.localLowestValid,
    lowestValid: d.lowestValid,
    marketMedian: d.marketMedian,
    monitoredMarketCeiling: d.monitoredMarketCeiling,
    basePrice: d.basePrice,
    finalPrice: d.finalPrice,
    discountPct: d.discountPct,
    campaignType: d.campaignType,
    campaignName: d.campaignName,
    projectedLocalRank: d.projectedLocalRank,
    projectedNationalRank: d.projectedNationalRank,
    netProfitToman: d.netProfitToman,
    strategy: d.strategy,
    confidence: d.confidence,
    steps: d.steps,
    pushStatus: d.pushStatus,
    pushError: d.pushError,
  }));

  const serializedOffers: SerializedOffer[] = offers.map((o) => ({
    id: o.id,
    shopName: o.shopName,
    shopCity: o.shopCity,
    sellerType: o.sellerType,
    isAd: o.isAd,
    inStock: o.inStock,
    priceUnreliable: o.priceUnreliable,
    isLocalCity: o.isLocalCity,
    shopScore: o.shopScore,
    price: o.price,
    lastChangedDaysAgo: o.lastChangedAt ? daysAgo(o.lastChangedAt) : null,
    weight: o.weight,
    included: o.included,
    excludeReason: o.excludeReason,
  }));

  return <ProductDetailClient product={serializedProduct} decisions={serializedDecisions} offers={serializedOffers} />;
}
