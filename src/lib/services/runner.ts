import { db } from "@/db";
import { competitorOffers, discountCampaigns, priceDecisions, priceRuns, products, type Product } from "@/db/schema";
import { reviewDecisionWithAI } from "@/lib/ai/client";
import { pickCampaign } from "@/lib/pricing/campaigns";
import { runPricingPipeline } from "@/lib/pricing/engine";
import { enrichSupervisorWithSubqApi } from "@/lib/pricing/systemone-supervisor";
import type { RawOffer, SupplierQuote } from "@/lib/pricing/types";
import { fetchFromSource, isAllowedSourceType } from "@/lib/sources/registry";
import { pushToStore } from "@/lib/store/connectors";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ensureDefaults, getProfileConfig, logActivity } from "./bootstrap";

export interface RunOptions {
  trigger: "manual" | "schedule" | "api";
  productIds?: number[];
  category?: string;
  scheduleId?: number;
  /** اعمال روی رنج مشخصی از کارت‌های محصول (۱-مبنا: از کارت شماره X تا کارت شماره Y) */
  cardRangeFrom?: number;
  cardRangeTo?: number;
  /** پیشنهادهای دستی بازار (فقط برای اجرای تک‌محصولی) */
  manualOffers?: RawOffer[];
  /** پیشنهادهای دستی لیست همکاران (در صورت ارسال در لحظه اجرا) */
  manualSupplierQuotes?: SupplierQuote[];
}

export interface RunSummary {
  runId: number;
  total: number;
  applied: number;
  pendingReview: number;
  failed: number;
  decisionIds: number[];
}

