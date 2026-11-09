"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const db_1 = require("@/db");
const schema_1 = require("../../../db/schema");
const sourcing_1 = require("../../../lib/pricing/sourcing");
const bootstrap_1 = require("../../../lib/services/bootstrap");
const registry_1 = require("../../../lib/sources/registry");
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET() {
    const rows = await db_1.db.select().from(schema_1.products).orderBy((0, drizzle_orm_1.desc)(schema_1.products.updatedAt));
    return server_1.NextResponse.json(rows);
}
async function POST(req) {
    const body = await req.json().catch(() => null);
    if (!body?.sku || !body?.name)
        return server_1.NextResponse.json({ error: "sku و name الزامی است" }, { status: 400 });
    if (body.sourceType != null && body.sourceType !== "" && !(0, registry_1.isAllowedSourceType)(String(body.sourceType))) {
        return server_1.NextResponse.json({ error: "منبع استعلام نامعتبر است؛ فقط «ترب» پشتیبانی می‌شود" }, { status: 400 });
    }
    try {
        const { config } = await (0, bootstrap_1.getProfileConfig)(body.profileId ? Number(body.profileId) : null);
        const supplierQuotes = Array.isArray(body.supplierQuotes)
            ? body.supplierQuotes
            : typeof body.colleagueListText === "string" && body.colleagueListText.trim()
                ? (0, sourcing_1.parseColleaguePriceListText)(body.colleagueListText, "auto")
                : [];
        const manualCost = Number(body.costPrice ?? 0) || 0;
        const minMarginPct = body.minMarginPct != null && body.minMarginPct !== "" ? Number(body.minMarginPct) : null;
        const minProfitAmount = body.minProfitAmount != null && body.minProfitAmount !== "" ? Number(body.minProfitAmount) : null;
        const supply = (0, sourcing_1.resolveSupplyCost)({
            supplierQuotes,
            manualCostPrice: manualCost,
            minMarginPctOverride: minMarginPct,
            minProfitAmountOverride: minProfitAmount,
            config,
        });
        const [row] = await db_1.db
            .insert(schema_1.products)
            .values({
            sku: String(body.sku).trim(),
            name: String(body.name).trim(),
            category: body.category ? String(body.category).trim() : null,
            storeExternalId: body.storeExternalId ? String(body.storeExternalId) : null,
            sourceType: body.sourceType ?? "torob",
            torobUrl: body.torobUrl || null,
            torobPrk: body.torobPrk || null,
            torobDetailsUrl: body.torobDetailsUrl || null,
            costPrice: supply.effectiveCostPrice > 0 ? supply.effectiveCostPrice : manualCost,
            supplierQuotes,
            selectedSupplierName: supply.selectedQuote?.supplierName ?? null,
            currentHardFloorPrice: supply.hardFloorPrice > 0 ? supply.hardFloorPrice : null,
            minMarginPct,
            minProfitAmount,
            preferredCampaignType: body.preferredCampaignType ? String(body.preferredCampaignType) : "auto",
            autoApply: body.autoApply !== false,
            profileId: body.profileId ? Number(body.profileId) : null,
        })
            .returning();
        return server_1.NextResponse.json(row, { status: 201 });
    }
    catch (e) {
        return server_1.NextResponse.json({ error: e instanceof Error ? e.message : "خطا" }, { status: 400 });
    }
}
