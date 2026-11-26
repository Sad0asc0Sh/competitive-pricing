import { db } from "@/db";
import { priceDecisions, products } from "@/db/schema";
import { ReviewClient, type ReviewPendingItem, type ReviewRejectedItem } from "@/components/review-client";
import { desc, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const [rows, rejectedRows] = await Promise.all([
    db
      .select({
        d: priceDecisions,
        name: products.name,
        sku: products.sku,
        cost: products.costPrice,
        hardFloor: products.currentHardFloorPrice,
        current: products.currentFinalPrice,
      })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(inArray(priceDecisions.status, ["pending_review", "sync_failed", "pending_sync"]))
      .orderBy(desc(priceDecisions.createdAt)),
    db
      .select({ d: priceDecisions, name: products.name, sku: products.sku })
      .from(priceDecisions)
      .innerJoin(products, eq(products.id, priceDecisions.productId))
      .where(eq(priceDecisions.status, "rejected"))
      .orderBy(desc(priceDecisions.createdAt))
      .limit(20),
  ]);

  const pendingItems: ReviewPendingItem[] = rows.map(({ d, name, sku, cost, hardFloor, current }) => {
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const reasons = steps.find((s) => s.step === "decision")?.message ?? "";
    const supMsg = steps.find((s) => s.step === "supervisor")?.message ?? null;
    const aiMsg = steps.find((s) => s.step === "ai_review")?.message ?? null;
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

  const rejectedItems: ReviewRejectedItem[] = rejectedRows.map(({ d, name, sku }) => {
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

  return <ReviewClient pendingItems={pendingItems} rejectedItems={rejectedItems} />;
}
