import { db } from "@/db";
import { priceDecisions, priceRuns, products } from "@/db/schema";
import { RunsClient, type SerializedRunDecision, type SerializedRunItem } from "@/components/runs-client";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const runs = await db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(50);
  const selected = run ? Number(run) : runs[0]?.id ?? null;
  const decisions = selected
    ? await db
        .select({ d: priceDecisions, name: products.name, sku: products.sku })
        .from(priceDecisions)
        .innerJoin(products, eq(products.id, priceDecisions.productId))
        .where(eq(priceDecisions.runId, selected))
        .orderBy(desc(priceDecisions.createdAt))
    : [];

  const serializedRuns: SerializedRunItem[] = runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    totalProducts: r.totalProducts,
    applied: r.applied,
    pendingReview: r.pendingReview,
    failed: r.failed,
    startedAt: r.startedAt.toISOString(),
  }));

  const serializedDecisions: SerializedRunDecision[] = decisions.map(({ d, name, sku }) => ({
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

  return <RunsClient runs={serializedRuns} selectedRunId={selected} decisions={serializedDecisions} />;
}
