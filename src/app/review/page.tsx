import { decisionPanels } from "@/lib/pricing/listing";
import { toIsoString } from "@/lib/format";
import { db } from "@/db";
import { competitorOffers, priceDecisions, products } from "@/db/schema";
import type { TorobCandidateTrace, TorobInquiryReport } from "@/lib/pricing/types";
import {
  ReviewClient,
  type ReviewAlternativeScenario,
  type ReviewCompetitorItem,
  type ReviewPendingItem,
  type ReviewRejectedItem,
  type ReviewSupervisorGate,
} from "@/components/review-client";
import { asc, desc, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractAlternative(v: unknown): ReviewAlternativeScenario | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const finalPrice = numOrNull(r.finalPrice);
  const p = numOrNull(r.p);
  const lowestPrice = numOrNull(r.lowestPrice);
  if (finalPrice == null || p == null || lowestPrice == null) return null;
  return {
    finalPrice: Math.round(finalPrice),
    p,
    lowestPrice: Math.round(lowestPrice),
    shopName: String(r.shopName ?? "رقیب"),
  };
}

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
        sellerType: competitorOffers.sellerType,
        torobEvidence: competitorOffers.torobEvidence,
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
          sellerType: o.sellerType,
          listingTitle: o.torobEvidence?.listingTitle ?? null,
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
    ({ d, name, sku, cost, hardFloor, current, torobUrl }) => {
      const steps = Array.isArray(d.steps) ? d.steps : [];
      const panels = decisionPanels(steps);
      const inquiry = steps.find((s) => s.step === "torob_inquiry")?.data as
        (TorobInquiryReport & { candidate?: TorobCandidateTrace }) | undefined;
      const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
      const supStep = steps.find((s) => s.step === "supervisor");
      const supMsg = supStep?.message ?? null;
      const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
      const aiMsg = steps.find((s) => s.step === "ai_review")?.message ?? null;
      const aiIdentityMsg = steps.find((s) => s.step === "ai_identity")?.message ?? null;
      const liquidationMsg = steps.find((s) => s.step === "liquidation_guard")?.message ?? null;
      const gateStep = steps.find((s) => s.step === "supervision_gate");
      const robStep = steps.find((s) => s.step === "robustness");
      const valStep = steps.find((s) => s.step === "validity");
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

      const pRight = numOrNull(robStep?.data?.pRight);
      const pTooHigh = numOrNull(robStep?.data?.pTooHigh);
      const pTooLow = numOrNull(robStep?.data?.pTooLow);
      const alternative = extractAlternative(robStep?.data?.alternative);
      const marketSigma = numOrNull(valStep?.data?.sigma);
      const pAnchorOk = numOrNull(valStep?.data?.pAnchorOk);
      const confidence = Number.isFinite(d.confidence) ? d.confidence : 0;
      const errorRiskPct = Math.max(
        0,
        Math.min(100, Math.round((1 - (pRight ?? confidence)) * 100)),
      );

      const readyForApproval = Boolean(
        !isBelowFloor &&
          !syncFailed &&
          !d.marketConflict && !d.isSimulated && effectiveCost > 0 &&
          finalPrice > 0 &&
          gateStep?.data?.readyForApproval === true,
      );

      return {
        id: d.id,
        productId: d.productId,
        name,
        sku,
        status: d.status,
        createdAt: toIsoString(d.createdAt),
        cost,
        effectiveCost,
        current,
        referencePrice: d.referencePrice,
        marketMedian: d.marketMedian,
        basePrice: d.basePrice,
        finalPrice: d.finalPrice,
        discountPct: d.discountPct,
        campaignType: d.campaignType,
        strategy: d.strategy ?? null,
        netProfitToman: d.netProfitToman ?? null,
        netMarginPct: d.netMarginPct ?? null,
        offersUsed: d.offersUsed,
        offersTotal: d.offersTotal,
        confidence,
        errorRiskPct,
        pRight,
        pTooHigh,
        pTooLow,
        alternative,
        marketSigma,
        pAnchorOk,
        projectedNationalRank: d.projectedNationalRank,
        rankIncludingSuspect,
        totalIncludingSuspect,
        marketConflict: d.marketConflict,
        isBelowFloor,
        syncFailed,
        readyForApproval,
        panels,
        inquiry: inquiry ?? null,
        candidateUrl: inquiry?.candidate?.url ?? torobUrl,
        effectiveFloor,
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

  const rejectedItems: ReviewRejectedItem[] = rejectedRows.map(({ d, name, sku, torobUrl }) => {
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const panels = decisionPanels(steps);
    const inquiry = steps.find((s) => s.step === "torob_inquiry")?.data as
      (TorobInquiryReport & { candidate?: TorobCandidateTrace }) | undefined;
    const supStep = steps.find((s) => s.step === "supervisor");
    const supMsg = supStep?.message ?? inquiry?.reason ?? "رد توسط ناظر SystemOne";
    const { overallPct: supOverallPct, gates: supGates } = extractSupervisorGates(supStep);
    return {
      id: d.id,
      productId: d.productId,
      name,
      sku,
      createdAt: toIsoString(d.createdAt),
      finalPrice: d.finalPrice,
      basePrice: d.basePrice,
      offersUsed: d.offersUsed,
      offersTotal: d.offersTotal,
      supMsg,
      supOverallPct,
      supGates,
      panels,
      inquiry: inquiry ?? null,
      torobUrl: inquiry?.candidate?.url ?? (panels[0] ? `https://torob.com/p/${panels[0].prk}/` : torobUrl),
    };
  });

  return <ReviewClient pendingItems={pendingItems} rejectedItems={rejectedItems} />;
}
