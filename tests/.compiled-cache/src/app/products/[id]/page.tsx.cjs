"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ProductDetailPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../../../db/index.ts");
const schema_1 = require("../../../db/schema");
const product_detail_client_1 = require("@/components/product-detail-client");
const drizzle_orm_1 = require("drizzle-orm");
const navigation_1 = require("next/navigation");
exports.dynamic = "force-dynamic";
/** فاصله روز از آخرین تغییر قیمت — محاسبه‌شده در سرور برای پایداری رندر کلاینت */
function daysAgo(date) {
    return Math.round((Date.now() - new Date(date).getTime()) / 86400000);
}
async function ProductDetailPage({ params }) {
    const { id } = await params;
    const [p] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, Number(id))).limit(1);
    if (!p)
        (0, navigation_1.notFound)();
    const decisions = await index_ts_1.db
        .select()
        .from(schema_1.priceDecisions)
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, p.id))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
        .limit(20);
    const latest = decisions[0];
    const offers = latest
        ? await index_ts_1.db
            .select()
            .from(schema_1.competitorOffers)
            .where((0, drizzle_orm_1.eq)(schema_1.competitorOffers.decisionId, latest.id))
            .orderBy(schema_1.competitorOffers.price)
        : [];
    const serializedProduct = {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        storeExternalId: p.storeExternalId,
        sourceType: p.sourceType,
        torobUrl: p.torobUrl,
        torobLinkConfirmation: p.torobLinkConfirmation,
        costPrice: p.costPrice,
        minMarginPct: p.minMarginPct,
        minProfitAmount: p.minProfitAmount,
        preferredCampaignType: p.preferredCampaignType,
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
    const serializedDecisions = decisions.map((d) => ({
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
    const serializedOffers = offers.map((o) => ({
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
        torobEvidence: o.torobEvidence,
        url: o.url && /^https?:\/\//i.test(o.url) ? o.url : null,
        lastChangedDaysAgo: o.lastChangedAt ? daysAgo(o.lastChangedAt) : null,
        weight: o.weight,
        included: o.included,
        excludeReason: o.excludeReason,
    }));
    return (0, jsx_runtime_1.jsx)(product_detail_client_1.ProductDetailClient, { product: serializedProduct, decisions: serializedDecisions, offers: serializedOffers });
}
