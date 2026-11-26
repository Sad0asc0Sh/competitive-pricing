"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = ReviewPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const review_client_1 = require("@/components/review-client");
const drizzle_orm_1 = require("drizzle-orm");
exports.dynamic = "force-dynamic";
async function ReviewPage() {
    const [rows, rejectedRows] = await Promise.all([
        index_ts_1.db
            .select({
            d: schema_1.priceDecisions,
            name: schema_1.products.name,
            sku: schema_1.products.sku,
            cost: schema_1.products.costPrice,
            hardFloor: schema_1.products.currentHardFloorPrice,
            current: schema_1.products.currentFinalPrice,
        })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.inArray)(schema_1.priceDecisions.status, ["pending_review", "sync_failed", "pending_sync"]))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt)),
        index_ts_1.db
            .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "rejected"))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
            .limit(20),
    ]);
    const pendingItems = rows.map(({ d, name, sku, cost, hardFloor, current }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
        const supMsg = steps.find((s) => s.step === "supervisor")?.message ?? null;
        const aiMsg = steps.find((s) => s.step === "ai_review")?.message ?? null;
        const positionStep = steps.find((s) => s.step === "position");
        const rankIncludingSuspect = d.rankIncludingSuspect ?? (Number(positionStep?.data?.rankIncludingSuspect) || null);
        const totalIncludingSuspect = d.totalSellersIncludingSuspect || Number(positionStep?.data?.totalSellersIncludingSuspect) || 0;
        const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, cost ?? 0);
        const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, hardFloor ?? 0, effectiveCost);
        const finalPrice = d.finalPrice ?? 0;
        const isBelowFloor = finalPrice > 0 &&
            ((effectiveCost > 0 && finalPrice <= effectiveCost) ||
                (effectiveFloor > 0 && finalPrice < effectiveFloor));
        const syncFailed = d.status === "sync_failed" || d.status === "pending_sync" || d.pushStatus === "failed";
        return {
            id: d.id,
            productId: d.productId,
            name,
            sku,
            status: d.status,
            createdAt: d.createdAt.toISOString(),
            cost,
            current,
            referencePrice: d.referencePrice,
            basePrice: d.basePrice,
            finalPrice: d.finalPrice,
            discountPct: d.discountPct,
            campaignType: d.campaignType,
            projectedNationalRank: d.projectedNationalRank,
            rankIncludingSuspect,
            totalIncludingSuspect,
            marketConflict: d.marketConflict,
            isBelowFloor,
            syncFailed,
            reasons,
            supMsg,
            aiMsg,
        };
    });
    const rejectedItems = rejectedRows.map(({ d, name, sku }) => {
        const steps = Array.isArray(d.steps) ? d.steps : [];
        const supMsg = steps.find((s) => s.step === "supervisor")?.message ?? "رد توسط ناظر SystemOne";
        return {
            id: d.id,
            productId: d.productId,
            name,
            sku,
            createdAt: d.createdAt.toISOString(),
            supMsg,
        };
    });
    return (0, jsx_runtime_1.jsx)(review_client_1.ReviewClient, { pendingItems: pendingItems, rejectedItems: rejectedItems });
}
