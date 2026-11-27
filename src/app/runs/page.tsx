import type { PanelCompetitiveEvidence, TorobInquiryReport } from "@/lib/pricing/types";
import { decisionPanels } from "@/lib/pricing/listing";
import { parsePositiveInt, toIsoString } from "@/lib/format";
import { db } from "@/db";
import { activityLogs, priceDecisions, priceRuns, products } from "@/db/schema";
import {
  RunsClient,
  type SerializedRunDecision,
  type SerializedRunItem,
  type SerializedRunLog,
} from "@/components/runs-client";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function extractErrorSummary(
  status: string,
  pushError: string | null,
  steps: Array<{ step: string; title: string; message: string; level?: string }>,
): string | null {
  if (pushError) return pushError;
  const errStep = steps.find((s) => s.level === "error");
  if (errStep?.message) return errStep.message;
  if (["rejected", "failed", "sync_failed"].includes(status)) {
    return (
      steps.find((s) => s.step === "supervisor")?.message ??
      steps.find((s) => s.step === "decision")?.message ??
      steps.find((s) => s.step === "source")?.message ??
      null
    );
  }
  if (status === "pending_review") {
    return (
      steps.find((s) => s.step === "decision")?.message ??
      steps.find((s) => s.step === "supervision_gate")?.message ??
      null
    );
  }
  return null;
}

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const runs = await db.select().from(priceRuns).orderBy(desc(priceRuns.startedAt)).limit(50);
  const selected = (run ? parsePositiveInt(run) : null) ?? runs[0]?.id ?? null;

  const [decisions, rawRunLogs] = await Promise.all([
    selected
      ? db
          .select({ d: priceDecisions, name: products.name, sku: products.sku })
          .from(priceDecisions)
          .innerJoin(products, eq(products.id, priceDecisions.productId))
          .where(eq(priceDecisions.runId, selected))
          .orderBy(desc(priceDecisions.createdAt))
      : Promise.resolve([]),
    selected
      ? db
          .select()
          .from(activityLogs)
          .where(sql`${activityLogs.meta}->>'runId' = ${String(selected)}`)
          .orderBy(desc(activityLogs.createdAt))
          .limit(30)
      : Promise.resolve([]),
  ]);

  const serializedRuns: SerializedRunItem[] = runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    runMode: r.runMode,
    status: r.status,
    totalProducts: r.totalProducts,
    applied: r.applied,
    pendingReview: r.pendingReview,
    failed: r.failed,
    error: r.error ?? null,
    startedAt: toIsoString(r.startedAt),
    finishedAt: r.finishedAt ? toIsoString(r.finishedAt) || null : null,
  }));

  const serializedDecisions: SerializedRunDecision[] = decisions.map(({ d, name, sku }) => {
    const rawSteps = Array.isArray(d.steps) ? d.steps : [];
    const inquiryData = rawSteps.find((s) => s.step === "torob_inquiry")?.data as TorobInquiryReport | undefined;
    const panelEvidence: PanelCompetitiveEvidence[] | undefined = inquiryData?.panelEvidence;
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
      panels: decisionPanels(rawSteps),
      ...(panelEvidence?.length ? { panelEvidence } : {}),
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

  const serializedRunLogs: SerializedRunLog[] = rawRunLogs.map((l) => ({
    id: l.id,
    scope: l.scope,
    level: l.level,
    message: l.message,
    createdAt: toIsoString(l.createdAt),
  }));

  return (
    <RunsClient
      runs={serializedRuns}
      selectedRunId={selected}
      decisions={serializedDecisions}
      runLogs={serializedRunLogs}
    />
  );
}
