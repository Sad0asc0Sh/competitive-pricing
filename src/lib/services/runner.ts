import { db } from "@/db";
import { competitorOffers, discountCampaigns, priceDecisions, priceRuns, products, type Product } from "@/db/schema";
import { reviewDecisionWithAI } from "@/lib/ai/client";
import { pickCampaign } from "@/lib/pricing/campaigns";
import { runPricingPipeline } from "@/lib/pricing/engine";
import type { RawOffer } from "@/lib/pricing/types";
import { fetchFromSource } from "@/lib/sources/registry";
import { pushToStore } from "@/lib/store/connectors";
import { and, eq, inArray } from "drizzle-orm";
import { ensureDefaults, getProfileConfig, logActivity } from "./bootstrap";

export interface RunOptions {
  trigger: "manual" | "schedule" | "api";
  productIds?: number[];
  category?: string;
  scheduleId?: number;
  /** پیشنهادهای دستی (فقط برای اجرای تک‌محصولی) */
  manualOffers?: RawOffer[];
}

export interface RunSummary {
  runId: number;
  total: number;
  applied: number;
  pendingReview: number;
  failed: number;
  decisionIds: number[];
}

/**
 * اجرای موتور قیمت برای یک یا چند محصول:
 *  1. ایجاد رکورد اجرا
 *  2. برای هر محصول: استعلام → Pipeline → (AI review اختیاری) → ذخیره تصمیم + پیشنهادها
 *  3. اگر اعمال خودکار مجاز بود: بروزرسانی محصول + push به فروشگاه
 */
export async function runPricing(opts: RunOptions): Promise<RunSummary> {
  await ensureDefaults();

  const conds = [eq(products.status, "active")];
  if (opts.productIds?.length) conds.push(inArray(products.id, opts.productIds));
  if (opts.category) conds.push(eq(products.category, opts.category));
  // اجرای دستی روی محصول خاص حتی اگر paused/needs_review باشد
  const targets =
    opts.productIds?.length && opts.trigger !== "schedule"
      ? await db.select().from(products).where(inArray(products.id, opts.productIds))
      : await db.select().from(products).where(and(...conds));

  const [run] = await db
    .insert(priceRuns)
    .values({ trigger: opts.trigger, scheduleId: opts.scheduleId, totalProducts: targets.length })
    .returning();

  const summary: RunSummary = { runId: run.id, total: targets.length, applied: 0, pendingReview: 0, failed: 0, decisionIds: [] };
  const campaigns = await db.select().from(discountCampaigns);

  for (const product of targets) {
    try {
      const decisionId = await priceOneProduct(product, run.id, campaigns, opts.manualOffers);
      summary.decisionIds.push(decisionId.id);
      if (decisionId.status === "applied") summary.applied++;
      else if (decisionId.status === "pending_review") summary.pendingReview++;
      else summary.failed++;
    } catch (e) {
      summary.failed++;
      await logActivity("runner", `خطا در قیمت‌گذاری محصول ${product.sku}: ${e instanceof Error ? e.message : String(e)}`, { productId: product.id }, "error");
    }
  }

  await db
    .update(priceRuns)
    .set({ status: "done", applied: summary.applied, pendingReview: summary.pendingReview, failed: summary.failed, finishedAt: new Date() })
    .where(eq(priceRuns.id, run.id));

  await logActivity("runner", `اجرای #${run.id} پایان یافت: ${summary.applied} اعمال، ${summary.pendingReview} بازبینی، ${summary.failed} خطا`, { ...summary });
  return summary;
}