export async function runPricing(opts: RunOptions): Promise<RunSummary> {
  await ensureDefaults();

  const conds = [eq(products.status, "active")];
  if (opts.productIds?.length) conds.push(inArray(products.id, opts.productIds));
  if (opts.category) conds.push(eq(products.category, opts.category));

  let targets =
    opts.productIds?.length && opts.trigger !== "schedule"
      ? await db.select().from(products).where(inArray(products.id, opts.productIds)).orderBy(asc(products.id))
      : await db.select().from(products).where(and(...conds)).orderBy(asc(products.id));

  if (opts.cardRangeFrom || opts.cardRangeTo) {
    const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
    const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : targets.length;
    targets = targets.slice(startIdx, endIdx);
  }

  const [run] = await db
    .insert(priceRuns)
    .values({ trigger: opts.trigger, scheduleId: opts.scheduleId, totalProducts: targets.length })
    .returning();

  const summary: RunSummary = {
    runId: run.id,
    total: targets.length,
    applied: 0,
    pendingReview: 0,
    failed: 0,
    decisionIds: [],
  };
  const campaigns = await db.select().from(discountCampaigns);
  const allocatedCounts: Record<number, number> = {};

  // پردازش موازی محدود (پیش‌فرض ۳ محصول هم‌زمان، با PRICING_RUN_CONCURRENCY قابل تنظیم ۱..۸).
  // تخصیص کمپین (pickCampaign + افزایش allocatedCounts) کاملاً همگام (بدون await در میان) انجام
  // می‌شود، پس سقف maxCards کمپین‌ها در اجرای موازی هم دقیق می‌ماند؛ با مقدار ۱ رفتار کاملاً ترتیبی قبلی برمی‌گردد.
  const concurrency = Math.max(1, Math.min(8, Number(process.env.PRICING_RUN_CONCURRENCY ?? 3) || 3));
  let nextIdx = 0;
  const worker = async () => {
    for (;;) {
      const idx = nextIdx++;
      if (idx >= targets.length) return;
      const product = targets[idx];
      const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
      try {
        const decisionId = await priceOneProduct(
          product,
          run.id,
          campaigns,
          cardIndex,
          allocatedCounts,
          opts.manualOffers,
          opts.manualSupplierQuotes,
        );
        summary.decisionIds.push(decisionId.id);
        if (decisionId.status === "applied") summary.applied++;
        else if (decisionId.status === "pending_review") summary.pendingReview++;
        else summary.failed++;
      } catch (e) {
        summary.failed++;
        await logActivity(
          "runner",
          `خطا در قیمت‌گذاری محصول ${product.sku}: ${e instanceof Error ? e.message : String(e)}`,
          { productId: product.id },
          "error",
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));

  await db
    .update(priceRuns)
    .set({
      status: "done",
      applied: summary.applied,
      pendingReview: summary.pendingReview,
      failed: summary.failed,
      finishedAt: new Date(),
    })
    .where(eq(priceRuns.id, run.id));

  await logActivity(
    "runner",
    `اجرای #${run.id} پایان یافت: ${summary.applied} اعمال، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا`,
    { ...summary },
  );
  return summary;
}

async function priceOneProduct(
  product: Product,
  runId: number,
  campaigns: (typeof discountCampaigns.$inferSelect)[],
  cardIndex: number,
  allocatedCounts: Record<number, number>,
  manualOffers?: RawOffer[],
  manualSupplierQuotes?: SupplierQuote[],
): Promise<{ id: number; status: string }> {
  // گارد سیستم واقعی: فقط منبع واقعی ترب (یا پیشنهادهای دستی همین اجرا) مجاز است.
  // محصولات قدیمی با منبع حذف‌شده/شبیه‌سازی (مثل mock) هرگز تصمیم قیمتی نمی‌گیرند
  // و قیمتشان به فروشگاه ارسال نمی‌شود؛ اجرا برای آن‌ها با خطای شفاف متوقف می‌شود.
  if (!manualOffers?.length && !isAllowedSourceType(product.sourceType)) {
    throw new Error(
      `منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`,
    );
  }

  const { config } = await getProfileConfig(product.profileId);
  const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];

  const source = await fetchFromSource(
    {
      id: product.id,
      sku: product.sku,
      name: product.name,
      sourceType: product.sourceType,
      torobUrl: product.torobUrl,
      torobPrk: product.torobPrk,
      torobDetailsUrl: product.torobDetailsUrl,
      costPrice: product.costPrice,
      supplierQuotes,
      currentFinalPrice: product.currentFinalPrice,
    },
    manualOffers,
  );

  const result = runPricingPipeline(source, {
    productId: product.id,
    productName: product.name,
    costPrice: product.costPrice,
    supplierQuotes,
    minMarginPctOverride: product.minMarginPct,
    minProfitAmountOverride: product.minProfitAmount,
    currentFinalPrice: product.currentFinalPrice,
    category: product.category,
    config,
  });

  // در صورتی که کلید SUBQ_API_KEY تنظیم شده باشد، ناظر بالاسر با API زنده SubQ SystemOne نیز غنی‌سازی می‌شود
  if (config.supervisor.enabled) {
    result.supervisor = await enrichSupervisorWithSubqApi(result.supervisor, config.supervisor);
    if (result.supervisor.verdict === "reject") {
      result.rejectedBySupervisor = true;
      result.needsReview = true;
    } else if (result.supervisor.verdict === "review") {
      result.needsReview = true;
    }
  }

  if (config.ai.enabled && result.finalPrice && result.confidence < config.ai.reviewBelowConfidence) {
    const review = await reviewDecisionWithAI({
      productName: product.name,
      costPrice: result.supply.effectiveCostPrice,
      offers: result.offers.map((o) => ({
        shopName: o.shopName,
        price: o.price,
        included: o.included,
        excludeReason: o.excludeReason,
      })),
      referencePrice: result.referencePrice,
      finalPrice: result.finalPrice,
      basePrice: result.basePrice,
      reviewReasons: result.reviewReasons,
    });
    if (review) {
      result.steps.push({
        step: "ai_review",
        title: "بازبینی هوش مصنوعی مکمل",
        message:
          review.verdict === "adjust" && review.suggestedFinalPrice
            ? `adjust (پیشنهاد AI: ${review.suggestedFinalPrice.toLocaleString("fa-IR")} تومان): ${review.reasoning}`
            : `${review.verdict}: ${review.reasoning}`,
        level: review.verdict === "approve" ? "info" : "warn",
        data: review.suggestedFinalPrice ? { suggestedFinalPrice: review.suggestedFinalPrice } : undefined,
      });
      if (review.verdict === "reject") {
        result.needsReview = true;
        result.reviewReasons.push(`AI تصمیم را رد کرد: ${review.reasoning}`);
      } else if (review.verdict === "adjust") {
        // منطق اصلاح‌شده adjust: پیشنهاد AI هرگز مستقیم اعمال نمی‌شود؛ فقط به ریویو می‌رود.
        // اگر پیشنهاد AI زیر خط قرمز سود باشد، مثل reject رفتار می‌کنیم.
        const suggested = review.suggestedFinalPrice;
        const floor = result.supply.hardFloorPrice;
        const cost = result.supply.effectiveCostPrice;
        const unsafe = suggested == null || (floor > 0 && suggested < floor) || (cost > 0 && suggested <= cost);
        result.needsReview = true;
        result.reviewReasons.push(
          suggested != null
            ? unsafe
              ? `پیشنهاد AI (${suggested.toLocaleString("fa-IR")} تومان) زیر خط قرمز سود است و مردود شد`
              : `AI اصلاح قیمت را پیشنهاد داد (${suggested.toLocaleString("fa-IR")} تومان): ${review.reasoning}`
            : `AI نیاز به اصلاح دید: ${review.reasoning}`,
        );
      }
    }
  }

  let campaignType = "none";
  let campaignName: string | null = null;
  let badgeTheme = "green-orange";
  let showInFeatured = false;
  let campaignEndsAt: Date | null = null;

  if (result.discountPct != null && result.finalPrice) {
    const pick = pickCampaign(campaigns, {
      discountPct: result.discountPct,
      category: product.category,
      productId: product.id,
      cardIndex,
      finalPrice: result.finalPrice,
      projectedLocalRank: result.position.projectedLocalRank,
      projectedNationalRank: result.position.projectedNationalRank,
      preferredCampaignType: product.preferredCampaignType,
      allocatedCounts,
    });
    campaignType = pick.type;
    campaignName = pick.campaignName;
    badgeTheme = pick.badgeTheme;
    showInFeatured = pick.showInFeatured;
    campaignEndsAt = pick.endsAt;
    if (pick.campaignId != null && pick.type !== "none") {
      allocatedCounts[pick.campaignId] = (allocatedCounts[pick.campaignId] ?? 0) + 1;
    }
    result.steps.push({
      step: "campaign",
      title: "انتخاب هوشمند از بین ۳ سیستم تخفیف",
      message: pick.reason,
      data: {
        type: pick.type,
        campaignName: pick.campaignName,
        badgeTheme: pick.badgeTheme,
        showInFeatured: pick.showInFeatured,
        cardIndex,
      },
    });
  }

  const strictlyAboveCost =
    result.finalPrice != null &&
    result.supply.effectiveCostPrice > 0 &&
    result.finalPrice >= result.supply.hardFloorPrice &&
    result.finalPrice > result.supply.effectiveCostPrice;

  // اعمال دقیق حکم ۳ بازه‌ای ناظر بالاسر (SystemOne Supervisor):
  // - زیر 45% (reject): وضعیت "rejected" (رد کامل، وارد سایت نمی‌شود)
  // - بین 45% تا 80% (review): وضعیت "pending_review" (ارسال به بخش ریویو)
  // - بالای 80% (approve): در صورت رعایت خط قرمز سود و فعال بودن autoApply، وضعیت "applied" (ادامه کار و اعمال خودکار)
  let status: string;
  if (!result.finalPrice) {
    status = "failed";
  } else if (result.rejectedBySupervisor) {
    status = "rejected";
  } else if ( strictlyAboveCost && !result.needsReview && product.autoApply) {
    status = "applied";
  } else {
    status = "pending_review";
  }

  const [decision] = await db
    .insert(priceDecisions)
    .values({
      runId,
      productId: product.id,
      source: source.source,
      offersTotal: result.offersTotal,
      offersUsed: result.offersUsed,
      effectiveCostPrice: result.supply.effectiveCostPrice,
      hardFloorPrice: result.supply.hardFloorPrice,
      lowestRaw: result.lowestRaw,
      lowestValid: result.lowestValid,
      localLowestValid: result.position.localLowestPrice,
      marketMedian: result.marketMedian,
      marketMean: result.marketMean,
      referencePrice: result.referencePrice,
      monitoredMarketCeiling: result.floorCeiling.monitoredMarketCeiling,
      basePrice: result.basePrice,
      finalPrice: result.finalPrice,
      discountPct: result.discountPct,
      campaignType,
      campaignName,
      badgeTheme,
      showInFeatured,
      strategy: result.strategy,
      competitionTier: result.position.competitionTier,
      projectedNationalRank: result.position.projectedNationalRank,
      projectedLocalRank: result.position.projectedLocalRank,
      netProfitToman: result.position.netProfitToman,
      netMarginPct: result.position.netMarginPct,
      confidence: result.supervisor.enabled ? result.supervisor.overallNoul : result.confidence,
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
        shopCity: o.shopCity ?? null,
        sellerType: o.sellerType ?? "online",
        shopScore: o.shopScore ?? null,
        isLocalCity: !!o.isLocalCity,
        priceUnreliable: !!o.priceUnreliable,
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
    .set({
      lastCheckedAt: new Date(),
      lastDecisionId: decision.id,
      updatedAt: new Date(),
      ...(!result.supply.usedMarketConsensusFloor && result.supply.effectiveCostPrice > 0
        ? { costPrice: result.supply.effectiveCostPrice }
        : {}),
      selectedSupplierName: result.supply.usedMarketConsensusFloor
        ? "کشف هوشمند از ترب (قیمت‌گذار معیار)"
        : result.supply.selectedQuote?.supplierName ?? product.selectedSupplierName ?? null,
      ...(result.supply.hardFloorPrice > 0 ? { currentHardFloorPrice: result.supply.hardFloorPrice } : {}),
      // قفل کردن PRK در دیتابیس فقط زمانی که گیت هویت ناظر (identity_match) رد نشده باشد!
      ...(source.prk && !product.torobPrk && result.supervisor.gates.identity_match?.verdict !== "reject"
        ? { torobPrk: source.prk }
        : {}),
      ...(source.detailsUrl && !product.torobDetailsUrl && result.supervisor.gates.identity_match?.verdict !== "reject"
        ? { torobDetailsUrl: source.detailsUrl }
        : {}),
      ...(status === "pending_review" ? { status: "needs_review" } : {}),
    })
    .where(eq(products.id, product.id));

  if (status === "applied") {
    await applyDecision(decision.id, campaignEndsAt);
  }

  return { id: decision.id, status };
}

/** آیا تصمیم توسط ناظر SystemOne رد شده؟ (وضعیت rejected یا لاگ supervisor با verdict=reject) */
export function isSupervisorRejected(d: {
  status: string;
  steps: { step: string; message?: string; data?: Record<string, unknown> }[];
}): boolean {
  if (d.status === "rejected") return true;
  const sup = d.steps.find((s) => s.step === "supervisor");
  if (!sup) return false;
  const verdict = (sup.data as { verdict?: string } | undefined)?.verdict;
  if (verdict === "reject") return true;
  if (typeof sup.message === "string" && sup.message.includes("⛔ رد کامل")) return true;
  return false;
}

export async function applyDecision(
  decisionId: number,
  campaignEndsAt?: Date | null,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; message: string }> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d || !d.finalPrice || !d.basePrice) return { ok: false, message: "تصمیم نامعتبر" };
  const [p] = await db.select().from(products).where(eq(products.id, d.productId)).limit(1);
  if (!p) return { ok: false, message: "محصول یافت نشد" };
  if (d.source !== "torob" && d.source !== "manual") {
    return { ok: false, message: `اعمال تصمیم با منبع «${d.source}» ممنوع است؛ فقط تصمیم‌های مبتنی بر داده واقعی ترب یا ورود دستی مجاز به ارسال به فروشگاه‌اند` };
  }
  // منطق اصلاح‌شده رد/ریویو: تصمیم ردشده توسط ناظر بالاسر هرگز (حتی با تأیید انسانی اشتباهی)
  // به فروشگاه ارسال نمی‌شود، مگر با force صریح که در لاگ ثبت می‌شود.
  if (isSupervisorRejected({ status: d.status, steps: (d.steps ?? []) as { step: string; message?: string }[] }) && !opts?.force) {
    return {
      ok: false,
      message: "این تصمیم توسط ناظر SystemOne رد شده (امتیاز زیر آستانه رد) و قابل اعمال نیست. برای بازبینی، محصول را با منبع/قیمت اصلاح و دوباره استعلام بگیرید.",
    };
  }

  const effectiveCost = d.effectiveCostPrice ?? p.costPrice ?? 0;
  if (effectiveCost > 0 && d.finalPrice <= effectiveCost) {
    return {
      ok: false,
      message: `خطای خط قرمز سود: قیمت فروش (${d.finalPrice.toLocaleString("fa-IR")}) نمی‌تواند کمتر یا مساوی قیمت خرید/تامین (${effectiveCost.toLocaleString("fa-IR")}) باشد`,
    };
  }

  await db
    .update(products)
    .set({
      currentBasePrice: d.basePrice,
      currentFinalPrice: d.finalPrice,
      currentDiscountPct: d.discountPct,
      currentCampaign: d.campaignType,
      currentCampaignName: d.campaignName,
      currentBadgeTheme: d.badgeTheme ?? "green-orange",
      currentShowInFeatured: d.showInFeatured ?? false,
      lastDecisionId: d.id,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(products.id, p.id));

  const push = await pushToStore({
    productId: p.id,
    sku: p.sku,
    storeExternalId: p.storeExternalId,
    effectiveCostPrice: effectiveCost,
    hardFloorPrice: d.hardFloorPrice ?? p.currentHardFloorPrice ?? 0,
    monitoredMarketCeiling: d.monitoredMarketCeiling ?? d.basePrice,
    basePrice: d.basePrice,
    finalPrice: d.finalPrice,
    discountPct: d.discountPct ?? 0,
    campaignType: d.campaignType ?? "none",
    campaignName: d.campaignName,
    badgeTheme: d.badgeTheme ?? "green-orange",
    showInFeatured: d.showInFeatured ?? false,
    campaignEndsAt: campaignEndsAt ? campaignEndsAt.toISOString() : null,
    decisionId: d.id,
    confidence: d.confidence,
    projectedNationalRank: d.projectedNationalRank,
    projectedLocalRank: d.projectedLocalRank,
    competitionTier: d.competitionTier,
  });

  await db
    .update(priceDecisions)
    .set({
      status: "applied",
      pushStatus: push.skipped ? "skipped" : push.ok ? "pushed" : "failed",
      pushError: push.ok ? null : push.message,
      pushedAt: new Date(),
    })
    .where(eq(priceDecisions.id, d.id));

  await logActivity(
    "apply",
    `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف نهایی ${d.finalPrice} | کمپین: ${d.campaignType} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${opts?.force ? " (اعمال اجباری انسانی با force)" : ""}`,
    { decisionId: d.id, forced: !!opts?.force },
    push.ok ? "info" : "warn",
  );
  return push;
}

export async function rejectDecision(decisionId: number): Promise<void> {
  const [d] = await db.select().from(priceDecisions).where(eq(priceDecisions.id, decisionId)).limit(1);
  if (!d) return;
  await db.update(priceDecisions).set({ status: "rejected" }).where(eq(priceDecisions.id, decisionId));
  await db.update(products).set({ status: "active", updatedAt: new Date() }).where(eq(products.id, d.productId));
  await logActivity("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}
