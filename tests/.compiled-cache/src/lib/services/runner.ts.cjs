"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyDecision = applyDecision;
exports.rejectDecision = rejectDecision;
exports.runPricing = runPricing;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _client = require("../ai/client");
var _campaigns = require("../pricing/campaigns");
var _engine = require("../pricing/engine");
var _systemoneSupervisor = require("../pricing/systemone-supervisor");
var _registry = require("../sources/registry");
var _connectors = require("../store/connectors");
var _drizzleOrm = require("drizzle-orm");
var _bootstrap = require("./bootstrap");
async function runPricing(opts) {
  await (0, _bootstrap.ensureDefaults)();
  const conds = [(0, _drizzleOrm.eq)(_schema.products.status, "active")];
  if (opts.productIds?.length) conds.push((0, _drizzleOrm.inArray)(_schema.products.id, opts.productIds));
  if (opts.category) conds.push((0, _drizzleOrm.eq)(_schema.products.category, opts.category));
  let targets = opts.productIds?.length && opts.trigger !== "schedule" ? await _db.db.select().from(_schema.products).where((0, _drizzleOrm.inArray)(_schema.products.id, opts.productIds)).orderBy((0, _drizzleOrm.asc)(_schema.products.id)) : await _db.db.select().from(_schema.products).where((0, _drizzleOrm.and)(...conds)).orderBy((0, _drizzleOrm.asc)(_schema.products.id));
  if (opts.cardRangeFrom || opts.cardRangeTo) {
    const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
    const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : targets.length;
    targets = targets.slice(startIdx, endIdx);
  }
  const [run] = await _db.db.insert(_schema.priceRuns).values({
    trigger: opts.trigger,
    scheduleId: opts.scheduleId,
    totalProducts: targets.length
  }).returning();
  const summary = {
    runId: run.id,
    total: targets.length,
    applied: 0,
    pendingReview: 0,
    failed: 0,
    decisionIds: []
  };
  const campaigns = await _db.db.select().from(_schema.discountCampaigns);
  const allocatedCounts = {};
  for (let idx = 0; idx < targets.length; idx++) {
    const product = targets[idx];
    const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
    try {
      const decisionId = await priceOneProduct(product, run.id, campaigns, cardIndex, allocatedCounts, opts.manualOffers, opts.manualSupplierQuotes);
      summary.decisionIds.push(decisionId.id);
      if (decisionId.status === "applied") summary.applied++;else if (decisionId.status === "pending_review") summary.pendingReview++;else summary.failed++;
    } catch (e) {
      summary.failed++;
      await (0, _bootstrap.logActivity)("runner", `خطا در قیمت‌گذاری محصول ${product.sku}: ${e instanceof Error ? e.message : String(e)}`, {
        productId: product.id
      }, "error");
    }
  }
  await _db.db.update(_schema.priceRuns).set({
    status: "done",
    applied: summary.applied,
    pendingReview: summary.pendingReview,
    failed: summary.failed,
    finishedAt: new Date()
  }).where((0, _drizzleOrm.eq)(_schema.priceRuns.id, run.id));
  await (0, _bootstrap.logActivity)("runner", `اجرای #${run.id} پایان یافت: ${summary.applied} اعمال، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا`, {
    ...summary
  });
  return summary;
}
async function priceOneProduct(product, runId, campaigns, cardIndex, allocatedCounts, manualOffers, manualSupplierQuotes) {
  const {
    config
  } = await (0, _bootstrap.getProfileConfig)(product.profileId);
  const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];
  const source = await (0, _registry.fetchFromSource)({
    id: product.id,
    sku: product.sku,
    name: product.name,
    sourceType: product.sourceType,
    torobUrl: product.torobUrl,
    torobPrk: product.torobPrk,
    torobDetailsUrl: product.torobDetailsUrl,
    costPrice: product.costPrice,
    supplierQuotes,
    currentFinalPrice: product.currentFinalPrice
  }, manualOffers);
  const result = (0, _engine.runPricingPipeline)(source, {
    productId: product.id,
    productName: product.name,
    costPrice: product.costPrice,
    supplierQuotes,
    minMarginPctOverride: product.minMarginPct,
    minProfitAmountOverride: product.minProfitAmount,
    currentFinalPrice: product.currentFinalPrice,
    category: product.category,
    config
  });

  // در صورتی که کلید SUBQ_API_KEY تنظیم شده باشد، ناظر بالاسر با API زنده SubQ SystemOne نیز غنی‌سازی می‌شود
  if (config.supervisor.enabled) {
    result.supervisor = await (0, _systemoneSupervisor.enrichSupervisorWithSubqApi)(result.supervisor, config.supervisor);
    if (result.supervisor.verdict === "reject") {
      result.rejectedBySupervisor = true;
      result.needsReview = true;
    } else if (result.supervisor.verdict === "review") {
      result.needsReview = true;
    }
  }
  if (config.ai.enabled && result.finalPrice && result.confidence < config.ai.reviewBelowConfidence) {
    const review = await (0, _client.reviewDecisionWithAI)({
      productName: product.name,
      costPrice: result.supply.effectiveCostPrice,
      offers: result.offers.map(o => ({
        shopName: o.shopName,
        price: o.price,
        included: o.included,
        excludeReason: o.excludeReason
      })),
      referencePrice: result.referencePrice,
      finalPrice: result.finalPrice,
      basePrice: result.basePrice,
      reviewReasons: result.reviewReasons
    });
    if (review) {
      result.steps.push({
        step: "ai_review",
        title: "بازبینی هوش مصنوعی مکمل",
        message: `${review.verdict}: ${review.reasoning}`,
        level: review.verdict === "approve" ? "info" : "warn"
      });
      if (review.verdict === "reject") {
        result.needsReview = true;
        result.reviewReasons.push("AI تصمیم را رد کرد");
      }
    }
  }
  let campaignType = "none";
  let campaignName = null;
  let badgeTheme = "green-orange";
  let showInFeatured = false;
  let campaignEndsAt = null;
  if (result.discountPct != null && result.finalPrice) {
    const pick = (0, _campaigns.pickCampaign)(campaigns, {
      discountPct: result.discountPct,
      category: product.category,
      productId: product.id,
      cardIndex,
      finalPrice: result.finalPrice,
      projectedLocalRank: result.position.projectedLocalRank,
      projectedNationalRank: result.position.projectedNationalRank,
      preferredCampaignType: product.preferredCampaignType,
      allocatedCounts
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
        cardIndex
      }
    });
  }
  const strictlyAboveCost = result.finalPrice != null && result.supply.effectiveCostPrice > 0 && result.finalPrice >= result.supply.hardFloorPrice && result.finalPrice > result.supply.effectiveCostPrice;

  // اعمال دقیق حکم ۳ بازه‌ای ناظر بالاسر (SystemOne Supervisor):
  // - زیر 45% (reject): وضعیت "rejected" (رد کامل، وارد سایت نمی‌شود)
  // - بین 45% تا 80% (review): وضعیت "pending_review" (ارسال به بخش ریویو)
  // - بالای 80% (approve): در صورت رعایت خط قرمز سود و فعال بودن autoApply، وضعیت "applied" (ادامه کار و اعمال خودکار)
  let status;
  if (!result.finalPrice) {
    status = "failed";
  } else if (result.rejectedBySupervisor) {
    status = "rejected";
  } else if (strictlyAboveCost && !result.needsReview && product.autoApply) {
    status = "applied";
  } else {
    status = "pending_review";
  }
  const [decision] = await _db.db.insert(_schema.priceDecisions).values({
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
    steps: result.steps
  }).returning();
  if (result.offers.length) {
    await _db.db.insert(_schema.competitorOffers).values(result.offers.map(o => ({
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
      weight: o.weight
    })));
  }
  await _db.db.update(_schema.products).set({
    lastCheckedAt: new Date(),
    lastDecisionId: decision.id,
    updatedAt: new Date(),
    ...(!result.supply.usedMarketConsensusFloor && result.supply.effectiveCostPrice > 0 ? {
      costPrice: result.supply.effectiveCostPrice
    } : {}),
    selectedSupplierName: result.supply.usedMarketConsensusFloor ? "کشف هوشمند از ترب (قیمت‌گذار معیار)" : result.supply.selectedQuote?.supplierName ?? product.selectedSupplierName ?? null,
    ...(result.supply.hardFloorPrice > 0 ? {
      currentHardFloorPrice: result.supply.hardFloorPrice
    } : {}),
    // قفل کردن PRK در دیتابیس فقط زمانی که گیت هویت ناظر (identity_match) رد نشده باشد!
    ...(source.prk && !product.torobPrk && result.supervisor.gates.identity_match?.verdict !== "reject" ? {
      torobPrk: source.prk
    } : {}),
    ...(source.detailsUrl && !product.torobDetailsUrl && result.supervisor.gates.identity_match?.verdict !== "reject" ? {
      torobDetailsUrl: source.detailsUrl
    } : {}),
    ...(status === "pending_review" ? {
      status: "needs_review"
    } : {})
  }).where((0, _drizzleOrm.eq)(_schema.products.id, product.id));
  if (status === "applied") {
    await applyDecision(decision.id, campaignEndsAt);
  }
  return {
    id: decision.id,
    status
  };
}
async function applyDecision(decisionId, campaignEndsAt) {
  const [d] = await _db.db.select().from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, decisionId)).limit(1);
  if (!d || !d.finalPrice || !d.basePrice) return {
    ok: false,
    message: "تصمیم نامعتبر"
  };
  const [p] = await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, d.productId)).limit(1);
  if (!p) return {
    ok: false,
    message: "محصول یافت نشد"
  };
  const effectiveCost = d.effectiveCostPrice ?? p.costPrice ?? 0;
  if (effectiveCost > 0 && d.finalPrice <= effectiveCost) {
    return {
      ok: false,
      message: `خطای خط قرمز سود: قیمت فروش (${d.finalPrice.toLocaleString("fa-IR")}) نمی‌تواند کمتر یا مساوی قیمت خرید/تامین (${effectiveCost.toLocaleString("fa-IR")}) باشد`
    };
  }
  await _db.db.update(_schema.products).set({
    currentBasePrice: d.basePrice,
    currentFinalPrice: d.finalPrice,
    currentDiscountPct: d.discountPct,
    currentCampaign: d.campaignType,
    currentCampaignName: d.campaignName,
    currentBadgeTheme: d.badgeTheme ?? "green-orange",
    currentShowInFeatured: d.showInFeatured ?? false,
    lastDecisionId: d.id,
    status: "active",
    updatedAt: new Date()
  }).where((0, _drizzleOrm.eq)(_schema.products.id, p.id));
  const push = await (0, _connectors.pushToStore)({
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
    competitionTier: d.competitionTier
  });
  await _db.db.update(_schema.priceDecisions).set({
    status: "applied",
    pushStatus: push.skipped ? "skipped" : push.ok ? "pushed" : "failed",
    pushError: push.ok ? null : push.message,
    pushedAt: new Date()
  }).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, d.id));
  await (0, _bootstrap.logActivity)("apply", `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف نهایی ${d.finalPrice} | کمپین: ${d.campaignType} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}`, {
    decisionId: d.id
  }, push.ok ? "info" : "warn");
  return push;
}
async function rejectDecision(decisionId) {
  const [d] = await _db.db.select().from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, decisionId)).limit(1);
  if (!d) return;
  await _db.db.update(_schema.priceDecisions).set({
    status: "rejected"
  }).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, decisionId));
  await _db.db.update(_schema.products).set({
    status: "active",
    updatedAt: new Date()
  }).where((0, _drizzleOrm.eq)(_schema.products.id, d.productId));
  await (0, _bootstrap.logActivity)("apply", `تصمیم #${decisionId} رد شد`, {
    decisionId
  });
}