async function priceOneProduct(
  product: Product,
  runId: number,
  campaigns: (typeof discountCampaigns.$inferSelect)[],
  manualOffers?: RawOffer[],
): Promise<{ id: number; status: string }> {
  const { config } = await getProfileConfig(product.profileId);
  const source = await fetchFromSource(
    {
      id: product.id,
      name: product.name,
      sourceType: product.sourceType,
      torobUrl: product.torobUrl,
      torobPrk: product.torobPrk,
      costPrice: product.costPrice,
      currentFinalPrice: product.currentFinalPrice,
    },
    manualOffers,
  );

  const result = runPricingPipeline(source, {
    productId: product.id,
    productName: product.name,
    costPrice: product.costPrice,
    minMarginPctOverride: product.minMarginPct,
    currentFinalPrice: product.currentFinalPrice,
    category: product.category,
    config,
  });

  // --- بازبینی AI برای تصمیم‌های کم‌اعتماد (نظر دوم)
  if (config.ai.enabled && result.finalPrice && result.confidence < config.ai.reviewBelowConfidence) {
    const review = await reviewDecisionWithAI({
      productName: product.name,
      costPrice: product.costPrice,
      offers: result.offers.map((o) => ({ shopName: o.shopName, price: o.price, included: o.included, excludeReason: o.excludeReason })),
      referencePrice: result.referencePrice,
      finalPrice: result.finalPrice,
      basePrice: result.basePrice,
      reviewReasons: result.reviewReasons,
    });
    if (review) {
      result.steps.push({ step: "ai_review", title: "بازبینی هوش مصنوعی", message: `${review.verdict}: ${review.reasoning}`, level: review.verdict === "approve" ? "info" : "warn" });
      if (review.verdict === "reject") {
        result.needsReview = true;
        result.reviewReasons.push("AI تصمیم را رد کرد");
      }
    } else {
      result.steps.push({ step: "ai_review", title: "بازبینی هوش مصنوعی", message: "غیرفعال (کلید AI_API_KEY تنظیم نشده) یا در دسترس نیست", level: "info" });
    }
  }

  // --- انتخاب کمپین
  let campaignType = "none";
  let campaignEndsAt: Date | null = null;
  if (result.discountPct != null && result.finalPrice) {
    const pick = pickCampaign(campaigns, { discountPct: result.discountPct, category: product.category });
    campaignType = pick.type;
    campaignEndsAt = pick.endsAt;
    result.steps.push({ step: "campaign", title: "کمپین تخفیف", message: pick.reason, data: { type: pick.type } });
  }

  const canApply = !!result.finalPrice && !result.needsReview && product.autoApply;
  const status = !result.finalPrice ? "failed" : canApply ? "applied" : "pending_review";

  const [decision] = await db
    .insert(priceDecisions)
    .values({
      runId,
      productId: product.id,
      source: source.source,
      offersTotal: result.offersTotal,
      offersUsed: result.offersUsed,
      lowestRaw: result.lowestRaw,
      lowestValid: result.lowestValid,
      marketMedian: result.marketMedian,
      marketMean: result.marketMean,
      referencePrice: result.referencePrice,
      basePrice: result.basePrice,
      finalPrice: result.finalPrice,
      discountPct: result.discountPct,
      campaignType,
      strategy: result.strategy,
      confidence: result.confidence,
      status,
      steps: result.steps,
    })
    .returning();

  if (result.offers.length) {
    await db.insert(competitorOffers).values(
      result.offers.map((o) => ({
        decisionId: decision.id,
        productId: product.id,
        shopName: o.shopName,
        shopId: o.shopId ?? null,
        price: Math.round(o.price),
        lastChangedAt: o.lastChangedAt ?? null,
        isAd: !!o.isAd,
        inStock: o.inStock !== false,
        url: o.url ?? null,
        included: o.included,
        excludeReason: o.excludeReason ?? null,
        weight: o.weight,
      })),
    );
  }

  await db
    .update(products)
    .set({ lastCheckedAt: new Date(), lastDecisionId: decision.id, updatedAt: new Date(), ...(status === "pending_review" ? { status: "needs_review" } : {}) })
    .where(eq(products.id, product.id));

  if (status === "applied") {
    await applyDecision(decision.id, campaignEndsAt);
  }

  return { id: decision.id, status };
}

/** اعمال تصمیم روی محصول + ارسال به فروشگاه (برای اعمال خودکار یا تأیید دستی) */
export async function applyDecision(decisionId: number, campaignEndsAt?: Date | null): Promise<{ ok: boolean; message: string }> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d || !d.finalPrice || !d.basePrice) return { ok: false, message: "تصمیم نامعتبر" };
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);
  if (!p) return { ok: false, message: "محصول یافت نشد" };

  await db
    .update(products)
    .set({
      currentBasePrice: d.basePrice,
      currentFinalPrice: d.finalPrice,
      currentDiscountPct: d.discountPct,
      currentCampaign: d.campaignType,
      lastDecisionId: d.id,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(products.id, p.id));

  const push = await pushToStore({
    productId: p.id,
    sku: p.sku,
    storeExternalId: p.storeExternalId,
    basePrice: d.basePrice,
    finalPrice: d.finalPrice,
    discountPct: d.discountPct ?? 0,
    campaignType: d.campaignType ?? "none",
    campaignEndsAt: campaignEndsAt ? campaignEndsAt.toISOString() : null,
    decisionId: d.id,
    confidence: d.confidence,
  });

  await db
    .update(priceDecisions)
    .set({ status: "applied", pushStatus: push.skipped ? "skipped" : push.ok ? "pushed" : "failed", pushError: push.ok ? null : push.message, pushedAt: new Date() })
    .where(eq(priceDecisions.id, d.id));

  await logActivity("apply", `قیمت ${p.sku}: اصلی ${d.basePrice} → نهایی ${d.finalPrice} (${d.discountPct}%) — ${push.message}`, { decisionId: d.id }, push.ok ? "info" : "warn");
  return push;
}

export async function rejectDecision(decisionId: number): Promise<void> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) return;
  await db.update(priceDecisions).set({ status: "rejected" }).where(eq(priceDecisions.id, decisionId));
  await db.update(products).set({ status: "active", updatedAt: new Date() }).where(eq(products.id, d.productId));
  await logActivity("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}
