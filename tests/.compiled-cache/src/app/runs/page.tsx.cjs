"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = RunsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const listing_1 = require("../../lib/pricing/listing");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const runs_client_1 = require("@/components/runs-client");
const drizzle_orm_1 = require("drizzle-orm");
exports.dynamic = "force-dynamic";
function extractErrorSummary(status, pushError, steps) {
    if (pushError)
        return pushError;
    const errStep = steps.find((s) => s.level === "error");
    if (errStep?.message)
        return errStep.message;
    if (["rejected", "failed", "sync_failed"].includes(status)) {
        return (steps.find((s) => s.step === "supervisor")?.message ??
            steps.find((s) => s.step === "decision")?.message ??
            steps.find((s) => s.step === "source")?.message ??
            null);
    }
    if (status === "pending_review") {
        return (steps.find((s) => s.step === "decision")?.message ??
            steps.find((s) => s.step === "supervision_gate")?.message ??
            null);
    }
    return null;
}
async function RunsPage({ searchParams }) {
    const { run } = await searchParams;
    const runs = await index_ts_1.db.select().from(schema_1.priceRuns).orderBy((0, drizzle_orm_1.desc)(schema_1.priceRuns.startedAt)).limit(50);
    const selected = run ? Number(run) : runs[0]?.id ?? null;
    const [decisions, rawRunLogs] = await Promise.all([
        selected
            ? index_ts_1.db
                .select({ d: schema_1.priceDecisions, name: schema_1.products.name, sku: schema_1.products.sku })
                .from(schema_1.priceDecisions)
                .innerJoin(schema_1.products, (0, drizzle_orm_1.eq)(schema_1.products.id, schema_1.priceDecisions.productId))
                .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.runId, selected))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.priceDecisions.createdAt))
            : Promise.resolve([]),
        selected
            ? index_ts_1.db
                .select()
                .from(schema_1.activityLogs)
                .where((0, drizzle_orm_1.sql) `${schema_1.activityLogs.meta}->>'runId' = ${String(selected)}`)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.activityLogs.createdAt))
                .limit(30)
            : Promise.resolve([]),
    ]);
    const serializedRuns = runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        runMode: r.runMode,
        status: r.status,
        totalProducts: r.totalProducts,
        applied: r.applied,
        pendingReview: r.pendingReview,
        failed: r.failed,
        error: r.error ?? null,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    }));
    const serializedDecisions = decisions.map(({ d, name, sku }) => {
        const rawSteps = Array.isArray(d.steps) ? d.steps : [];
        const steps = rawSteps.map((s) => ({
            step: String(s.step ?? ""),
            title: String(s.title ?? s.step ?? ""),
            message: String(s.message ?? ""),
            level: s.level,
        }));
        const pushError = d.pushError ?? null;
        return {
            id: d.id,
            productId: d.productId,
            panels: (0, listing_1.decisionPanels)(rawSteps),
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
            strategy: d.strategy ?? null,
            confidence: d.confidence,
            status: d.status,
            pushStatus: d.pushStatus ?? null,
            pushError,
            errorSummary: extractErrorSummary(d.status, pushError, steps),
            steps,
        };
    });
    const serializedRunLogs = rawRunLogs.map((l) => ({
        id: l.id,
        scope: l.scope,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
    }));
    return ((0, jsx_runtime_1.jsx)(runs_client_1.RunsClient, { runs: serializedRuns, selectedRunId: selected, decisions: serializedDecisions, runLogs: serializedRunLogs }));
}
