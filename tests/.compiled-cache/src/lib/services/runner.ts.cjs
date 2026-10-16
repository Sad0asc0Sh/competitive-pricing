"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyDecision = applyDecision;
exports.cleanupWrongTimedSaleCards = cleanupWrongTimedSaleCards;
exports.isSupervisorRejected = isSupervisorRejected;
exports.rejectDecision = rejectDecision;
exports.runPricing = runPricing;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _client = require("../ai/client");
var _config = require("../ai/config");
var _campaigns = require("../pricing/campaigns");
var _engine = require("../pricing/engine");
var _systemoneSupervisor = require("../pricing/systemone-supervisor");
var _registry = require("../sources/registry");
var _connectors = require("../store/connectors");
var _drizzleOrm = require("drizzle-orm");
var _bootstrap = require("./bootstrap");
/** تبدیل ایمن مقادیر موتور به عدد صحیح/اعشاری معتبر قبل از درج در دیتابیس (NaN/Infinity هرگز درج نشود) */
const safeInt = v => v == null || !Number.isFinite(v) ? null : Math.round(v);
const safeReal = (v, fallback = 0) => v == null || !Number.isFinite(v) ? fallback : v;
async function runPricing(opts) {
  await (0, _bootstrap.ensureDefaults)();
  const conds = [(0, _drizzleOrm.eq)(_schema.products.status, "active")];
  if (opts.productIds?.length) conds.push((0, _drizzleOrm.inArray)(_schema.products.id, opts.productIds));
  if (opts.category) conds.push((0, _drizzleOrm.eq)(_schema.products.category, opts.category));
  let targets = opts.productIds?.length && opts.trigger !== "schedule" ? await _db.db.select().from(_schema.products).where((0, _drizzleOrm.inArray)(_schema.products.id, opts.productIds)).orderBy((0, _drizzleOrm.asc)(_schema.products.id)) : await _db.db.select().from(_schema.products).where((0, _drizzleOrm.and)(...conds)).orderBy((0, _drizzleOrm.asc)(_schema.products.id));
  targets = targets.filter(p => p.status !== "paused");
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
    decisionIds: [],
    lastError: null
  };
  const campaigns = await _db.db.select().from(_schema.discountCampaigns);
  const allocatedCounts = {};
  const concurrency = Math.max(1, Math.min(8, Number(process.env.PRICING_RUN_CONCURRENCY ?? 3) || 3));
  let nextIdx = 0;
  const worker = async () => {
    for (;;) {
      const idx = nextIdx++;
      if (idx >= targets.length) return;
      const product = targets[idx];
      const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
      try {
        const decisionOut = await priceOneProduct(product, run.id, campaigns, cardIndex, allocatedCounts, opts.manualOffers, opts.manualSupplierQuotes);
        summary.decisionIds.push(decisionOut.id);
        if (decisionOut.status === "applied") summary.applied++;else if (decisionOut.status === "pending_review") summary.pendingReview++;else {
          summary.failed++;
          if (decisionOut.errorHint && !summary.lastError) {
            summary.lastError = decisionOut.errorHint;
          }
        }
      } catch (e) {
        summary.failed++;
        const errMsg = e instanceof Error ? e.message : String(e);
        if (!summary.lastError) summary.lastError = errMsg;
        await (0, _bootstrap.logActivity)("runner", `خطا در قیمت‌گذاری محصول ${product.sku}: ${errMsg}`, {
          productId: product.id
        }, "error");
      }
    }
  };
  await Promise.all(Array.from({
    length: Math.min(concurrency, Math.max(1, targets.length))
  }, () => worker()));
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
const SUPERVISOR_REASON_PREFIXES = ["رد توسط ناظر بالاسر SystemOne", "ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد"];
function syncSupervisorAfterEnrichment(result, sourceOk) {
  const sup = result.supervisor;
  result.reviewReasons = result.reviewReasons.filter(r => !SUPERVISOR_REASON_PREFIXES.some(p => r.startsWith(p)));
  if (sup.verdict === "reject") {
    result.reviewReasons.push(`رد توسط ناظر بالاسر SystemOne (امتیاز ${sup.overallScorePct}% < ${sup.rejectBelowPct}%)`);
  } else if (sup.verdict === "review") {
    result.reviewReasons.push(`ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${sup.overallScorePct}% بین ${sup.rejectBelowPct}% و ${sup.approveAbovePct}%)`);
  }
  result.rejectedBySupervisor = sup.verdict === "reject";
  result.needsReview = result.reviewReasons.length > 0 || !sourceOk || result.supply.effectiveCostPrice <= 0 || result.rejectedBySupervisor || sup.verdict !== "approve";
  const level = sup.verdict === "reject" ? "error" : sup.verdict === "review" ? "warn" : "info";
  const apiBadge = sup.apiStatus === "ok" ? `API زنده SubQ (${sup.model})` : sup.apiStatus === "error" ? `خطای اتصال API ناظر: ${sup.apiError ?? "نامشخص"}` : sup.apiStatus === "not_configured" ? "توکن SubQ ثبت نشده — موتور آنی محلی فعال است" : "موتور آنی محلی (بدون فراخوانی API)";
  const stepLog = {
    step: "supervisor",
    title: "ناظر و تصمیم‌گیرنده بالاسر (SubQ SystemOne — ۴ مقیاس)",
    message: `${sup.summary} | وضعیت اتصال: ${apiBadge} | ` + Object.values(sup.gates).map(g => `${g.key}: ${g.scorePct}% (noul=${g.noul.toFixed(2)} → ${g.verdict})`).join(" · "),
    level,
    data: {
      overallScorePct: sup.overallScorePct,
      overallNoul: sup.overallNoul,
      verdict: sup.verdict,
      gates: sup.gates,
      apiStatus: sup.apiStatus ?? null,
      apiError: sup.apiError ?? null
    }
  };
  const idx = result.steps.findIndex(s => s.step === "supervisor");
  if (idx >= 0) result.steps[idx] = stepLog;else result.steps.push(stepLog);
}
async function priceOneProduct(product, runId, campaigns, cardIndex, allocatedCounts, manualOffers, manualSupplierQuotes) {
  if (!manualOffers?.length && !(0, _registry.isAllowedSourceType)(product.sourceType)) {
    throw new Error(`منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`);
  }
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
    sku: product.sku,
    costPrice: product.costPrice,
    supplierQuotes,
    minMarginPctOverride: product.minMarginPct,
    minProfitAmountOverride: product.minProfitAmount,
    currentFinalPrice: product.currentFinalPrice,
    category: product.category,
    config
  });
  if (config.supervisor.enabled) {
    const subqRuntime = await (0, _config.resolveSubqRuntime)(config.supervisor);
    result.supervisor = await (0, _systemoneSupervisor.enrichSupervisorWithSubqApi)(result.supervisor, {
      ...config.supervisor,
      apiKey: subqRuntime.apiKey,
      baseUrl: subqRuntime.baseUrl,
      model: subqRuntime.model
    });
    syncSupervisorAfterEnrichment(result, source.ok);
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
        message: review.verdict === "adjust" && review.suggestedFinalPrice ? `adjust (پیشنهاد AI: ${review.suggestedFinalPrice.toLocaleString("fa-IR")} تومان): ${review.reasoning}` : `${review.verdict}: ${review.reasoning}`,
        level: review.verdict === "approve" ? "info" : "warn",
        data: review.suggestedFinalPrice ? {
          suggestedFinalPrice: review.suggestedFinalPrice
        } : undefined
      });
      if (review.verdict === "reject") {
        result.needsReview = true;
        result.reviewReasons.push(`AI تصمیم را رد کرد: ${review.reasoning}`);
      } else if (review.verdict === "adjust") {
        const suggested = review.suggestedFinalPrice;
        const floor = result.supply.hardFloorPrice;
        const cost = result.supply.effectiveCostPrice;
        const unsafe = suggested == null || floor > 0 && suggested < floor || cost > 0 && suggested <= cost;
        result.needsReview = true;
        result.reviewReasons.push(suggested != null ? unsafe ? `پیشنهاد AI (${suggested.toLocaleString("fa-IR")} تومان) زیر خط قرمز سود است و مردود شد` : `AI اصلاح قیمت را پیشنهاد داد (${suggested.toLocaleString("fa-IR")} تومان): ${review.reasoning}` : `AI نیاز به اصلاح دید: ${review.reasoning}`);
      }
    }
  }

  // گارد امنیتی مضاعف برای جلوگیری از تشخیص اشتباه کارت و اعمال خودکار کالاهای بدون قیمت خرید:
  // اگر محصول فاقد قیمت خرید همکار است (usedMarketConsensusFloor) و هنوز لینک/PRK ترب برای آن توسط مدیر تایید نشده است (!product.torobPrk)،
  // بار اول حتماً به صف بازبینی (pending_review) می‌رود تا کارت پیدا شده در ترب توسط مدیر تایید شود و سرخود وارد کمپین‌های سایت نگردد!
  const unverifiedFirstSearchWithoutCost = !product.torobPrk && !product.torobUrl && result.supply.usedMarketConsensusFloor;
  if (unverifiedFirstSearchWithoutCost && !result.rejectedBySupervisor) {
    result.needsReview = true;
    result.reviewReasons.push("اولین استعلام خودکار بدون لینک ترب و بدون قیمت خرید همکار — نیازمند یک‌بار تایید کارت ترب در صف بازبینی");
  }
  const strictlyAboveCost = result.finalPrice != null && result.supply.effectiveCostPrice > 0 && result.finalPrice >= result.supply.hardFloorPrice && result.finalPrice > result.supply.effectiveCostPrice;
  let status;
  if (result.rejectedBySupervisor) {
    status = "rejected";
  } else if (!result.finalPrice) {
    status = "failed";
  } else if (strictlyAboveCost && !result.needsReview && product.autoApply) {
    status = "applied";
  } else {
    status = "pending_review";
  }
  let campaignType = "none";
  let campaignName = null;
  let badgeTheme = "green-orange";
  let showInFeatured = false;
  let campaignEndsAt = null;

  // تخصیص کمپین فقط زمانی انجام می‌شود که تصمیم رد یا خطادار نباشد!
  if (status !== "rejected" && status !== "failed" && result.discountPct != null && result.finalPrice) {
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
    if (status === "applied" && pick.campaignId != null && pick.type !== "none") {
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
  const [decision] = await _db.db.insert(_schema.priceDecisions).values({
    runId,
    productId: product.id,
    source: source.source,
    offersTotal: safeInt(result.offersTotal) ?? 0,
    offersUsed: safeInt(result.offersUsed) ?? 0,
    effectiveCostPrice: safeInt(result.supply.effectiveCostPrice),
    hardFloorPrice: safeInt(result.supply.hardFloorPrice),
    lowestRaw: safeInt(result.lowestRaw),
    lowestValid: safeInt(result.lowestValid),
    localLowestValid: safeInt(result.position.localLowestPrice),
    marketMedian: safeInt(result.marketMedian),
    marketMean: safeInt(result.marketMean),
    referencePrice: safeInt(result.referencePrice),
    monitoredMarketCeiling: safeInt(result.floorCeiling.monitoredMarketCeiling),
    basePrice: safeInt(result.basePrice),
    finalPrice: safeInt(result.finalPrice),
    discountPct: safeReal(result.discountPct),
    campaignType,
    campaignName,
    badgeTheme,
    showInFeatured,
    strategy: result.strategy,
    competitionTier: result.position.competitionTier,
    projectedNationalRank: safeInt(result.position.projectedNationalRank),
    projectedLocalRank: safeInt(result.position.projectedLocalRank),
    netProfitToman: safeInt(result.position.netProfitToman),
    netMarginPct: safeReal(result.position.netMarginPct),
    confidence: safeReal(result.supervisor.enabled ? result.supervisor.overallNoul : result.confidence),
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

  // قفل کردن PRK در دیتابیس فقط زمانی که تصمیم اعمال شده یا گیت تطابق هویت بالای آستانه تایید خودکار (approve) باشد!
  const identityApproved = result.supervisor.gates.identity_match?.verdict === "approve";
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
    ...(source.prk && !product.torobPrk && identityApproved ? {
      torobPrk: source.prk
    } : {}),
    ...(source.detailsUrl && !product.torobDetailsUrl && identityApproved ? {
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
    status,
    errorHint: source.error ?? null
  };
}

/** آیا تصمیم توسط ناظر SystemOne رد شده؟ (وضعیت rejected یا لاگ supervisor با verdict=reject) */
function isSupervisorRejected(d) {
  if (d.status === "rejected") return true;
  const sup = d.steps.find(s => s.step === "supervisor");
  if (!sup) return false;
  const verdict = sup.data?.verdict;
  if (verdict === "reject") return true;
  if (typeof sup.message === "string" && sup.message.includes("⛔ رد کامل")) return true;
  return false;
}
async function applyDecision(decisionId, campaignEndsAt, opts) {
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
  if (d.source !== "torob" && d.source !== "manual") {
    return {
      ok: false,
      message: `اعمال تصمیم با منبع «${d.source}» ممنوع است؛ فقط تصمیم‌های مبتنی بر داده واقعی ترب یا ورود دستی مجاز به ارسال به فروشگاه‌اند`
    };
  }
  if (isSupervisorRejected({
    status: d.status,
    steps: d.steps ?? []
  }) && !opts?.force) {
    return {
      ok: false,
      message: "این تصمیم توسط ناظر SystemOne رد شده (امتیاز زیر آستانه رد) و قابل اعمال نیست. برای بازبینی، محصول را با منبع/قیمت اصلاح و دوباره استعلام بگیرید."
    };
  }
  const effectiveCost = d.effectiveCostPrice ?? p.costPrice ?? 0;
  if (effectiveCost > 0 && d.finalPrice <= effectiveCost) {
    return {
      ok: false,
      message: `خطای خط قرمز سود: قیمت فروش (${d.finalPrice.toLocaleString("fa-IR")}) نمی‌تواند کمتر یا مساوی قیمت خرید/تامین (${effectiveCost.toLocaleString("fa-IR")}) باشد`
    };
  }
  const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, p.currentHardFloorPrice ?? 0);
  if (effectiveFloor > 0 && d.finalPrice < effectiveFloor && !opts?.force) {
    return {
      ok: false,
      message: `خط قرمز فروش بروزرسانی شده است: قیمت نهایی (${d.finalPrice.toLocaleString("fa-IR")}) از خط قرمز فعلی (${effectiveFloor.toLocaleString("fa-IR")}) کمتر است. ابتدا استعلام جدید بگیرید یا با تأیید اجباری (force) اعمال کنید.`
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
    ...(d.source === "torob" && !p.torobPrk ? {} : {}),
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
  await (0, _bootstrap.logActivity)("apply", `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف نهایی ${d.finalPrice} | کمپین: ${d.campaignType} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${opts?.force ? " (اعمال اجباری انسانی با force)" : ""}`, {
    decisionId: d.id,
    forced: !!opts?.force
  }, push.ok ? "info" : "warn");
  return push;
}
async function rejectDecision(decisionId) {
  const [d] = await _db.db.select().from(_schema.priceDecisions).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, decisionId)).limit(1);
  if (!d) return;
  await _db.db.update(_schema.priceDecisions).set({
    status: "rejected",
    campaignType: "none",
    campaignName: null,
    showInFeatured: false
  }).where((0, _drizzleOrm.eq)(_schema.priceDecisions.id, decisionId));
  await _db.db.update(_schema.products).set({
    status: "active",
    updatedAt: new Date()
  }).where((0, _drizzleOrm.eq)(_schema.products.id, d.productId));
  await (0, _bootstrap.logActivity)("apply", `تصمیم #${decisionId} رد شد`, {
    decisionId
  });
}

/**
 * پاک‌سازی فوری کارت‌هایی که به اشتباه در دسته ۳ (فرصت‌های زمان‌دار / timed_sale) قرار گرفته‌اند
 * + حذف آن‌ها از کالکشن Sale در بک‌اند فروشگاه (ekgkala-backend) و ریست قفل ترب
 */
async function cleanupWrongTimedSaleCards(opts) {
  const targetRows = opts?.productId ? await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.id, opts.productId)) : await _db.db.select().from(_schema.products).where((0, _drizzleOrm.eq)(_schema.products.currentCampaign, "timed_sale"));
  const cleanedProducts = [];
  const storeResetResults = [];
  for (const p of targetRows) {
    const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
    await _db.db.update(_schema.products).set({
      currentCampaign: "none",
      currentCampaignName: null,
      currentDiscountPct: 0,
      currentShowInFeatured: false,
      currentBasePrice: safePrice > 0 ? safePrice : p.currentBasePrice,
      // اگر محصول قیمت خرید نداشت و به اشتباه به یک PRK ترب قفل شده بود، قفل PRK را آزاد کن تا دوباره تمیز استعلام شود
      ...(p.costPrice <= 0 ? {
        torobPrk: null,
        torobDetailsUrl: null,
        autoApply: false
      } : {}),
      status: "active",
      updatedAt: new Date()
    }).where((0, _drizzleOrm.eq)(_schema.products.id, p.id));
    await _db.db.update(_schema.priceDecisions).set({
      campaignType: "none",
      campaignName: null,
      showInFeatured: false,
      ...(p.costPrice <= 0 ? {
        status: "rejected"
      } : {})
    }).where((0, _drizzleOrm.eq)(_schema.priceDecisions.productId, p.id));
    cleanedProducts.push(`${p.name} (${p.sku})`);
    if (safePrice > 0) {
      const pushRes = await (0, _connectors.pushToStore)({
        productId: p.id,
        sku: p.sku,
        storeExternalId: p.storeExternalId,
        effectiveCostPrice: p.costPrice > 0 ? p.costPrice : Math.round(safePrice * 0.85),
        hardFloorPrice: p.currentHardFloorPrice ?? 0,
        monitoredMarketCeiling: safePrice,
        basePrice: safePrice,
        finalPrice: safePrice,
        discountPct: 0,
        campaignType: "none",
        campaignName: null,
        badgeTheme: "green-orange",
        showInFeatured: false,
        campaignEndsAt: null,
        decisionId: p.lastDecisionId ?? 0,
        confidence: 1
      });
      storeResetResults.push(`${p.sku}: ${pushRes.message}`);
    }
  }

  // غیرفعال کردن کمپین پیش‌فرض timed_sale اگر به صورت خودکار همه کارت‌های ۱ تا ۱۰۰ را با ۳٪ تخفیف می‌گرفت
  await _db.db.update(_schema.discountCampaigns).set({
    active: false,
    minDiscountPct: 10,
    cardRangeFrom: 21,
    cardRangeTo: 50
  }).where((0, _drizzleOrm.and)((0, _drizzleOrm.eq)(_schema.discountCampaigns.type, "timed_sale"), (0, _drizzleOrm.eq)(_schema.discountCampaigns.minDiscountPct, 3)));

  // ریست قفل ضدربات (Circuit Breaker Wall) روی سرور torob-mcp در صورت فعال بودن
  let mcpReset = false;
  const mcpUrl = (process.env.TOROB_MCP_URL ?? "http://127.0.0.1:3005/mcp").replace(/\/mcp\/?$/, "");
  try {
    const r = await fetch(`${mcpUrl}/reset`, {
      method: "POST",
      cache: "no-store"
    });
    mcpReset = r.ok;
  } catch {
    mcpReset = false;
  }
  await (0, _bootstrap.logActivity)("cleanup", `پاک‌سازی کمپین‌های زمان‌دار اشتباه انجام شد: ${cleanedProducts.length} کارت بازگردانی شد`, {
    cleanedProducts,
    storeResetResults,
    mcpReset
  });
  return {
    cleanedCount: cleanedProducts.length,
    cleanedProducts,
    storeResetResults,
    mcpReset
  };
}