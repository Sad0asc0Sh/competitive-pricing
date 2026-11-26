"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ProductsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const products_client_1 = require("@/components/products-client");
const drizzle_orm_1 = require("drizzle-orm");
exports.dynamic = "force-dynamic";
async function ProductsPage() {
    const rows = await index_ts_1.db.select().from(schema_1.products).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
    const serialized = rows.map((p, idx) => ({
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
        lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : null,
    }));
    return (0, jsx_runtime_1.jsx)(products_client_1.ProductsClient, { products: serialized });
}
