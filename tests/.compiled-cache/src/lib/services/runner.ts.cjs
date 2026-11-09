"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPricing = runPricing;
exports.isSupervisorRejected = isSupervisorRejected;
exports.applyDecision = applyDecision;
exports.rejectDecision = rejectDecision;
exports.cleanupWrongTimedSaleCards = cleanupWrongTimedSaleCards;
const db_1 = require("@/db");
const schema_1 = require("../../db/schema");
const client_1 = require("../ai/client");
const config_1 = require("../ai/config");
const approval_1 = require("../pricing/approval");
const campaigns_1 = require("../pricing/campaigns");
const engine_1 = require("../pricing/engine");
const own_price_history_1 = require("../pricing/own-price-history");
const systemone_supervisor_1 = require("../pricing/systemone-supervisor");
const registry_1 = require("../sources/registry");
const connectors_1 = require("../store/connectors");
const drizzle_orm_1 = require("drizzle-orm");
const bootstrap_1 = require("./bootstrap");
/** تبدیل ایمن مقادیر موتور به عدد صحیح/اعشاری معتبر قبل از درج در دیتابیس (NaN/Infinity هرگز درج نشود) */
const safeInt = (v) => v == null || !Number.isFinite(v) ? null : Math.round(v);
const safeReal = (v, fallback = 0) => v == null || !Number.isFinite(v) ? fallback : v;
const DEFAULT_INTERVAL_MINUTES = 180;
/**
 * قفل نرم تک‌محصولی (P0-5): با یک UPDATE اتمی قفل «۵ دقیقه‌ای» گرفته می‌شود؛
 * اجرای موازی/کلاسترِ هم‌زمان هر محصول را حداکثر یک‌بار استعلام می‌کند.
 */
async function tryLockProduct(productId) {
    try {
        const res = await db_1.db.execute((0, drizzle_orm_1.sql) `update products set locked_until = now() + interval '5 minutes' where id = ${productId} and (locked_until is null or locked_until <= now()) returning id`);
        return (res.rows?.length ?? 0) > 0;
    }
    catch {
        // ۴.۱.۱: پس از مهاجرت 0001، نبود ستون یا هر خطای قفل نباید fail-open شود.
        // محصول در این اجرا skip می‌شود تا هرگز دو اجرای هم‌زمان روی یک محصول قیمت نگذارند.
        return false;
    }
}
async function unlockProduct(productId) {
    try {
        await db_1.db.execute((0, drizzle_orm_1.sql) `update products set locked_until = null where id = ${productId}`);
    }
    catch {
        // unlock نباید جریان را بشکند؛ قفل TTL خودش آزاد می‌شود
    }
}
/**
 * مرجع تخفیف بخش رو. (P3): بالاترین قیمت خودیِ «دوام‌یافته» در پنجره ۷ روزی + میانگین ۷ روزی.
 * ۴.۱.۱: دوام از فاصله‌ی هر ردیف تا ردیف بعدی سنجیده می‌شود (نه قدمت خود ردیف)، و فقط
 * تصمیم‌های `pushed` که واقعاً به فروشگاه رسیده‌اند مرجع‌اند؛ `skipped` هرگز.
 */
async function computeOwnDiscountContext(productId, windowDays, holdHours) {
    const now = new Date();
    const since = new Date(now.getTime() - Math.max(1, windowDays) * 86_400_000);
    try {
        const rows = await db_1.db
            .select({
            finalPrice: schema_1.priceDecisions.finalPrice,
            createdAt: schema_1.priceDecisions.createdAt,
            pushStatus: schema_1.priceDecisions.pushStatus,
        })
            .from(schema_1.priceDecisions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, productId), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.pushStatus, "pushed"), (0, drizzle_orm_1.gte)(schema_1.priceDecisions.createdAt, since)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.priceDecisions.createdAt));
        return (0, own_price_history_1.summarizeOwnPriceHistory)(rows, { now, holdHours, windowDays });
    }
    catch {
        return { ownStableHigh7d: null, ownAvg7d: null };
    }
}
/**
 * بازیابی تصمیم‌های «applied»ی که push آن‌ها (به‌دلیل کرش وسط اجرا) ثبت نشده است.
 * ۴.۱.۱: در شروع هر اجرا، ردیف‌های applied با push_status IS NULL و قدیمی‌تر از ۱۰ دقیقه
 * دوباره push می‌شوند؛ اگر تصمیم دیگر معتبر نباشد، صریحاً failed علامت می‌خورند.
 */
