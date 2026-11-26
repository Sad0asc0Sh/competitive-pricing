import { db } from "@/db";
import { competitorOffers, priceDecisions, products } from "@/db/schema";
import {
  ReviewClient,
  type ReviewCompetitorItem,
  type ReviewPendingItem,
  type ReviewRejectedItem,
  type ReviewSupervisorGate,
} from "@/components/review-client";
import { asc, desc, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function extractSupervisorGates(supStep?: { data?: Record<string, unknown> }): {
  overallPct: number | null;
  gates: ReviewSupervisorGate[];
} {
  const overallRaw = supStep?.data?.overallScorePct;
  const overallPct = typeof overallRaw === "number" && Number.isFinite(overallRaw) ? Math.round(overallRaw) : null;
  const gatesObj = supStep?.data?.gates;
  if (!gatesObj || typeof gatesObj !== "object") {
    return { overallPct, gates: [] };
  }
  const gates: ReviewSupervisorGate[] = [];
  for (const val of Object.values(gatesObj as Record<string, Record<string, unknown>>)) {
    if (!val || typeof val !== "object") continue;
    gates.push({
      key: String(val.key ?? ""),
      title: String(val.title ?? val.key ?? ""),
      scorePct: typeof val.scorePct === "number" ? Math.round(val.scorePct) : 0,
      verdict: String(val.verdict ?? "review"),
      reason: String(val.reason ?? ""),
    });
  }
  return { overallPct, gates };
}

export default async function ReviewPage() {
  const [rawRows, rawRejectedRows] = await Promise.all([
    db
      .select({
        d: priceDecisions,
        name: products.name,
        sku: products.sku,
        cost: products.costPrice,
        hardFloor: products.currentHardFloorPrice,
        current: products.currentFinalPrice,
        torobUrl: products.torobUrl,
        torobPrk: products.torobPrk,
      })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(inArray(priceDecisions.status, ["pending_review", "sync_failed", "pending_sync"]))
      .orderBy(desc(priceDecisions.createdAt)),
    db
      .select({
        d: priceDecisions,
        name: products.name,
        sku: products.sku,
        torobUrl: products.torobUrl,
        torobPrk: products.torobPrk,
      })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(eq(priceDecisions.status, "rejected"))
      .orderBy(desc(priceDecisions.createdAt))
      .limit(40),
  ]);

  const seenPendingProducts = new Set<number>();
  const rows = rawRows.filter(({ d }) => {
    if (seenPendingProducts.has(d.productId)) return false;
    seenPendingProducts.add(d.productId);
    return true;
  });

  const seenRejectedProducts = new Set<number>();
  const rejectedRows = rawRejectedRows
    .filter(({ d }) => {
      if (seenPendingProducts.has(d.productId)) return false;
      if (seenRejectedProducts.has(d.productId)) return false;
      seenRejectedProducts.add(d.productId);
      return true;
    })
    .slice(0, 20);

  const pendingDecisionIds = rows.map(({ d }) => d.id);
  const offersByDecision = new Map<number, ReviewCompetitorItem[]>();
  if (pendingDecisionIds.length > 0) {
    const offerRows = await db
      .select({
        id: competitorOffers.id,
        decisionId: competitorOffers.decisionId,
        shopName: competitorOffers.shopName,
        shopCity: competitorOffers.shopCity,
        price: competitorOffers.price,
        shopScore: competitorOffers.shopScore,
        isLocalCity: competitorOffers.isLocalCity,
        included: competitorOffers.included,
        excludeReason: competitorOffers.excludeReason,
      })
      .from(competitorOffers)
      .where(inArray(competitorOffers.decisionId, pendingDecisionIds))
      .orderBy(asc(competitorOffers.price));

    for (const o of offerRows) {
      const list = offersByDecision.get(o.decisionId) ?? [];
      if (list.length < 6) {
        list.push({
          id: o.id,
          shopName: o.shopName,
          shopCity: o.shopCity,
          price: o.price,
          shopScore: o.shopScore,
          isLocalCity: o.isLocalCity,
          included: o.included,
          excludeReason: o.excludeReason,
        });
        offersByDecision.set(o.decisionId, list);
      }
    }
  }

  const pendingItems: ReviewPendingItem[] = rows.map(
    ({ d, name, sku, cost, hardFloor, current, torobUrl, torobPrk }) => {
      const steps = Array.isArray(d.steps) ? d.steps : [];
      const sourceStep = steps.find((s) => s.step === "source");
      const torobTitle =
        typeof sourceStep?.data?.productTitle === "string" ? sourceStep.data.productTitle : null;
      const stepPrk = typeof sourceStep?.data?.prk === "string" ? sourceStep.data.prk : null;
      const resolvedPrk = torobPrk || stepPrk || null;
      const resolvedTorobUrl =
        torobUrl || (resolvedPrk ? `https://torob.com/p/${resolvedPrk}/` : null);

      const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
      const supStep = steps.find((s) => s.step === "supervisor");
      const supMsg = supStep?.message ?? null;
      const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
      const aiMsg = steps.find((s) => s.step === "ai_review")?.message ?? null;
      const aiIdentityMsg = steps.find((s) => s.step === "ai_identity")?.message ?? null;
      const liquidationMsg = steps.find((s) => s.step === "liquidation_guard")?.message ?? null;
      const gateStep = steps.find((s) => s.step === "supervision_gate");
      const positionStep = steps.find((s) => s.step === "position");
      const rankIncludingSuspect =
        d.rankIncludingSuspect ?? (Number(positionStep?.data?.rankIncludingSuspect) || null);
      const totalIncludingSuspect =
        d.totalSellersIncludingSuspect || Number(positionStep?.data?.totalSellersIncludingSuspect) || 0;
      const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, cost ?? 0);
      const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, hardFloor ?? 0, effectiveCost);
      const finalPrice = d.finalPrice ?? 0;
      const isBelowFloor =
        finalPrice > 0 &&
        ((effectiveCost > 0 && finalPrice <= effectiveCost) ||
          (effectiveFloor > 0 && finalPrice < effectiveFloor));
      const syncFailed =
        d.status === "sync_failed" || d.status === "pending_sync" || d.pushStatus === "failed";
      const readyForApproval =
        typeof gateStep?.data?.readyForApproval === "boolean"
          ? gateStep.data.readyForApproval
          : !isBelowFloor && !d.marketConflict && !syncFailed && reasons.length === 0;

      return {
        id: d.id,
        productId: d.productId,
        name,
        sku,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        cost,
        effectiveCost,
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
        readyForApproval,
        torobUrl: resolvedTorobUrl,
        torobPrk: resolvedPrk,
        torobTitle,
        reasons,
        supMsg,
        supOverallPct,
        supGates,
        aiMsg,
        aiIdentityMsg,
        liquidationMsg,
        competitors: offersByDecision.get(d.id) ?? [],
      };
    },
  );

  const rejectedItems: ReviewRejectedItem[] = rejectedRows.map(({ d, name, sku, torobUrl, torobPrk }) => {
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const sourceStep = steps.find((s) => s.step === "source");
    const torobTitle = typeof sourceStep?.data?.productTitle === "string" ? sourceStep.data.productTitle : null;
    const stepPrk = typeof sourceStep?.data?.prk === "string" ? sourceStep.data.prk : null;
    const resolvedPrk = torobPrk || stepPrk || null;
    const resolvedTorobUrl = torobUrl || (resolvedPrk ? `https://torob.com/p/${resolvedPrk}/` : null);
    const supStep = steps.find((s) => s.step === "supervisor");
    const supMsg = supStep?.message ?? "رد توسط ناظر SystemOne";
    const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
    return {
      id: d.id,
      productId: d.productId,
      name,
      sku,
      createdAt: d.createdAt.toISOString(),
      supMsg,
      supOverallPct,
      supGates,
      torobUrl: resolvedTorobUrl,
      torobTitle,
    };
  });

  return <ReviewClient pendingItems={pendingItems} rejectedItems={rejectedItems} />;
}
