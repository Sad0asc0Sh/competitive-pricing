"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPricing = runPricing;
exports.isSupervisorRejected = isSupervisorRejected;
exports.applyDecision = applyDecision;
exports.rejectDecision = rejectDecision;
const db_1 = require("@/db");
const schema_1 = require("../../db/schema");
const client_1 = require("../ai/client");
const config_1 = require("../ai/config");
const campaigns_1 = require("../pricing/campaigns");
const engine_1 = require("../pricing/engine");
const systemone_supervisor_1 = require("../pricing/systemone-supervisor");
const registry_1 = require("../sources/registry");
const connectors_1 = require("../store/connectors");
const drizzle_orm_1 = require("drizzle-orm");
const bootstrap_1 = require("./bootstrap");
/** تبدیل ایمن مقادیر موتور به عدد صحیح/اعشاری معتبر قبل از درج در دیتابیس (NaN/Infinity هرگز درج نشود) */
const safeInt = (v) => v == null || !Number.isFinite(v) ? null : Math.round(v);
const safeReal = (v, fallback = 0) => v == null || !Number.isFinite(v) ? fallback : v;
async function runPricing(opts) {
    await (0, bootstrap_1.ensureDefaults)();
    const conds = [(0, drizzle_orm_1.eq)(schema_1.products.status, "active")];
    if (opts.productIds?.length)
        conds.push((0, drizzle_orm_1.inArray)(schema_1.products.id, opts.productIds));
    if (opts.category)
        conds.push((0, drizzle_orm_1.eq)(schema_1.products.category, opts.category));
    let targets = opts.productIds?.length && opts.trigger !== "schedule"
        ? await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.inArray)(schema_1.products.id, opts.productIds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id))
        : await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.and)(...conds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
    // گارد سیستم واقعی: محصولات «متوقف‌شده» (paused) هرگز حتی با اجرای دستی/API قیمت‌گذاری نمی‌شوند
    // (محصولات needs_review با اجرای دستی مجازند تا پس از اصلاح منبع/قیمت دوباره استعلام شوند).
    targets = targets.filter((p) => p.status !== "paused");
    if (opts.cardRangeFrom || opts.cardRangeTo) {
        const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
        const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : targets.length;
        targets = targets.slice(startIdx, endIdx);
    }
    const [run] = await db_1.db
        .insert(schema_1.priceRuns)
        .values({ trigger: opts.trigger, scheduleId: opts.scheduleId, totalProducts: targets.length })
        .returning();
    const summary = {
        runId: run.id,
        total: targets.length,
        applied: 0,
        pendingReview: 0,
        failed: 0,
        decisionIds: [],
    };
    const campaigns = await db_1.db.select().from(schema_1.discountCampaigns);
    const allocatedCounts = {};
    // پردازش موازی محدود (پیش‌فرض ۳ محصول هم‌زمان، با PRICING_RUN_CONCURRENCY قابل تنظیم ۱..۸).
    // تخصیص کمپین (pickCampaign + افزایش allocatedCounts) کاملاً همگام (بدون await در میان) انجام
    // می‌شود، پس سقف maxCards کمپین‌ها در اجرای موازی هم دقیق می‌ماند؛ با مقدار ۱ رفتار کاملاً ترتیبی قبلی برمی‌گردد.
    const concurrency = Math.max(1, Math.min(8, Number(process.env.PRICING_RUN_CONCURRENCY ?? 3) || 3));
    let nextIdx = 0;
    const worker = async () => {
        for (;;) {
            const idx = nextIdx++;
            if (idx >= targets.length)
                return;
            const product = targets[idx];
            const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
            try {
                const decisionId = await priceOneProduct(product, run.id, campaigns, cardIndex, allocatedCounts, opts.manualOffers, opts.manualSupplierQuotes);
                summary.decisionIds.push(decisionId.id);
                if (decisionId.status === "applied")
                    summary.applied++;
                else if (decisionId.status === "pending_review")
                    summary.pendingReview++;
                else
                    summary.failed++;
            }
            catch (e) {
                summary.failed++;
                await (0, bootstrap_1.logActivity)("runner", `خطا در قیمت‌گذاری محصول ${product.sku}: ${e instanceof Error ? e.message : String(e)}`, { productId: product.id }, "error");
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
    await db_1.db
        .update(schema_1.priceRuns)
        .set({
        status: "done",
        applied: summary.applied,
        pendingReview: summary.pendingReview,
        failed: summary.failed,
        finishedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.priceRuns.id, run.id));
    await (0, bootstrap_1.logActivity)("runner", `اجرای #${run.id} پایان یافت: ${summary.applied} اعمال، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا`, { ...summary });
    return summary;
}
const SUPERVISOR_REASON_PREFIXES = [
    "رد توسط ناظر بالاسر SystemOne",
    "ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد",
];
/**
 * پس از دریافت پاسخ واقعی API ناظر (enrichment)، حکم/دلایل/گام ثبت‌شده را دوباره همگام می‌کند
 * تا منطق «رد کامل ↔ ریویو ↔ اعمال خودکار» دقیقاً بر اساس پاسخ زندهٔ ناظر اعمال شود
 * و چیزی در دیتابیس/صفحه ریویو ناهمخوان نماند.
 */
function syncSupervisorAfterEnrichment(result, sourceOk) {
    const sup = result.supervisor;
    result.reviewReasons = result.reviewReasons.filter((r) => !SUPERVISOR_REASON_PREFIXES.some((p) => r.startsWith(p)));
    if (sup.verdict === "reject") {
        result.reviewReasons.push(`رد توسط ناظر بالاسر SystemOne (امتیاز ${sup.overallScorePct}% < ${sup.rejectBelowPct}%)`);
    }
    else if (sup.verdict === "review") {
        result.reviewReasons.push(`ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${sup.overallScorePct}% بین ${sup.rejectBelowPct}% و ${sup.approveAbovePct}%)`);
    }
    result.rejectedBySupervisor = sup.verdict === "reject";
    result.needsReview =
        result.reviewReasons.length > 0 ||
            !sourceOk ||
            result.supply.effectiveCostPrice <= 0 ||
            result.rejectedBySupervisor ||
            sup.verdict !== "approve";
    const level = sup.verdict === "reject" ? "error" : sup.verdict === "review" ? "warn" : "info";
    const apiBadge = sup.apiStatus === "ok"
        ? `API زنده SubQ (${sup.model})`
        : sup.apiStatus === "error"
            ? `خطای اتصال API ناظر: ${sup.apiError ?? "نامشخص"}`
            : sup.apiStatus === "not_configured"
                ? "توکن SubQ ثبت نشده — موتور آنی محلی فعال است"
                : "موتور آنی محلی (بدون فراخوانی API)";
    const stepLog = {
        step: "supervisor",
        title: "ناظر و تصمیم‌گیرنده بالاسر (SubQ SystemOne — ۴ مقیاس)",
        message: `${sup.summary} | وضعیت اتصال: ${apiBadge} | ` +
            Object.values(sup.gates)
                .map((g) => `${g.key}: ${g.scorePct}% (noul=${g.noul.toFixed(2)} → ${g.verdict})`)
                .join(" · "),
        level,
        data: {
            overallScorePct: sup.overallScorePct,
            overallNoul: sup.overallNoul,
            verdict: sup.verdict,
            gates: sup.gates,
            apiStatus: sup.apiStatus ?? null,
            apiError: sup.apiError ?? null,
        },
    };
    const idx = result.steps.findIndex((s) => s.step === "supervisor");
    if (idx >= 0)
        result.steps[idx] = stepLog;
    else
        result.steps.push(stepLog);
}
async function priceOneProduct(product, runId, campaigns, cardIndex, allocatedCounts, manualOffers, manualSupplierQuotes) {
    // گارد سیستم واقعی: فقط منبع واقعی ترب (یا پیشنهادهای دستی همین اجرا) مجاز است.
    // محصولات قدیمی با منبع حذف‌شده/شبیه‌سازی (مثل mock) هرگز تصمیم قیمتی نمی‌گیرند
    // و قیمتشان به فروشگاه ارسال نمی‌شود؛ اجرا برای آن‌ها با خطای شفاف متوقف می‌شود.
    if (!manualOffers?.length && !(0, registry_1.isAllowedSourceType)(product.sourceType)) {
        throw new Error(`منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`);
    }
    const { config } = await (0, bootstrap_1.getProfileConfig)(product.profileId);
    const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];
    const source = await (0, registry_1.fetchFromSource)({
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
    }, manualOffers);
    const result = (0, engine_1.runPricingPipeline)(source, {
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
    // ناظر بالاسر با توکن واقعی (پنل تنظیمات/دیتابیس یا env) همین‌جا به API زنده SubQ SystemOne وصل می‌شود؛
    // توکن/آدرس سرور/مدل از پنل تنظیمات (دیتابیس) با اولویت بالاتر از پروفایل و env خوانده می‌شود.
    if (config.supervisor.enabled) {
        const subqRuntime = await (0, config_1.resolveSubqRuntime)(config.supervisor);
        result.supervisor = await (0, systemone_supervisor_1.enrichSupervisorWithSubqApi)(result.supervisor, {
            ...config.supervisor,
            apiKey: subqRuntime.apiKey,
            baseUrl: subqRuntime.baseUrl,
            model: subqRuntime.model,
        });
        syncSupervisorAfterEnrichment(result, source.ok);
    }
    if (config.ai.enabled && result.finalPrice && result.confidence < config.ai.reviewBelowConfidence) {
        const review = await (0, client_1.reviewDecisionWithAI)({
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
                message: review.verdict === "adjust" && review.suggestedFinalPrice
                    ? `adjust (پیشنهاد AI: ${review.suggestedFinalPrice.toLocaleString("fa-IR")} تومان): ${review.reasoning}`
                    : `${review.verdict}: ${review.reasoning}`,
                level: review.verdict === "approve" ? "info" : "warn",
                data: review.suggestedFinalPrice ? { suggestedFinalPrice: review.suggestedFinalPrice } : undefined,
            });
            if (review.verdict === "reject") {
                result.needsReview = true;
                result.reviewReasons.push(`AI تصمیم را رد کرد: ${review.reasoning}`);
            }
            else if (review.verdict === "adjust") {
                // منطق اصلاح‌شده adjust: پیشنهاد AI هرگز مستقیم اعمال نمی‌شود؛ فقط به ریویو می‌رود.
                // اگر پیشنهاد AI زیر خط قرمز سود باشد، مثل reject رفتار می‌کنیم.
                const suggested = review.suggestedFinalPrice;
                const floor = result.supply.hardFloorPrice;
                const cost = result.supply.effectiveCostPrice;
                const unsafe = suggested == null || (floor > 0 && suggested < floor) || (cost > 0 && suggested <= cost);
                result.needsReview = true;
                result.reviewReasons.push(suggested != null
                    ? unsafe
                        ? `پیشنهاد AI (${suggested.toLocaleString("fa-IR")} تومان) زیر خط قرمز سود است و مردود شد`
                        : `AI اصلاح قیمت را پیشنهاد داد (${suggested.toLocaleString("fa-IR")} تومان): ${review.reasoning}`
                    : `AI نیاز به اصلاح دید: ${review.reasoning}`);
            }
        }
    }
    let campaignType = "none";
    let campaignName = null;
    let badgeTheme = "green-orange";
    let showInFeatured = false;
    let campaignEndsAt = null;
    if (result.discountPct != null && result.finalPrice) {
        const pick = (0, campaigns_1.pickCampaign)(campaigns, {
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
    const strictlyAboveCost = result.finalPrice != null &&
        result.supply.effectiveCostPrice > 0 &&
        result.finalPrice >= result.supply.hardFloorPrice &&
        result.finalPrice > result.supply.effectiveCostPrice;
    // اعمال دقیق حکم ۳ بازه‌ای ناظر بالاسر (SystemOne Supervisor):
    // - زیر 45% (reject): وضعیت "rejected" (رد کامل، وارد سایت نمی‌شود)
    // - بین 45% تا 80% (review): وضعیت "pending_review" (ارسال به بخش ریویو)
    // - بالای 80% (approve): در صورت رعایت خط قرمز سود و فعال بودن autoApply، وضعیت "applied" (ادامه کار و اعمال خودکار)
    let status;
    if (result.rejectedBySupervisor) {
        // رد کامل ناظر بالاسر (حتی اگر قیمتی تولید نشده باشد) → وضعیت rejected و ورود به فهرست ردشده‌ها
        status = "rejected";
    }
    else if (!result.finalPrice) {
        status = "failed";
    }
    else if (strictlyAboveCost && !result.needsReview && product.autoApply) {
        status = "applied";
    }
    else {
        status = "pending_review";
    }
    const [decision] = await db_1.db
        .insert(schema_1.priceDecisions)
        .values({
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
        steps: result.steps,
    })
        .returning();
    if (result.offers.length) {
        await db_1.db.insert(schema_1.competitorOffers).values(result.offers.map((o) => ({
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
        })));
    }
    await db_1.db
        .update(schema_1.products)
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
        .where((0, drizzle_orm_1.eq)(schema_1.products.id, product.id));
    if (status === "applied") {
        await applyDecision(decision.id, campaignEndsAt);
    }
    return { id: decision.id, status };
}
/** آیا تصمیم توسط ناظر SystemOne رد شده؟ (وضعیت rejected یا لاگ supervisor با verdict=reject) */
function isSupervisorRejected(d) {
    if (d.status === "rejected")
        return true;
    const sup = d.steps.find((s) => s.step === "supervisor");
    if (!sup)
        return false;
    const verdict = sup.data?.verdict;
    if (verdict === "reject")
        return true;
    if (typeof sup.message === "string" && sup.message.includes("⛔ رد کامل"))
        return true;
    return false;
}
async function applyDecision(decisionId, campaignEndsAt, opts) {
    const [d] = await db_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d || !d.finalPrice || !d.basePrice)
        return { ok: false, message: "تصمیم نامعتبر" };
    const [p] = await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId)).limit(1);
    if (!p)
        return { ok: false, message: "محصول یافت نشد" };
    if (d.source !== "torob" && d.source !== "manual") {
        return { ok: false, message: `اعمال تصمیم با منبع «${d.source}» ممنوع است؛ فقط تصمیم‌های مبتنی بر داده واقعی ترب یا ورود دستی مجاز به ارسال به فروشگاه‌اند` };
    }
    // منطق اصلاح‌شده رد/ریویو: تصمیم ردشده توسط ناظر بالاسر هرگز (حتی با تأیید انسانی اشتباهی)
    // به فروشگاه ارسال نمی‌شود، مگر با force صریح که در لاگ ثبت می‌شود.
    if (isSupervisorRejected({ status: d.status, steps: (d.steps ?? []) }) && !opts?.force) {
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
    // بازبینی دوباره خط قرمز فروش در «لحظه اعمال»: ممکن است قیمت تامین/خط قرمز پس از ساخت تصمیم تغییر کرده باشد؛
    // بدون force انسانی هرگز اجازه نمی‌دهیم قیمتی زیر خط قرمز جدید به فروشگاه ارسال شود.
    const effectiveFloor = Math.max(d.hardFloorPrice ?? 0, p.currentHardFloorPrice ?? 0);
    if (effectiveFloor > 0 && d.finalPrice < effectiveFloor && !opts?.force) {
        return {
            ok: false,
            message: `خط قرمز فروش بروزرسانی شده است: قیمت نهایی (${d.finalPrice.toLocaleString("fa-IR")}) از خط قرمز فعلی (${effectiveFloor.toLocaleString("fa-IR")}) کمتر است. ابتدا استعلام جدید بگیرید یا با تأیید اجباری (force) اعمال کنید.`,
        };
    }
    await db_1.db
        .update(schema_1.products)
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
        .where((0, drizzle_orm_1.eq)(schema_1.products.id, p.id));
    const push = await (0, connectors_1.pushToStore)({
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
    await db_1.db
        .update(schema_1.priceDecisions)
        .set({
        status: "applied",
        pushStatus: push.skipped ? "skipped" : push.ok ? "pushed" : "failed",
        pushError: push.ok ? null : push.message,
        pushedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
    await (0, bootstrap_1.logActivity)("apply", `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف نهایی ${d.finalPrice} | کمپین: ${d.campaignType} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${opts?.force ? " (اعمال اجباری انسانی با force)" : ""}`, { decisionId: d.id, forced: !!opts?.force }, push.ok ? "info" : "warn");
    return push;
}
async function rejectDecision(decisionId) {
    const [d] = await db_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d)
        return;
    await db_1.db.update(schema_1.priceDecisions).set({ status: "rejected" }).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId));
    await db_1.db.update(schema_1.products).set({ status: "active", updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId));
    await (0, bootstrap_1.logActivity)("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}