async function recoverStuckAppliedDecisions() {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    try {
        const stuck = await db_1.db
            .select()
            .from(schema_1.priceDecisions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.isNull)(schema_1.priceDecisions.pushStatus), (0, drizzle_orm_1.lt)(schema_1.priceDecisions.createdAt, cutoff)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.priceDecisions.id))
            .limit(50);
        for (const d of stuck) {
            // اگر تصمیم جدیدتری برای همین محصول با موفقیت push شده، بازپخش تصمیم قدیمی
            // قیمت فروشگاه را عقب می‌برد؛ قدیمی را failed (superseded) علامت می‌زنیم.
            const [newerPushed] = await db_1.db
                .select({ id: schema_1.priceDecisions.id })
                .from(schema_1.priceDecisions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, d.productId), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.pushStatus, "pushed"), (0, drizzle_orm_1.gt)(schema_1.priceDecisions.id, d.id)))
                .limit(1);
            if (newerPushed) {
                await db_1.db
                    .update(schema_1.priceDecisions)
                    .set({
                    pushStatus: "failed",
                    pushError: `تصمیم جدیدتر #${newerPushed.id} قبلاً push شده است (recovery superseded)`,
                    pushedAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
                continue;
            }
            const res = await applyDecision(d.id, null);
            if (!res.ok) {
                await db_1.db
                    .update(schema_1.priceDecisions)
                    .set({ pushStatus: "failed", pushError: res.message, pushedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
            }
        }
        if (stuck.length) {
            await (0, bootstrap_1.logActivity)("runner", `بازیابی ${stuck.length} تصمیم appliedِ بدون push_status انجام شد`, {
                decisionIds: stuck.map((d) => d.id),
            });
        }
        return stuck.length;
    }
    catch {
        return 0;
    }
}
async function runPricing(opts) {
    await (0, bootstrap_1.ensureDefaults)();
    await recoverStuckAppliedDecisions();
    const conds = [(0, drizzle_orm_1.eq)(schema_1.products.status, "active")];
    if (opts.productIds?.length)
        conds.push((0, drizzle_orm_1.inArray)(schema_1.products.id, opts.productIds));
    if (opts.category)
        conds.push((0, drizzle_orm_1.eq)(schema_1.products.category, opts.category));
    let targets = opts.productIds?.length && opts.trigger !== "schedule"
        ? await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.inArray)(schema_1.products.id, opts.productIds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id))
        : await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.and)(...conds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
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
        lastError: null,
    };
    const campaigns = await db_1.db.select().from(schema_1.discountCampaigns);
    const outcomes = [];
    let skippedLocked = 0;
    const concurrency = Math.max(1, Math.min(8, Number(process.env.PRICING_RUN_CONCURRENCY ?? 3) || 3));
    let nextIdx = 0;
    const worker = async () => {
        for (;;) {
            const idx = nextIdx++;
            if (idx >= targets.length)
                return;
            const product = targets[idx];
            const cardIndex = (opts.cardRangeFrom ? Math.max(1, opts.cardRangeFrom) : 1) + idx;
            const locked = await tryLockProduct(product.id);
            if (!locked) {
                skippedLocked++;
                await (0, bootstrap_1.logActivity)("runner", `قفل فعال محصول ${product.sku} — این اجرا رد شد (skipped_locked، قفل ۵ دقیقه‌ای نرم)`, { productId: product.id, runId: run.id }, "warn");
                continue;
            }
            try {
                const outcome = await priceOneProduct(product, run.id, campaigns, cardIndex, {
                    manualOffers: opts.manualOffers,
                    manualSupplierQuotes: opts.manualSupplierQuotes,
                });
                outcomes.push(outcome);
                summary.decisionIds.push(outcome.id);
                if (outcome.status === "applied")
                    summary.applied++;
                else if (outcome.status === "pending_review")
                    summary.pendingReview++;
                else {
                    summary.failed++;
                    if (outcome.errorHint && !summary.lastError) {
                        summary.lastError = outcome.errorHint;
                    }
                }
            }
            catch (e) {
                summary.failed++;
                const errMsg = e instanceof Error ? e.message : String(e);
                if (!summary.lastError)
                    summary.lastError = errMsg;
                await (0, bootstrap_1.logActivity)("runner", `خطا در قیمت‌گذاری محصول ${product.sku}: ${errMsg}`, { productId: product.id, runId: run.id }, "error");
            }
            finally {
                await unlockProduct(product.id);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
    // ---------- فاز ۲: تخصیص صندلی «منتخب‌ها» (showInFeatured) — نوار رتبه‌محور و تعیین‌شده (P0-4)
    const featuredCandidates = [];
    for (const o of outcomes) {
        if (o.featuredCandidate)
            featuredCandidates.push(o.featuredCandidate);
    }
    featuredCandidates.sort((a, b) => a.rankKey - b.rankKey || b.netMarginPct - a.netMarginPct || a.sku.localeCompare(b.sku));
    if (featuredCandidates.length) {
        const perCampaignSeats = {};
        for (const c of featuredCandidates) {
            const maxCards = campaigns.find((x) => x.id === c.campaignId)?.maxCards ?? 0;
            if (maxCards > 0 && (perCampaignSeats[c.campaignId] ?? 0) >= maxCards) {
                // صندلی تمام شد — showInFeatured تصمیمِ فاز ۱ (false) می‌ماند
                await db_1.db.update(schema_1.priceDecisions).set({ showInFeatured: false }).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, c.decisionId));
                continue;
            }
            perCampaignSeats[c.campaignId] = (perCampaignSeats[c.campaignId] ?? 0) + 1;
            await db_1.db.update(schema_1.priceDecisions).set({ showInFeatured: true }).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, c.decisionId));
        }
    }
    // ---------- فاز ۴: اعمال و push به فروشگاه (بعد از قطعیت صندلی‌ها)
    for (const o of outcomes) {
        if (o.status === "applied" && o.deferred) {
            await applyDecision(o.deferred.decisionId, o.deferred.campaignEndsAt);
        }
    }
    // ---------- فاز ۵: گارد انقضا کمپین زمان‌دار (P0-6) — اگر کمپین فعلی به‌زودی منقضی شود و این
    // اجرا جایگزین فعالِ آنرا اعمال نکرد، با قیمت فعلی «بدون کمپین» به فروشگاه ارسال می‌شود تا کمپین
    // در سمت فروشگاه منقضی (نه رهاشده) نمایش داده شود.
    let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
    try {
        if (opts.scheduleId) {
            const s = await db_1.db.select({ v: schema_1.schedules.intervalMinutes }).from(schema_1.schedules).where((0, drizzle_orm_1.eq)(schema_1.schedules.id, opts.scheduleId)).limit(1);
            intervalMinutes = s[0]?.v ?? intervalMinutes;
        }
        else {
            const s = await db_1.db
                .select({ v: schema_1.schedules.intervalMinutes })
                .from(schema_1.schedules)
                .where((0, drizzle_orm_1.eq)(schema_1.schedules.active, true))
                .orderBy((0, drizzle_orm_1.asc)(schema_1.schedules.id))
                .limit(1);
            intervalMinutes = s[0]?.v ?? intervalMinutes;
        }
    }
    catch {
        intervalMinutes = DEFAULT_INTERVAL_MINUTES;
    }
    const appliedProductIds = new Set(outcomes.filter((o) => o.status === "applied").map((o) => o.productId));
    await runExpiryGuard(targets, appliedProductIds, intervalMinutes, run.id);
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
    await (0, bootstrap_1.logActivity)("runner", `اجرای #${run.id} پایان یافت: ${summary.applied} اعمال، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا${skippedLocked ? `، ${skippedLocked} قفل‌دار رد شد` : ""}`, { ...summary, skippedLocked });
    return summary;
}
async function runExpiryGuard(targets, appliedProductIds, intervalMinutes, runId) {
    const now = Date.now();
    const horizonMs = Math.max(10, intervalMinutes * 2) * 60_000;
    for (const p of targets) {
        if (appliedProductIds.has(p.id))
            continue;
        const endsAt = p.currentCampaignEndsAt;
        const isActiveCampaign = Boolean(p.currentCampaign && p.currentCampaign !== "none" && endsAt);
        if (!isActiveCampaign || !endsAt)
            continue;
        const remainingMs = endsAt.getTime() - now;
        if (remainingMs <= 0 || remainingMs > horizonMs)
            continue;
        const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
        const realCost = p.costPrice > 0 ? p.costPrice : 0;
        const hardFloor = p.currentHardFloorPrice ?? 0;
        // ۴.۱.۱: هرگز هزینه‌ی ساختگی (قیمت × ۰٫۸۵) به فروشگاه نرود؛ اگر نه هزینه واقعی
        // داریم و نه خط قرمز، push نمی‌کنیم (سند فروشگاه با داده نادرست آلوده نمی‌شود).
        if (safePrice <= 0 || (realCost <= 0 && hardFloor <= 0)) {
            await (0, bootstrap_1.logActivity)("runner", `گارد انقضا: برای محصول ${p.sku} هزینه واقعی/خط قرمز موجود نیست — push «بدون کمپین» انجام نشد`, { productId: p.id, runId, safePrice, realCost, hardFloor }, "warn");
            continue;
        }
        const pushRes = await (0, connectors_1.pushToStore)({
            productId: p.id,
            sku: p.sku,
            storeExternalId: p.storeExternalId,
            ...(realCost > 0 ? { effectiveCostPrice: realCost } : {}),
            hardFloorPrice: hardFloor,
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
            confidence: 1,
        });
        await (0, bootstrap_1.logActivity)("runner", `گارد انقضا: کمپین ${p.currentCampaign} محصول ${p.sku} در ${Math.round(remainingMs / 60000)} دقیقه منقضی می‌شود و این اجرا جایگزین فعال برای آن اعمال نکرد — وضعیت «بدون کمپین» با قیمت فعلی به فروشگاه ارسال شد (${pushRes.message})`, { productId: p.id, runId, remainingMs: Math.round(remainingMs / 60000) }, pushRes.ok ? "info" : "warn");
    }
}
const SUPERVISOR_REASON_PREFIXES = [
    "رد توسط ناظر بالاسر SystemOne",
    "ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد",
];
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
async function priceOneProduct(product, runId, campaigns, cardIndex, opts) {
    const manualOffers = opts?.manualOffers;
    const manualSupplierQuotes = opts?.manualSupplierQuotes;
    if (!manualOffers?.length && !(0, registry_1.isAllowedSourceType)(product.sourceType)) {
        throw new Error(`منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`);
    }
    const { config } = await (0, bootstrap_1.getProfileConfig)(product.profileId);
    const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];
    // مرجع تخفیف own_price_7d (P3): تاریخچه قیمت خودی دوام‌یافته در پنجره ۷ روزی
    const discountContext = await computeOwnDiscountContext(product.id, config.discount.ownPriceWindowDays ?? 7, config.discount.ownPriceMinHoldHours ?? 48);
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
        sku: product.sku,
        costPrice: product.costPrice,
        supplierQuotes,
        minMarginPctOverride: product.minMarginPct,
        minProfitAmountOverride: product.minProfitAmount,
        currentFinalPrice: product.currentFinalPrice,
        category: product.category,
        config,
        discountContext,
    });
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
        // محرمانگی (۴.۲.۰): قیمت خرید/تمام‌شده/کف سود هرگز به LLM بیرونی فرستاده نمی‌شود؛ آن‌ها فقط برای
        // پاک‌سازی عددهای محرمانه از متن‌ها به کار می‌روند (نگاه کنید به src/lib/ai/review-payload.ts).
        const review = await (0, client_1.reviewDecisionWithAI)({
            productName: product.name,
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
            alternative: result.decisionScenarios?.alternative ?? null,
            confidence: result.confidence,
        }, [
            result.supply.effectiveCostPrice,
            result.supply.hardFloorPrice,
            result.supply.baseBuyPrice,
            product.costPrice,
        ]);
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
    // گارد امنیتی مضاعف برای جلوگیری از تشخیص اشتباه کارت و اعمال خودکار کالاهای بدون قیمت خرید:
    // اگر محصول فاقد قیمت خرید همکار است (effectiveCost = 0) و هنوز لینک/PRK ترب برای آن توسط مدیر تایید نشده است (!product.torobPrk)،
    // بار اول حتماً به صف بازبینی (pending_review) می‌رود تا کارت پیدا شده در ترب توسط مدیر تایید شود و سرخود وارد کمپین‌های سایت نگردد!
    const unverifiedFirstSearchWithoutCost = !product.torobPrk && !product.torobUrl && result.supply.effectiveCostPrice <= 0;
    if (unverifiedFirstSearchWithoutCost && !result.rejectedBySupervisor) {
        result.needsReview = true;
        result.reviewReasons.push("اولین استعلام خودکار بدون لینک ترب و بدون قیمت خرید همکار — نیازمند یک‌بار تایید کارت ترب در صف بازبینی");
    }
    const strictlyAboveCost = result.finalPrice != null &&
        result.supply.hardFloorPrice > 0 &&
        result.finalPrice >= result.supply.hardFloorPrice &&
        result.finalPrice > result.supply.effectiveCostPrice;
    // ۴.۱.۲ (تصمیم #۲): حداقل حاشیه‌ی سود برای اعمال خودکار. پیش‌فرض ۰ = رفتار قبلی؛
    // اگر اپراتور profitApproveMarginPct را مثبت کند، قیمت‌های بالای کف سود ولی با
    // حاشیه‌ی کم به‌جای اعمال خودکار به صف بازبینی می‌روند (برای کالاهای کم‌حاشیه محافظه‌کارانه‌تر).
    const marginGate = (0, approval_1.evaluateApproveMargin)({
        approveMarginPct: config.guards.profitApproveMarginPct,
        netMarginPct: Number(result.position.netMarginPct) || 0,
        strictlyAboveCost,
        autoApply: product.autoApply,
        needsReview: result.needsReview,
        rejectedBySupervisor: Boolean(result.rejectedBySupervisor),
        isProvisional: Boolean(result.isProvisional),
        hasPrice: Boolean(result.finalPrice),
    });
    if (marginGate.needsReview) {
        result.needsReview = true;
        if (marginGate.reason)
            result.reviewReasons.push(marginGate.reason);
    }
    let status;
    if (result.rejectedBySupervisor) {
        status = "rejected";
    }
    else if (!result.finalPrice) {
        status = "failed";
    }
    else if (result.isProvisional) {
        // P2-3: مسیر Provisional هرگز خودکار اعمال نمی‌شود
        status = "pending_review";
    }
    else if (strictlyAboveCost && !result.needsReview && product.autoApply) {
        status = "applied";
    }
    else {
        status = "pending_review";
    }
    let campaignType = "none";
    let campaignName = null;
    let badgeTheme = "green-orange";
    let campaignEndsAt = null;
    let campaignId = null;
    let pickShowInFeatured = false;
    // تخصیص کمپین فقط زمانی انجام می‌شود که تصمیم رد یا خطاددار نباشد!
    if (status !== "rejected" &&
        status !== "failed" &&
        result.discountPct != null &&
        result.finalPrice) {
        const pick = (0, campaigns_1.pickCampaign)(campaigns, {
            discountPct: result.discountPct,
            category: product.category,
            productId: product.id,
            cardIndex,
            finalPrice: result.finalPrice,
            projectedLocalRank: result.position.projectedLocalRank,
            projectedNationalRank: result.position.projectedNationalRank,
            preferredCampaignType: product.preferredCampaignType,
            discountKind: result.discountReferenceKind ?? null,
            ownAvg7d: discountContext.ownAvg7d,
        });
        campaignType = pick.type;
        campaignName = pick.campaignName;
        badgeTheme = pick.badgeTheme;
        campaignEndsAt = pick.endsAt;
        campaignId = pick.campaignId;
        pickShowInFeatured = pick.showInFeatured && product.showInFeatured;
        // P0-3: پیوستگی تایمر — اگر کمپین همین نوع فعلی کتابستانِ سالم هنوز فعال باشد، تایمر دست نمی‌خورد (S3)
        if (pick.type !== "none" &&
            product.currentCampaign === pick.type &&
            product.currentCampaignEndsAt &&
            product.currentCampaignEndsAt.getTime() > Date.now()) {
            pick.reason += " · تایمر کمپین فعلی ادامه دارد (reset نشد — پیوستگی تایمر)";
            campaignEndsAt = product.currentCampaignEndsAt;
            // تایمرِ فعلی حفظ شد → showInFeatured فعلی هم حفظ می‌شود (S3)
            pickShowInFeatured = product.currentShowInFeatured ?? pickShowInFeatured;
            result.reviewReasons.push(`کمپین فعلی (${pick.type}) هنوز سالم فعال است و تایمر آن (تا ${product.currentCampaignEndsAt.toLocaleString("fa-IR")}) ریست نشد`);
        }
        result.steps.push({
            step: "campaign",
            title: "انتخاب هوشمند از بین ۳ سیستم تخفیف",
            message: pick.reason,
            data: {
                type: pick.type,
                campaignName: pick.campaignName,
                badgeTheme: pick.badgeTheme,
                showInFeaturedDesired: pickShowInFeatured,
                cardIndex,
            },
        });
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
        // P0-4: در فاز ۱ «دقیقی» false ثبت می‌شود؛ پس از اولود فاز ۲ صندلی‌ها واقعی می‌شود
        showInFeatured: false,
        strategy: result.strategy,
        competitionTier: result.position.competitionTier,
        projectedNationalRank: safeInt(result.position.projectedNationalRank),
        projectedLocalRank: safeInt(result.position.projectedLocalRank),
        // ۴.۱.۲ (N5): هر دو رتبه در تصمیم ذخیره می‌شوند تا رابط بازبینی هر دو را نشان دهد
        rankIncludingSuspect: safeInt(result.position.rankIncludingSuspect),
        totalSellersIncludingSuspect: safeInt(result.position.totalSellersIncludingSuspect) ?? 0,
        netProfitToman: safeInt(result.position.netProfitToman),
        netMarginPct: safeReal(result.position.netMarginPct),
        confidence: safeReal(result.supervisor.enabled ? result.supervisor.overallNoul : result.confidence),
        engineVersion: config.engine?.version ?? "4.1.1",
        marketConflict: result.marketConflict ?? false,
        referenceKind: result.discountReferenceKind ?? "none",
        floorConfirmed: result.floorConfirmed ?? false,
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
    // قفل کردن PRK در دیتابیس فقط زمانی که تصمیم اعمال شده یا گیت تطابق هویت بالای آستانه تایید خودکار (approve) باشد!
    const identityApproved = result.supervisor.gates.identity_match?.verdict === "approve";
    // P0-1 (M2): write-back قیمت خرید ممنوع. قیمت همکار فقط در replacementCost ثبت می‌شود؛
    // costPrice (هزینه موجودی) هرگز از لیست همکار بازنویسی نمی‌شود (INV-2).
    const lowestQuoteCost = result.supply.lowestQuoteCost;
    const shouldStoreReplacement = (lowestQuoteCost ?? 0) > 0 &&
        (product.costPrice <= 0 || lowestQuoteCost > product.costPrice);
    await db_1.db
        .update(schema_1.products)
        .set({
        lastCheckedAt: new Date(),
        lastDecisionId: decision.id,
        updatedAt: new Date(),
        ...(shouldStoreReplacement
            ? {
                replacementCost: Math.round(lowestQuoteCost),
                replacementCostAt: new Date(),
            }
            : {}),
        selectedSupplierName: result.supply.selectedQuote?.supplierName ?? product.selectedSupplierName ?? null,
        ...(result.supply.hardFloorPrice > 0 ? { currentHardFloorPrice: result.supply.hardFloorPrice } : {}),
        ...(source.prk && !product.torobPrk && identityApproved ? { torobPrk: source.prk } : {}),
        ...(source.detailsUrl && !product.torobDetailsUrl && identityApproved
            ? { torobDetailsUrl: source.detailsUrl }
            : {}),
        ...(status === "pending_review" ? { status: "needs_review" } : {}),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.products.id, product.id));
    // برگشت خروجی به‌همنه با فاز ۴ runner — applyDecision پس از تخصیص صندلی منتخب‌ها صدا زده می‌شود
    const deferred = status === "applied" ? { decisionId: decision.id, campaignEndsAt } : undefined;
    const featuredCandidate = status === "applied" &&
        campaignId != null &&
        campaignType !== "none" &&
        (result.position.projectedLocalRank === 1 ||
            result.position.projectedNationalRank === 1 ||
            pickShowInFeatured)
        ? {
            decisionId: decision.id,
            productId: product.id,
            sku: product.sku,
            campaignId: campaignId,
            rankKey: result.position.projectedNationalRank === 1 || result.position.projectedLocalRank === 1 ? 0 : 1,
            netMarginPct: result.position.netMarginPct ?? 0,
        }
        : undefined;
    return { id: decision.id, productId: product.id, status, errorHint: source.error ?? null, deferred, featuredCandidate };
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
        // P0-3: تایمر کمپین روی خودِ محصول ذخیره می‌شود تا پیوستگی و گارد انقضا کار کند
        currentCampaignEndsAt: campaignEndsAt ?? (p.currentCampaignEndsAt ?? null),
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
    // S6: پوش موفق = سیگنال مغز خارجی (needsRefresh) برطرف شد
    if (push.ok) {
        await db_1.db.update(schema_1.products).set({ needsRefresh: false, updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.products.id, p.id));
    }
    await (0, bootstrap_1.logActivity)("apply", `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف نهایی ${d.finalPrice} | کمپین: ${d.campaignType}${campaignEndsAt ? ` تا ${campaignEndsAt.toISOString()}` : ""} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${opts?.force ? " (اعمال اجباری انسانی با force)" : ""}`, { decisionId: d.id, forced: !!opts?.force }, push.ok ? "info" : "warn");
    return push;
}
async function rejectDecision(decisionId) {
    const [d] = await db_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d)
        return;
    await db_1.db
        .update(schema_1.priceDecisions)
        .set({ status: "rejected", campaignType: "none", campaignName: null, showInFeatured: false })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId));
    await db_1.db.update(schema_1.products).set({ status: "active", updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId));
    await (0, bootstrap_1.logActivity)("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}
/**
 * پاک‌سازی فوری کارت‌هایی که به اشتباه در دسته ۳ (فرصت‌های زمان‌دار / timed_sale) قرار گرفته‌اند
 * + حذف آن‌ها از کالکشن Sale در بک‌اند فروشگاه (ekgkala-backend) و ریست قفل ترب
 */
async function cleanupWrongTimedSaleCards(opts) {
    const targetRows = opts?.productId
        ? await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, opts.productId))
        : await db_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.currentCampaign, "timed_sale"));
    const cleanedProducts = [];
    const storeResetResults = [];
    for (const p of targetRows) {
        const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
        await db_1.db
            .update(schema_1.products)
            .set({
            currentCampaign: "none",
            currentCampaignName: null,
            currentDiscountPct: 0,
            currentShowInFeatured: false,
            currentCampaignEndsAt: null,
            currentBasePrice: safePrice > 0 ? safePrice : p.currentBasePrice,
            // اگر محصول قیمت خرید نداشت و به اشتباه به یک PRK ترب قفل شده بود، قفل PRK را آزاد کن تا دوباره تمیز استعلام شود
            ...(p.costPrice <= 0 ? { torobPrk: null, torobDetailsUrl: null, autoApply: false } : {}),
            status: "active",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.products.id, p.id));
        await db_1.db
            .update(schema_1.priceDecisions)
            .set({
            campaignType: "none",
            campaignName: null,
            showInFeatured: false,
            ...(p.costPrice <= 0 ? { status: "rejected" } : {}),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, p.id));
        cleanedProducts.push(`${p.name} (${p.sku})`);
        if (safePrice > 0) {
            const pushRes = await (0, connectors_1.pushToStore)({
                productId: p.id,
                sku: p.sku,
                storeExternalId: p.storeExternalId,
                ...(p.costPrice > 0 ? { effectiveCostPrice: p.costPrice } : {}),
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
                confidence: 1,
            });
            storeResetResults.push(`${p.sku}: ${pushRes.message}`);
        }
    }
    // غیرفعال کردن کمپین پیش‌فرض timed_sale اگر به صورت خودکار همه کارت‌های ۱ تا ۱۰۰ را با ۳٪ تخفیف می‌گرفت
    await db_1.db
        .update(schema_1.discountCampaigns)
        .set({ active: false, minDiscountPct: 10, cardRangeFrom: 21, cardRangeTo: 50 })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountCampaigns.type, "timed_sale"), (0, drizzle_orm_1.eq)(schema_1.discountCampaigns.minDiscountPct, 3)));
    // ریست قفل ضدربات (Circuit Breaker Wall) روی سرور torob-mcp در صورت فعال بودن
    let mcpReset = false;
    const mcpUrl = (process.env.TOROB_MCP_URL ?? "http://127.0.0.1:3005/mcp").replace(/\/mcp\/?$/, "");
    try {
        const r = await fetch(`${mcpUrl}/reset`, { method: "POST", cache: "no-store" });
        mcpReset = r.ok;
    }
    catch {
        mcpReset = false;
    }
    await (0, bootstrap_1.logActivity)("cleanup", `پاک‌سازی کمپین‌های زمان‌دار اشتباه انجام شد: ${cleanedProducts.length} کارت بازگردانی شد`, { cleanedProducts, storeResetResults, mcpReset });
    return {
        cleanedCount: cleanedProducts.length,
        cleanedProducts,
        storeResetResults,
        mcpReset,
    };
}
