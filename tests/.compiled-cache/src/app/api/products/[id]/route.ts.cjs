"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.PATCH = PATCH;
exports.DELETE = DELETE;
const index_ts_1 = require("../../../../db/index.ts");
const schema_1 = require("../../../../db/schema");
const auth_1 = require("../../../../lib/auth");
const sourcing_1 = require("../../../../lib/pricing/sourcing");
const bootstrap_1 = require("../../../../lib/services/bootstrap");
const registry_1 = require("../../../../lib/sources/registry");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(req, { params }) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const { id } = await params;
    const [row] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, Number(id))).limit(1);
    if (!row)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    return server_1.NextResponse.json(row);
}
async function PATCH(req, { params }) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const { id } = await params;
    const body = (await req.json().catch(() => ({})));
    const [existing] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, Number(id))).limit(1);
    if (!existing)
        return server_1.NextResponse.json({ error: "یافت نشد" }, { status: 404 });
    const allowed = [
        "sku",
        "name",
        "category",
        "storeExternalId",
        "sourceType",
        "torobUrl",
        "torobPrk",
        "torobDetailsUrl",
        "costPrice",
        "supplierQuotes",
        "minMarginPct",
        "minProfitAmount",
        "preferredCampaignType",
        "showInFeatured",
        "profileId",
        "status",
    ];
    if ("sourceType" in body && !(0, registry_1.isAllowedSourceType)(String(body.sourceType))) {
        return server_1.NextResponse.json({ error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود" }, { status: 400 });
    }
    const patch = {};
    for (const k of allowed)
        if (k in body)
            patch[k] = body[k];
    if (typeof body.colleagueListText === "string") {
        patch.supplierQuotes = (0, sourcing_1.parseColleaguePriceListText)(body.colleagueListText, "auto");
    }
    if ("costPrice" in patch)
        patch.costPrice = Number(patch.costPrice) || 0;
    if ("minMarginPct" in patch) {
        patch.minMarginPct =
            patch.minMarginPct === "" || patch.minMarginPct == null ? null : Number(patch.minMarginPct);
    }
    if ("minProfitAmount" in patch) {
        patch.minProfitAmount =
            patch.minProfitAmount === "" || patch.minProfitAmount == null ? null : Number(patch.minProfitAmount);
    }
    if ("profileId" in patch)
        patch.profileId = patch.profileId ? Number(patch.profileId) : null;
    if ("showInFeatured" in patch)
        patch.showInFeatured = Boolean(patch.showInFeatured);
    const { config } = await (0, bootstrap_1.getProfileConfig)(patch.profileId ?? existing.profileId);
    const supplierQuotes = patch.supplierQuotes ?? existing.supplierQuotes ?? [];
    const manualCost = patch.costPrice ?? existing.costPrice;
    const minMarginPct = patch.minMarginPct ?? existing.minMarginPct;
    const minProfitAmount = patch.minProfitAmount ?? existing.minProfitAmount;
    const supply = (0, sourcing_1.resolveSupplyCost)({
        supplierQuotes,
        manualCostPrice: manualCost,
        minMarginPctOverride: minMarginPct,
        minProfitAmountOverride: minProfitAmount,
        config,
    });
    if (supply.lowestQuoteCost != null && supply.lowestQuoteCost > 0) {
        patch.replacementCost = Math.round(supply.lowestQuoteCost);
        patch.replacementCostAt = new Date();
    }
    if (supply.effectiveCostPrice > 0) {
        // costPrice (هزینه موجودی انبار) نباید با سربار ۰.۵٪ بازنویسی و در هر ذخیره باد شود؛ فقط همکار منتخب و کف سود آپدیت می‌شوند
        patch.selectedSupplierName = supply.selectedQuote?.supplierName ?? null;
        patch.currentHardFloorPrice = supply.hardFloorPrice;
    }
    else if ("costPrice" in patch) {
        patch.selectedSupplierName = null;
        patch.currentHardFloorPrice = null;
    }
    // نظارت انسانی قطعی: اعمال خودکار در سطح محصول همیشه خاموش می‌ماند
    patch.autoApply = false;
    patch.updatedAt = new Date();
    try {
        const [row] = await index_ts_1.db.update(schema_1.products).set(patch).where((0, drizzle_orm_1.eq)(schema_1.products.id, Number(id))).returning();
        return server_1.NextResponse.json(row);
    }
    catch (e) {
        return server_1.NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
    }
}
async function DELETE(req, { params }) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const { id } = await params;
    await index_ts_1.db.delete(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, Number(id)));
    return server_1.NextResponse.json({ ok: true });
}
