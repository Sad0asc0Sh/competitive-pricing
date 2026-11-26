"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = RunsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const runs_client_1 = require("@/components/runs-client");
const drizzle_orm_1 = require("drizzle-orm");
exports.dynamic = "force-dynamic";
async function RunsPage({ searchParams }) {
    const { run } = await searchParams;
    const runs = await index_ts_1.db.select().from(schema_1.priceRuns).orderBy((0, drizzle_orm_1.desc)(schema_1.priceRuns.startedAt)).limit(50);
    const selected = run ? Number(run) : runs[0]?.id ?? null;
    const decisions = selected
        ? await index_ts_1.db
            .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku })
            .from(schema_1.priceDecisions)
            .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.runId, selected))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
        : [];
    const serializedRuns = runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        status: r.status,
        totalProducts: r.totalProducts,
        applied: r.applied,
        pendingReview: r.pendingReview,
        failed: r.failed,
        startedAt: r.startedAt.toISOString(),
    }));
    const serializedDecisions = decisions.map(({ d, name, sku }) => ({
        id: d.id,
        productId: d.productId,
        name,
        sku,
        source: d.source,
        offersUsed: d.offersUsed,
        offersTotal: d.offersTotal,
        referencePrice: d.referencePrice,
        basePrice: d.basePrice,
        finalPrice: d.finalPrice,
        discountPct: d.discountPct,
        campaignType: d.campaignType,
        confidence: d.confidence,
        status: d.status,
    }));
    return (0, jsx_runtime_1.jsx)(runs_client_1.RunsClient, { runs: serializedRuns, selectedRunId: selected, decisions: serializedDecisions });
}
