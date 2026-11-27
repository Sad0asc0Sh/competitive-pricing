"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDecisionToStore = exports.safeReal = exports.safeInt = void 0;
exports.recoverStuckAppliedDecisions = recoverStuckAppliedDecisions;
exports.runPricing = runPricing;
exports.resolveInitialDecisionStatus = resolveInitialDecisionStatus;
exports.isSupervisorRejected = isSupervisorRejected;
exports.applyHumanOverrideToDecision = applyHumanOverrideToDecision;
exports.applyDecision = applyDecision;
exports.retryDecisionSync = retryDecisionSync;
exports.reconcilePendingDecisions = reconcilePendingDecisions;
exports.rejectDecision = rejectDecision;
exports.cleanupWrongTimedSaleCards = cleanupWrongTimedSaleCards;
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const config_1 = require("../ai/config");
const approval_1 = require("../pricing/approval");
const campaigns_1 = require("../pricing/campaigns");
const discount_1 = require("../pricing/discount");
const engine_1 = require("../pricing/engine");
const own_price_history_1 = require("../pricing/own-price-history");
const sourcing_1 = require("../pricing/sourcing");
const systemone_supervisor_1 = require("../pricing/systemone-supervisor");
const registry_1 = require("../sources/registry");
const torob_1 = require("../sources/torob");
const torob_index_1 = require("../sources/torob-index");
const connectors_1 = require("../store/connectors");
const drizzle_orm_1 = require("drizzle-orm");
const bootstrap_1 = require("./bootstrap");
const PG_INT4_MIN = -2_147_483_648;
const PG_INT4_MAX = 2_147_483_647;
/** تبدیل ایمن مقادیر موتور به عدد صحیح/اعشاری معتبر قبل از درج در دیتابیس (NaN/Infinity/overflow هرگز درج نشود) */
const safeInt = (v) => {
    if (v == null || !Number.isFinite(v))
        return null;
    const rounded = Math.round(v);
    if (!Number.isFinite(rounded))
        return null;
    return Math.max(PG_INT4_MIN, Math.min(PG_INT4_MAX, rounded));
};
exports.safeInt = safeInt;
const safeReal = (v, fallback = 0) => v == null || !Number.isFinite(v) ? fallback : v;
exports.safeReal = safeReal;
const safeDate = (v) => v instanceof Date && Number.isFinite(v.getTime()) ? v : null;
const DEFAULT_INTERVAL_MINUTES = 180;
const MAX_AUTO_SYNC_ATTEMPTS = 5;
/**
 * قفل نرم تک‌محصولی (P0-5): با یک UPDATE اتمی قفل «۵ دقیقه‌ای» گرفته می‌شود؛
 * اجرای موازی/کلاسترِ هم‌زمان هر محصول را حداکثر یک‌بار استعلام می‌کند.
 */
async function tryLockProduct(productId) {
    try {
        const res = await index_ts_1.db.execute((0, drizzle_orm_1.sql) `update products set locked_until = now() + interval '5 minutes' where id = ${productId} and (locked_until is null or locked_until <= now()) returning id`);
        return { locked: (res.rows?.length ?? 0) > 0 };
    }
    catch (e) {
        // ۴.۱.۱: پس از مهاجرت 0001، نبود ستون یا هر خطای قفل نباید fail-open شود.
        // محصول در این اجرا skip می‌شود تا هرگز دو اجرای هم‌زمان روی یک محصول قیمت نگذارند.
        return { locked: false, error: e instanceof Error ? e.message : String(e) };
    }
}
async function unlockProduct(productId) {
    try {
        await index_ts_1.db.execute((0, drizzle_orm_1.sql) `update products set locked_until = null where id = ${productId}`);
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
        const rows = await index_ts_1.db
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
 * ۴.۲.۱: قیمت‌هایی که خودمان اخیراً داشته‌ایم (برای گارد «پژواک قیمت خودی» در موتور): قیمت فعلی + قیمت نهایی
 * تصمیم‌های applied با push موفق در `days` روز اخیر. پنجره بلند است چون ترب قیمت فروشگاه را با تأخیر می‌خواند
 * (ساعت‌ها تا روزها) و پیشنهاد خودیِ ناشناخته ممکن است هنوز قیمت چند push قبل را نشان دهد.
 */
async function loadOwnRecentPrices(productId, currentPrice, days = 14) {
    const out = new Set();
    const add = (v) => {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n > 0)
            out.add(n);
    };
    add(currentPrice);
    try {
        const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
        const rows = await index_ts_1.db
            .select({ finalPrice: schema_1.priceDecisions.finalPrice })
            .from(schema_1.priceDecisions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, productId), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.pushStatus, "pushed"), (0, drizzle_orm_1.gte)(schema_1.priceDecisions.createdAt, since)));
        for (const r of rows)
            add(r.finalPrice);
    }
    catch {
        // گارد کمکی است؛ خطای دیتابیس جریان قیمت‌گذاری را نمی‌شکند
    }
    return Array.from(out);
}
/**
 * بازیابی و همگام‌سازی مجدد تصمیم‌های در انتظار پوش (`pending_sync` / `sync_failed`)
 * و تصمیم‌های قدیمی `applied` که `push_status` آن‌ها هنوز `pushed` نشده است.
 */
async function recoverStuckAppliedDecisions(limit = 50) {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    try {
        const stuck = await index_ts_1.db
            .select()
            .from(schema_1.priceDecisions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.isNull)(schema_1.priceDecisions.pushStatus), (0, drizzle_orm_1.lt)(schema_1.priceDecisions.createdAt, cutoff)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.priceDecisions.status, ["pending_sync", "sync_failed"]), (0, drizzle_orm_1.lt)(schema_1.priceDecisions.pushAttempts, MAX_AUTO_SYNC_ATTEMPTS), (0, drizzle_orm_1.lt)(schema_1.priceDecisions.createdAt, cutoff)))))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.priceDecisions.id))
            .limit(limit);
        for (const d of stuck) {
            // اگر تصمیم جدیدتری برای همین محصول با موفقیت push شده، بازپخش تصمیم قدیمی
            // قیمت فروشگاه را عقب می‌برد؛ قدیمی را superseded علامت می‌زنیم.
            const [newerPushed] = await index_ts_1.db
                .select({ id: schema_1.priceDecisions.id })
                .from(schema_1.priceDecisions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, d.productId), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.pushStatus, "pushed"), (0, drizzle_orm_1.gt)(schema_1.priceDecisions.id, d.id)))
                .limit(1);
            if (newerPushed) {
                await index_ts_1.db
                    .update(schema_1.priceDecisions)
                    .set({
                    status: "superseded",
                    pushStatus: "superseded",
                    pushError: `تصمیم جدیدتر #${newerPushed.id} قبلاً push شده است (recovery superseded)`,
                    lastPushAttemptAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
                continue;
            }
            const res = await applyDecision(d.id, null);
            if (!res.ok) {
                await index_ts_1.db
                    .update(schema_1.priceDecisions)
                    .set({
                    status: res.push?.skipped ? "pending_sync" : "sync_failed",
                    pushStatus: res.push?.skipped ? "skipped" : "failed",
                    pushError: res.message,
                    lastPushAttemptAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
            }
        }
        if (stuck.length) {
            await (0, bootstrap_1.logActivity)("runner", `بازیابی ${stuck.length} تصمیم همگام‌نشده با فروشگاه انجام شد`, {
                decisionIds: stuck.map((d) => d.id),
            });
        }
        return stuck.length;
    }
    catch {
        return 0;
    }
}
async function runPricing(opts = {}) {
    await (0, bootstrap_1.ensureDefaults)();
    await recoverStuckAppliedDecisions();
    const rawTrigger = opts.trigger ?? opts.triggeredBy ?? "manual";
    const normalizedTrigger = rawTrigger === "scheduled" ? "schedule" : rawTrigger;
    const hasManualOffers = Array.isArray(opts.manualOffers)
        ? opts.manualOffers.length > 0
        : Boolean(opts.manualOffers && Object.keys(opts.manualOffers).length > 0);
    const isSimulated = Boolean(opts.isSimulated || opts.runMode === "simulate" || hasManualOffers);
    const runMode = isSimulated
        ? "simulate"
        : opts.runMode === "shadow" || normalizedTrigger === "shadow"
            ? "shadow"
            : "live";
    const validationSource = isSimulated
        ? "simulated"
        : runMode === "shadow"
            ? "shadow_torob"
            : "live_torob";
    const hasRange = Boolean((opts.cardRangeFrom && opts.cardRangeFrom > 0) || (opts.cardRangeTo && opts.cardRangeTo > 0));
    let targets;
    if (opts.productIds?.length && normalizedTrigger !== "schedule") {
        targets = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.inArray)(schema_1.products.id, opts.productIds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
        targets = targets.filter((p) => p.status !== "paused");
    }
    else if (hasRange && !opts.category) {
        // شماره‌گذاری کارت‌ها (#1..#N) در صفحه محصولات بر اساس تمام ردیف‌ها (جز متوقف‌ها هنگام اجرا) است؛
        // ابتدا برش بازه را مطابق اندیس صفحه محصولات انجام می‌دهیم و سپس کارت‌های paused را کنار می‌گذاریم.
        const allRows = await index_ts_1.db.select().from(schema_1.products).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
        const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
        const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : allRows.length;
        targets = allRows.slice(startIdx, endIdx).filter((p) => p.status !== "paused");
    }
    else {
        // همهٔ محصولات فعال و در انتظار بازبینی (paused هرگز استعلام نمی‌شود)
        const conds = [(0, drizzle_orm_1.ne)(schema_1.products.status, "paused")];
        if (opts.category)
            conds.push((0, drizzle_orm_1.eq)(schema_1.products.category, opts.category));
        targets = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.and)(...conds)).orderBy((0, drizzle_orm_1.asc)(schema_1.products.id));
        if (hasRange) {
            const startIdx = Math.max(0, (opts.cardRangeFrom ?? 1) - 1);
            const endIdx = opts.cardRangeTo && opts.cardRangeTo > 0 ? opts.cardRangeTo : targets.length;
            targets = targets.slice(startIdx, endIdx);
        }
    }
    const [run] = await index_ts_1.db
        .insert(schema_1.priceRuns)
        .values({
        trigger: normalizedTrigger,
        runMode,
        isSimulated,
        scheduleId: opts.scheduleId,
        totalProducts: targets.length,
    })
        .returning();
    const summary = {
        runId: run.id,
        runMode,
        isSimulated,
        total: targets.length,
        applied: 0,
        pendingReview: 0,
        failed: 0,
        pendingSync: 0,
        syncFailed: 0,
        decisionIds: [],
        lastError: null,
    };
    const campaigns = await index_ts_1.db.select().from(schema_1.discountCampaigns);
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
            const lock = await tryLockProduct(product.id);
            if (!lock.locked) {
                if (lock.error) {
                    summary.failed++;
                    const lockErrMsg = `خطای قفل دیتابیس محصول ${product.sku}: ${lock.error}`;
                    if (!summary.lastError)
                        summary.lastError = lockErrMsg;
                    await (0, bootstrap_1.logActivity)("runner", lockErrMsg, { productId: product.id, runId: run.id }, "error");
                    try {
                        const [failedRow] = await index_ts_1.db
                            .insert(schema_1.priceDecisions)
                            .values({
                            runId: run.id,
                            productId: product.id,
                            source: product.sourceType || "torob",
                            offersTotal: 0,
                            offersUsed: 0,
                            confidence: 0,
                            status: "failed",
                            pushError: lockErrMsg,
                            isSimulated,
                            validationSource,
                            steps: [
                                {
                                    step: "error",
                                    title: "خطا در قفل‌گذاری محصول پیش از استعلام",
                                    message: lockErrMsg,
                                    level: "error",
                                },
                            ],
                        })
                            .returning({ id: schema_1.priceDecisions.id });
                        if (failedRow)
                            summary.decisionIds.push(failedRow.id);
                    }
                    catch {
                        // ثبت خطا نباید جریان کل را بشکند
                    }
                }
                else {
                    skippedLocked++;
                    await (0, bootstrap_1.logActivity)("runner", `قفل فعال محصول ${product.sku} — این اجرا رد شد (skipped_locked، قفل ۵ دقیقه‌ای نرم)`, { productId: product.id, runId: run.id }, "warn");
                }
                continue;
            }
            try {
                const productManualOffers = Array.isArray(opts.manualOffers)
                    ? opts.manualOffers
                    : opts.manualOffers?.[product.id];
                const outcome = await priceOneProduct(product, run.id, campaigns, cardIndex, {
                    manualOffers: productManualOffers,
                    manualSupplierQuotes: opts.manualSupplierQuotes,
                    runMode,
                    isSimulated,
                    profileIdOverride: opts.profileId,
                    discoveryMode: opts.discoveryMode,
                });
                outcomes.push(outcome);
                summary.decisionIds.push(outcome.id);
                if (outcome.status === "pending_sync") {
                    // شمارش نهایی applied در فاز ۴ پس از تایید واقعی فروشگاه انجام می‌شود
                }
                else if (outcome.status === "pending_review") {
                    summary.pendingReview++;
                }
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
                try {
                    const [failedRow] = await index_ts_1.db
                        .insert(schema_1.priceDecisions)
                        .values({
                        runId: run.id,
                        productId: product.id,
                        source: product.sourceType || "torob",
                        offersTotal: 0,
                        offersUsed: 0,
                        confidence: 0,
                        status: "failed",
                        pushError: errMsg,
                        isSimulated,
                        validationSource,
                        steps: [
                            {
                                step: "error",
                                title: "خطای غیرمنتظره هنگام استعلام کارت",
                                message: errMsg,
                                level: "error",
                            },
                        ],
                    })
                        .returning({ id: schema_1.priceDecisions.id });
                    if (failedRow)
                        summary.decisionIds.push(failedRow.id);
                }
                catch {
                    // ثبت خطای تصمیم نباید باعث توقف سایر کارت‌ها شود
                }
            }
            finally {
                await unlockProduct(product.id);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
    summary.skippedLocked = skippedLocked;
    if (targets.length === 0 && !summary.lastError) {
        summary.lastError = "هیچ محصول فعالی در این بازه/فیلتر یافت نشد (بررسی کنید کارت متوقف/paused نباشد)";
    }
    else if (skippedLocked > 0 && outcomes.length === 0 && !summary.lastError) {
        summary.lastError = `${skippedLocked} کارت به‌دلیل قفل ۵ دقیقه‌ای اجرای قبلی رد شد (برای باز کردن فوری، «ریست قفل ترب» را بزنید)`;
    }
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
                await index_ts_1.db.update(schema_1.priceDecisions).set({ showInFeatured: false }).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, c.decisionId));
                continue;
            }
            perCampaignSeats[c.campaignId] = (perCampaignSeats[c.campaignId] ?? 0) + 1;
            await index_ts_1.db.update(schema_1.priceDecisions).set({ showInFeatured: true }).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, c.decisionId));
        }
    }
    // ---------- فاز ۴: اعمال و push به فروشگاه (فقط در اجرای live و پس از تایید واقعی فروشگاه)
    for (const o of outcomes) {
        if (o.status === "pending_sync" && o.deferred && runMode === "live" && !isSimulated) {
            const pushRes = await applyDecision(o.deferred.decisionId, o.deferred.campaignEndsAt);
            if (pushRes.ok) {
                o.status = "applied";
                summary.applied++;
            }
            else if (pushRes.push?.skipped) {
                o.status = "pending_sync";
                summary.pendingSync = (summary.pendingSync ?? 0) + 1;
                summary.failed++;
                if (!summary.lastError)
                    summary.lastError = pushRes.message;
            }
            else {
                o.status = "sync_failed";
                summary.syncFailed = (summary.syncFailed ?? 0) + 1;
                summary.failed++;
                if (!summary.lastError)
                    summary.lastError = pushRes.message;
            }
        }
    }
    // ---------- فاز ۵: گارد انقضا کمپین زمان‌دار (P0-6) — فقط در اجرای live
    if (runMode === "live" && !isSimulated) {
        let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
        try {
            if (opts.scheduleId) {
                const s = await index_ts_1.db
                    .select({ v: schema_1.schedules.intervalMinutes })
                    .from(schema_1.schedules)
                    .where((0, drizzle_orm_1.eq)(schema_1.schedules.id, opts.scheduleId))
                    .limit(1);
                intervalMinutes = s[0]?.v ?? intervalMinutes;
            }
            else {
                const s = await index_ts_1.db
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
    }
    await index_ts_1.db
        .update(schema_1.priceRuns)
        .set({
        status: "done",
        applied: summary.applied,
        pendingReview: summary.pendingReview,
        failed: summary.failed,
        error: summary.lastError,
        finishedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.priceRuns.id, run.id));
    await (0, bootstrap_1.logActivity)("runner", `اجرای #${run.id} (${runMode}) پایان یافت: ${summary.applied} اعمال تاییدشده، ${summary.pendingReview} بازبینی، ${summary.failed} رد/خطا${skippedLocked ? `، ${skippedLocked} قفل‌دار رد شد` : ""}`, { ...summary, skippedLocked });
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
        const { effectiveCostPrice: realCost, hardFloorPrice: hardFloor } = await currentSupply(p);
        // ۴.۱.۱: هرگز هزینه‌ی ساختگی (قیمت × ۰٫۸۵) به فروشگاه نرود؛ اگر نه هزینه واقعی
        // داریم و نه خط قرمز، push نمی‌کنیم (سند فروشگاه با داده نادرست آلوده نمی‌شود).
        if (safePrice <= 0 || realCost <= 0) {
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
    "رد توسط ناظر SystemOne",
    "رد توسط ناظر به دلیل وتوی",
    "ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد",
];
function syncSupervisorAfterEnrichment(result, sourceOk, allowCostlessAutoApply = false) {
    const sup = result.supervisor;
    result.reviewReasons = result.reviewReasons.filter((r) => !SUPERVISOR_REASON_PREFIXES.some((p) => r.startsWith(p)));
    if (sup.verdict === "reject") {
        result.reviewReasons.push((0, systemone_supervisor_1.formatSupervisorRejectMessage)(sup));
    }
    else if (sup.verdict === "review") {
        result.reviewReasons.push(`ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${sup.overallScorePct}% بین ${sup.rejectBelowPct}% و ${sup.approveAbovePct}%)`);
    }
    result.rejectedBySupervisor = sup.verdict === "reject";
    result.needsReview =
        result.reviewReasons.length > 0 ||
            !sourceOk ||
            (result.supply.effectiveCostPrice <= 0 && !allowCostlessAutoApply) ||
            result.rejectedBySupervisor ||
            sup.verdict !== "approve";
    const level = sup.verdict === "reject" ? "error" : sup.verdict === "review" ? "warn" : "info";
    const apiBadge = sup.apiStatus === "ok"
        ? `API زنده SubQ (${sup.model})`
        : sup.apiStatus === "error"
            ? `خطای اتصال API ناظر: ${sup.apiError ?? "نامشخص"}`
            : sup.apiStatus === "not_configured"
                ? "توکن SubQ ثبت نشده — موتور آنی محلی فعال است"
                : sup.apiStatus === "skipped"
                    ? "استعلام SubQ با توجه به وضعیت داده انجام نشد"
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
/**
 * وضعیت اولیه تصمیم قیمت‌گذاری پس از اجرای موتور:
 * با قفل قطعی نظارت انسانی، هیچ تصمیمی به صورت خودکار به `pending_sync` نمی‌رود
 * و تمام تصمیم‌های دارای قیمت معتبر (غیرردشده) به `pending_review` هدایت می‌شوند.
 */
function resolveInitialDecisionStatus(input) {
    if (input.torobStatus === "IDENTITY_MISMATCH" || input.rejectedBySupervisor)
        return "rejected";
    if (input.torobStatus === "REVIEW_REQUIRED" || input.torobStatus === "EXTRACTION_INCOMPLETE")
        return "pending_review";
    if (!input.hasFinalPrice)
        return "failed";
    return "pending_review";
}
async function priceOneProduct(product, runId, campaigns, cardIndex, opts) {
    const manualOffers = opts?.manualOffers;
    const manualSupplierQuotes = opts?.manualSupplierQuotes;
    const runMode = opts?.runMode ?? (manualOffers?.length ? "simulate" : "live");
    const isSimulated = Boolean(opts?.isSimulated || runMode === "simulate" || (manualOffers && manualOffers.length > 0));
    const validationSource = isSimulated
        ? "simulated"
        : runMode === "shadow"
            ? "shadow_torob"
            : "live_torob";
    if (!manualOffers?.length && !(0, registry_1.isAllowedSourceType)(product.sourceType)) {
        throw new Error(`منبع «${product.sourceType}» برای محصول ${product.sku} مجاز نیست؛ فقط منبع واقعی «ترب» پشتیبانی می‌شود. منبع محصول را از صفحه محصولات اصلاح کنید.`);
    }
    const { config } = await (0, bootstrap_1.getProfileConfig)(opts?.profileIdOverride ?? product.profileId);
    const supplierQuotes = manualSupplierQuotes ?? product.supplierQuotes ?? [];
    // مرجع تخفیف own_price_7d (P3): تاریخچه قیمت خودی دوام‌یافته در پنجره ۷ روزی
    const discountContext = await computeOwnDiscountContext(product.id, config.discount.ownPriceWindowDays ?? 7, config.discount.ownPriceMinHoldHours ?? 48);
    const discoveryMode = opts?.discoveryMode ?? (product.needsRefresh ? "extended" : "interactive");
    const multiPrkGraphEnabled = config.discovery?.multiPrkGraphEnabled ?? true;
    const hybridIndexEnabled = config.discovery?.hybridIndexEnabled ?? true;
    const graphHints = (!manualOffers?.length && (multiPrkGraphEnabled || hybridIndexEnabled))
        ? await (0, torob_index_1.loadProductDiscoveryHints)({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            category: product.category,
            torobPrk: product.torobPrk,
            anchorPriceToman: product.costPrice > 0 ? product.costPrice : null,
            multiPrkGraphEnabled,
            hybridIndexEnabled,
        })
        : { knownPrks: product.torobPrk ? [product.torobPrk] : [], knownPrkHints: [], hybridHitsUsed: 0 };
    const source = await (0, registry_1.fetchFromSource)({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        sourceType: product.sourceType,
        torobUrl: product.torobUrl,
        torobPrk: product.torobPrk,
        knownPrks: graphHints.knownPrks,
        knownPrkHints: graphHints.knownPrkHints,
        torobDetailsUrl: product.torobDetailsUrl,
        torobLinkConfirmation: product.torobLinkConfirmation,
        costPrice: product.costPrice,
        supplierQuotes,
        currentFinalPrice: product.currentFinalPrice,
        matchConfig: {
            rejectBelowPct: config.supervisor?.gates?.identity_match?.rejectBelowPct ?? config.supervisor?.rejectBelowPct ?? 45,
            approveAbovePct: config.supervisor?.gates?.identity_match?.approveAbovePct ?? config.supervisor?.approveAbovePct ?? 80,
            minSellerCount: config.filters.minSellerCount,
            aiIdentityEnabled: Boolean(config.ai.enabled && config.ai.torobMatchEnabled === true),
            discoveryMode,
            ownShopNames: config.filters.ownShopNames,
            ownShopIds: config.filters.ownShopIds,
            preferBroadDiscovery: config.discovery?.preferBroadDiscovery ?? false,
            hybridIndexEnabled: config.discovery?.hybridIndexEnabled ?? true,
            multiPrkGraphEnabled: config.discovery?.multiPrkGraphEnabled ?? true,
            singleFlightEnabled: config.discovery?.singleFlightEnabled ?? true,
        },
    }, manualOffers);
    if (source.torob && graphHints.hybridHitsUsed > 0) {
        source.torob.hybridIndexHintsUsed = graphHints.hybridHitsUsed;
    }
    await (0, torob_index_1.persistDiscoveryGraphAndCatalog)({
        productId: product.id,
        source,
        multiPrkGraphEnabled,
        hybridIndexEnabled,
        isSimulated,
    });
    const ownRecentPrices = await loadOwnRecentPrices(product.id, product.currentFinalPrice);
    const pricingContext = {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        costPrice: product.costPrice,
        supplierQuotes,
        minMarginPctOverride: product.minMarginPct,
        minProfitAmountOverride: product.minProfitAmount,
        currentFinalPrice: product.currentFinalPrice,
        ownRecentPrices,
        category: product.category,
        torobUrlManual: Boolean(product.torobUrl && product.torobUrl.trim()),
        config,
        discountContext,
    };
    let result = (0, engine_1.runPricingPipeline)(source, pricingContext);
    const allowCostless = (0, sourcing_1.isMarketMakerWithoutCostEnabled)(config);
    if (config.supervisor.enabled) {
        const subqRuntime = await (0, config_1.resolveSubqRuntime)(config.supervisor);
        let enriched = await (0, systemone_supervisor_1.enrichSupervisorWithSubqApi)(result.supervisor, {
            ...config.supervisor,
            apiKey: subqRuntime.apiKey,
            baseUrl: subqRuntime.baseUrl,
            model: subqRuntime.model,
        });
        if (source.torob && result.torobInquiry?.status === "MATCH_CONFIRMED" && enriched.torobInquiryStatus === "REVIEW_REQUIRED") {
            result = (0, engine_1.runPricingPipeline)({
                ...source,
                torob: { ...source.torob, status: "REVIEW_REQUIRED", identityStatus: "REVIEW_REQUIRED",
                    reason: enriched.gates.identity_match.reason },
            }, pricingContext);
            const gates = { ...result.supervisor.gates, identity_match: enriched.gates.identity_match };
            const overallScorePct = (0, systemone_supervisor_1.weightedSystemOneScore)(Object.values(gates));
            enriched = {
                ...enriched, gates, overallScorePct, overallNoul: overallScorePct / 100,
                summary: `تطابق هویت به بازبینی رفت. امتیاز ناظر با توقف محاسبهٔ قیمت ${overallScorePct}% است`,
            };
        }
        result.supervisor = enriched;
        syncSupervisorAfterEnrichment(result, source.ok, allowCostless);
    }
    const sourceExt = source;
    const sourceDegradedOrChallenged = Boolean(sourceExt.isChallenged ||
        sourceExt.degraded ||
        source.meta?.challenged ||
        source.meta?.degraded ||
        sourceExt.sourceStatus === "challenged" ||
        sourceExt.sourceStatus === "degraded" ||
        sourceExt.sourceStatus === "error");
    if (sourceDegradedOrChallenged) {
        result.needsReview = true;
        const reason = "منبع استعلام ترب در وضعیت چالش ضدربات یا داده ناقص (degraded/challenged) قرار دارد — نیازمند بازبینی انسانی";
        if (!result.reviewReasons.includes(reason)) {
            result.reviewReasons.push(reason);
        }
    }
    // گارد امنیتی مضاعف برای جلوگیری از تشخیص اشتباه کارت و اعمال خودکار کالاهای بدون قیمت خرید:
    // اگر محصول فاقد قیمت خرید همکار است (effectiveCost = 0) و هنوز لینک/PRK ترب برای آن توسط مدیر تایید نشده است (!product.torobPrk)،
    // بار اول حتماً به صف بازبینی (pending_review) می‌رود تا کارت پیدا شده در ترب توسط مدیر تایید شود و سرخود وارد کمپین‌های سایت نگردد!
    const unverifiedFirstSearchWithoutCost = (source.torob ? !source.torob.adminConfirmed : !product.torobPrk && !product.torobUrl) && result.supply.effectiveCostPrice <= 0;
    if (unverifiedFirstSearchWithoutCost && result.finalPrice != null && !result.rejectedBySupervisor) {
        result.needsReview = true;
        result.reviewReasons.push("اولین استعلام خودکار بدون لینک ترب و بدون قیمت خرید همکار — نیازمند یک‌بار تایید کارت ترب در صف بازبینی");
    }
    const strictlyAboveCost = result.finalPrice != null &&
        result.supply.effectiveCostPrice > 0 &&
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
        autoApply: false,
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
    // نظارت انسانی قطعی: هیچ تصمیمی بدون تأیید مدیر در پنل قیمت‌گذاری خودکار به فروشگاه ارسال نمی‌شود
    const readyForApproval = Boolean(!result.rejectedBySupervisor &&
        result.finalPrice != null &&
        !result.needsReview &&
        !result.isProvisional &&
        strictlyAboveCost);
    const status = resolveInitialDecisionStatus({
        rejectedBySupervisor: Boolean(result.rejectedBySupervisor),
        hasFinalPrice: Boolean(result.finalPrice),
        torobStatus: result.torobInquiry?.status,
    });
    if (status === "pending_review" && runMode === "live" && !isSimulated) {
        result.steps.push({
            step: "supervision_gate",
            title: "نظارت اجباری مدیر پیش از اعمال قیمت",
            message: readyForApproval
                ? "آماده تأیید سریع: محاسبات ریاضی، کف سود و تطابق کارت سالم است — منتظر تأیید شما در صف بازبینی"
                : "نیازمند بررسی هشدارها: پیش از اعمال روی سایت، دلایل بازبینی و رقبای ترب را بررسی یا قیمت را ویرایش کنید",
            level: readyForApproval ? "info" : "warn",
            data: {
                readyForApproval,
                reviewReasons: result.reviewReasons,
            },
        });
    }
    if (runMode === "shadow") {
        result.steps.push({
            step: "shadow_validation",
            title: "اجرای آزمایشی در سایه (Shadow Validation — داده واقعی ترب)",
            message: "تصمیم بر اساس مشاهدات واقعی ترب محاسبه و برای ممیزی/کالیبراسیون ثبت شد (بدون ارسال به فروشگاه)",
            level: "info",
            data: {
                runMode: "shadow",
                validationSource: "shadow_torob",
                isSimulated: false,
                wouldAutoApply: false,
            },
        });
    }
    else if (isSimulated) {
        result.steps.push({
            step: "simulation_guard",
            title: "گارد شبیه‌سازی (Simulated Run)",
            message: "این تصمیم با داده‌های شبیه‌سازی/دستی ساخته شده و از استخراج کالیبراسیون و پوش خودکار مستثنی است",
            level: "warn",
            data: {
                runMode: "simulate",
                validationSource: "simulated",
                isSimulated: true,
            },
        });
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
        strictlyAboveCost &&
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
        }
        result.steps.push({
            step: "campaign",
            title: "انتخاب هوشمند از بین ۳ سیستم تخفیف",
            message: pick.reason,
            data: {
                type: pick.type,
                campaignName: pick.campaignName,
                badgeTheme: pick.badgeTheme,
                endsAt: campaignEndsAt?.toISOString() ?? null,
                showInFeaturedDesired: pickShowInFeatured,
                cardIndex,
            },
        });
    }
    const [decision] = await index_ts_1.db
        .insert(schema_1.priceDecisions)
        .values({
        runId,
        productId: product.id,
        source: source.source,
        offersTotal: (0, exports.safeInt)(result.offersTotal) ?? 0,
        offersUsed: (0, exports.safeInt)(result.offersUsed) ?? 0,
        effectiveCostPrice: (0, exports.safeInt)(result.supply.effectiveCostPrice),
        hardFloorPrice: (0, exports.safeInt)(result.supply.hardFloorPrice),
        lowestRaw: (0, exports.safeInt)(result.lowestRaw),
        lowestValid: (0, exports.safeInt)(result.lowestValid),
        localLowestValid: (0, exports.safeInt)(result.position.localLowestPrice),
        marketMedian: (0, exports.safeInt)(result.marketMedian),
        marketMean: (0, exports.safeInt)(result.marketMean),
        referencePrice: (0, exports.safeInt)(result.referencePrice),
        monitoredMarketCeiling: (0, exports.safeInt)(result.floorCeiling.monitoredMarketCeiling),
        basePrice: (0, exports.safeInt)(result.basePrice),
        finalPrice: (0, exports.safeInt)(result.finalPrice),
        discountPct: (0, exports.safeReal)(result.discountPct),
        campaignType,
        campaignName,
        badgeTheme,
        // P0-4: در فاز ۱ «دقیقی» false ثبت می‌شود؛ پس از اولود فاز ۲ صندلی‌ها واقعی می‌شود
        showInFeatured: false,
        strategy: result.strategy,
        competitionTier: result.position.competitionTier,
        projectedNationalRank: (0, exports.safeInt)(result.position.projectedNationalRank),
        projectedLocalRank: (0, exports.safeInt)(result.position.projectedLocalRank),
        // ۴.۱.۲ (N5): هر دو رتبه در تصمیم ذخیره می‌شوند تا رابط بازبینی هر دو را نشان دهد
        rankIncludingSuspect: (0, exports.safeInt)(result.position.rankIncludingSuspect),
        totalSellersIncludingSuspect: (0, exports.safeInt)(result.position.totalSellersIncludingSuspect) ?? 0,
        netProfitToman: (0, exports.safeInt)(result.position.netProfitToman),
        netMarginPct: (0, exports.safeReal)(result.position.netMarginPct),
        confidence: (0, exports.safeReal)(result.confidence),
        engineVersion: config.engine?.version ?? "4.2.0",
        marketConflict: result.marketConflict ?? false,
        referenceKind: result.discountReferenceKind ?? "none",
        floorConfirmed: result.floorConfirmed ?? false,
        pushStatus: status === "pending_sync" ? "pending" : null,
        pushAttempts: 0,
        isSimulated,
        validationSource,
        status,
        steps: result.steps,
    })
        .returning();
    const idempotencyKey = (0, connectors_1.buildIdempotencyKey)({
        productId: product.id,
        sku: product.sku,
        basePrice: (0, exports.safeInt)(result.basePrice) ?? 0,
        finalPrice: (0, exports.safeInt)(result.finalPrice) ?? 0,
        discountPct: (0, exports.safeReal)(result.discountPct),
        campaignType,
        decisionId: decision.id,
        confidence: decision.confidence,
    });
    await index_ts_1.db
        .update(schema_1.priceDecisions)
        .set({ idempotencyKey })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decision.id));
    // حذف تکرار در صف بازبینی: تصمیم‌های pending_review قدیمی‌ترِ همین محصول جایگزین می‌شوند تا هر محصول فقط ۱ کارت فعال داشته باشد
    if (status === "pending_review") {
        await index_ts_1.db
            .update(schema_1.priceDecisions)
            .set({
            status: "superseded",
            pushError: `جایگزین شده با تصمیم جدیدتر #${decision.id}`,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, product.id), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "pending_review"), (0, drizzle_orm_1.lt)(schema_1.priceDecisions.id, decision.id)));
    }
    if (result.offers.length) {
        const offerValues = result.offers
            .map((o) => {
            const safeOfferPrice = (0, exports.safeInt)(o.price);
            if (!safeOfferPrice || safeOfferPrice <= 0)
                return null;
            const observedAt = safeDate(o.observedAt);
            return {
                decisionId: decision.id,
                productId: product.id,
                shopName: o.shopName || "نامشخص",
                shopId: o.shopId ?? null,
                shopCity: o.shopCity ?? null,
                sellerType: o.sellerType ?? "online",
                shopScore: o.shopScore != null && Number.isFinite(o.shopScore) ? o.shopScore : null,
                isLocalCity: !!o.isLocalCity,
                priceUnreliable: !!o.priceUnreliable,
                price: safeOfferPrice,
                lastChangedAt: safeDate(o.lastChangedAt),
                ...(observedAt ? { torobEvidence: {
                        listingTitle: o.listingTitle ?? null, currency: o.currency ?? "toman",
                        observedAt: observedAt.toISOString(), inStock: o.inStock ?? null,
                        identity: o.torobIdentity, imageUrls: o.imageUrls,
                    } } : {}),
                isAd: !!o.isAd,
                inStock: o.inStock !== false,
                url: o.url ?? null,
                included: o.included,
                excludeReason: o.excludeReason ?? null,
                weight: (0, exports.safeReal)(o.weight, 0),
            };
        })
            .filter((x) => x !== null);
        if (offerValues.length) {
            await index_ts_1.db.insert(schema_1.competitorOffers).values(offerValues);
        }
    }
    // قفل کردن PRK در دیتابیس فقط زمانی که تصمیم اعمال شده یا گیت تطابق هویت بالای آستانه تایید خودکار (approve) باشد!
    // A cached primary PRK skips discovery on the next run and loses the secondary panels; self-only PRKs must not lock binding.
    const combinedPanels = Array.isArray(source.meta?.panels) && source.meta.panels.length > 1;
    const selfOnlyPrimary = Boolean(source.torob?.ownStoreOnlyOnPrimary);
    const identityApproved = source.ok && !isSimulated && !combinedPanels && !selfOnlyPrimary &&
        (!result.torobInquiry || result.torobInquiry.status === "MATCH_CONFIRMED") &&
        result.supervisor.gates.identity_match?.verdict === "approve";
    const sameProductBinding = (0, drizzle_orm_1.sql) `${schema_1.products.name} = ${product.name}
    AND ${schema_1.products.sku} = ${product.sku}
    AND ${schema_1.products.torobPrk} IS NOT DISTINCT FROM ${product.torobPrk}
    AND ${schema_1.products.torobUrl} IS NOT DISTINCT FROM ${product.torobUrl}
    AND ${schema_1.products.torobDetailsUrl} IS NOT DISTINCT FROM ${product.torobDetailsUrl}
    AND ${schema_1.products.torobLinkConfirmation} IS NULL`;
    // P0-1 (M2): write-back قیمت خرید ممنوع. قیمت همکار فقط در replacementCost ثبت می‌شود؛
    // costPrice (هزینه موجودی) هرگز از لیست همکار بازنویسی نمی‌شود (INV-2).
    const lowestQuoteCost = (0, exports.safeInt)(result.supply.lowestQuoteCost);
    const safeHardFloor = (0, exports.safeInt)(result.supply.hardFloorPrice);
    const shouldStoreReplacement = (lowestQuoteCost ?? 0) > 0 &&
        (product.costPrice <= 0 || lowestQuoteCost > product.costPrice);
    const coverageInfo = source.torob?.coverage;
    const shouldScheduleExtended = Boolean(!isSimulated &&
        discoveryMode === "interactive" &&
        coverageInfo?.status === "partial" &&
        (coverageInfo.promisingUninspectedCount > 0 || coverageInfo.pagesRemaining > 0));
    const nextNeedsRefresh = shouldScheduleExtended
        ? true
        : (discoveryMode === "extended" || coverageInfo?.status === "complete_within_scope")
            ? false
            : product.needsRefresh;
    await index_ts_1.db
        .update(schema_1.products)
        .set({
        lastCheckedAt: new Date(),
        lastDecisionId: decision.id,
        needsRefresh: nextNeedsRefresh,
        updatedAt: new Date(),
        ...(shouldStoreReplacement
            ? {
                replacementCost: lowestQuoteCost,
                replacementCostAt: new Date(),
            }
            : {}),
        selectedSupplierName: result.supply.selectedQuote?.supplierName ?? product.selectedSupplierName ?? null,
        ...(safeHardFloor && safeHardFloor > 0 ? { currentHardFloorPrice: safeHardFloor } : {}),
        ...(source.prk && !product.torobPrk && identityApproved
            ? { torobPrk: (0, drizzle_orm_1.sql) `CASE WHEN ${sameProductBinding} THEN ${source.prk} ELSE ${schema_1.products.torobPrk} END` } : {}),
        ...(source.detailsUrl && !product.torobDetailsUrl && identityApproved
            ? { torobDetailsUrl: (0, drizzle_orm_1.sql) `CASE WHEN ${sameProductBinding} THEN ${source.detailsUrl} ELSE ${schema_1.products.torobDetailsUrl} END` }
            : {}),
        ...(status === "pending_review" ? { status: "needs_review" } : {}),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.products.id, product.id));
    // برگشت خروجی به‌همنه با فاز ۴ runner — applyDecision پس از تخصیص صندلی منتخب‌ها صدا زده می‌شود
    const deferred = status === "pending_sync" ? { decisionId: decision.id, campaignEndsAt } : undefined;
    const featuredCandidate = status === "pending_sync" &&
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
    const errorHint = status === "rejected" || status === "failed"
        ? !source.ok && source.error
            ? source.error
            : result.rejectedBySupervisor
                ? (0, systemone_supervisor_1.formatSupervisorRejectMessage)(result.supervisor)
                : result.reviewReasons[0] ??
                    result.steps.find((s) => s.level === "error")?.message ??
                    "داده کافی برای محاسبه قیمت یافت نشد"
        : null;
    return { id: decision.id, productId: product.id, status, errorHint, deferred, featuredCandidate };
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
function resolveApplyOptions(campaignEndsAtOrOpts, opts) {
    if (campaignEndsAtOrOpts &&
        typeof campaignEndsAtOrOpts === "object" &&
        !(campaignEndsAtOrOpts instanceof Date)) {
        return {
            campaignEndsAt: campaignEndsAtOrOpts.campaignEndsAt ?? null,
            opts: campaignEndsAtOrOpts,
        };
    }
    return {
        campaignEndsAt: campaignEndsAtOrOpts ?? opts?.campaignEndsAt ?? null,
        opts: opts ?? {},
    };
}
function torobDecisionBlockReason(decision, product) {
    if (decision.status === "superseded")
        return "این تصمیم جایگزین شده است. تازه‌ترین استعلام را بررسی کنید";
    const data = decision.steps?.find((step) => step.step === "torob_inquiry")?.data;
    if (!data?.status)
        return null;
    if (data.status !== "MATCH_CONFIRMED")
        return "استعلام ترب مجوز قیمت‌گذاری ندارد. هویت کارت یا وضعیت پیشنهادها را بررسی و دوباره استعلام کنید";
    if (product) {
        const boundPrk = (0, torob_1.extractPrk)(product.torobUrl, product.torobPrk);
        const candidate = data.candidate;
        if (boundPrk && boundPrk !== candidate?.prk)
            return "ارتباط ترب این محصول پس از استعلام تغییر کرده است. دوباره استعلام کنید";
        const target = data.target;
        if (target && (target.name !== product.name || target.sku !== product.sku))
            return "عنوان یا شناسهٔ کالای داخلی پس از استعلام تغییر کرده است";
    }
    return null;
}
/** Resolve active supplier quotes again just before sending a price. */
async function currentSupply(p) {
    const { config } = await (0, bootstrap_1.getProfileConfig)(p.profileId);
    const supply = (0, sourcing_1.resolveSupplyCost)({
        manualCostPrice: p.costPrice, supplierQuotes: p.supplierQuotes,
        minMarginPctOverride: p.minMarginPct, minProfitAmountOverride: p.minProfitAmount, config,
    });
    return { effectiveCostPrice: Math.max(supply.effectiveCostPrice, p.costPrice),
        hardFloorPrice: Math.max(supply.hardFloorPrice, p.currentHardFloorPrice ?? 0), config };
}
async function decisionSafety(p, d, finalPrice) {
    const current = await currentSupply(p);
    const safety = (0, approval_1.evaluateDecisionFloorSafety)({
        finalPrice, finalStep: 1,
        effectiveCostPrice: current.effectiveCostPrice > 0 ? Math.max(d.effectiveCostPrice ?? 0, current.effectiveCostPrice) : 0,
        hardFloorPrice: Math.max(d.hardFloorPrice ?? 0, current.hardFloorPrice),
    });
    return { safety, config: current.config };
}
async function validatePromotion(p, d, finalPrice, basePrice, discountPct, campaignType, config, manualSelection) {
    if (!discountPct && campaignType === "none" && basePrice === finalPrice)
        return {};
    const evidence = d.steps?.find((s) => s.step === "discount")?.data;
    const reference = Number(evidence?.referencePrice);
    const kind = evidence?.referenceKind;
    if (config.discount.enabled === false || (kind !== "own_price_7d" && kind !== "market_p75") ||
        !Number.isFinite(reference) || basePrice > reference || basePrice <= finalPrice ||
        !Number.isInteger(discountPct) || discountPct < config.discount.minDiscountPct || discountPct > config.discount.maxDiscountPct ||
        Math.round(basePrice * (1 - discountPct / 100)) !== finalPrice) {
        return { error: "تخفیف با مرجع ثبت‌شده یا بازهٔ مجاز سازگار نیست. قیمت مستقیم را انتخاب کنید یا دوباره استعلام بگیرید." };
    }
    if (campaignType === "none")
        return {};
    const recorded = d.steps?.find(s => s.step === "campaign")?.data;
    const campaigns = await index_ts_1.db.select().from(schema_1.discountCampaigns).where((0, drizzle_orm_1.eq)(schema_1.discountCampaigns.type, campaignType));
    const history = campaignType === "flash"
        ? await computeOwnDiscountContext(p.id, config.discount.ownPriceWindowDays ?? 7, config.discount.ownPriceMinHoldHours ?? 48)
        : null;
    const pick = (0, campaigns_1.pickCampaign)(campaigns, {
        productId: p.id, category: p.category, cardIndex: Number(recorded?.cardIndex) || 1,
        preferredCampaignType: manualSelection ? campaignType : p.preferredCampaignType,
        finalPrice, discountPct, discountKind: kind, ownAvg7d: history?.ownAvg7d,
        projectedNationalRank: d.projectedNationalRank, projectedLocalRank: d.projectedLocalRank,
    });
    if (pick.type !== campaignType || !pick.endsAt)
        return { error: "این قیمت شرایط کمپین انتخاب‌شده را ندارد" };
    const recordedEnd = recorded?.type === campaignType && typeof recorded.endsAt === "string"
        ? new Date(recorded.endsAt).getTime() : Infinity;
    const endsAt = new Date(Math.min(pick.endsAt.getTime(), recordedEnd));
    if (!(endsAt.getTime() > Date.now()))
        return { error: "بازهٔ کمپین تمام شده است؛ دوباره استعلام بگیرید" };
    return { endsAt };
}
async function applyHumanOverrideToDecision(decisionId, override) {
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d)
        return { ok: false, finalPrice: 0, message: "تصمیم یافت نشد" };
    const [p] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId)).limit(1);
    if (!p)
        return { ok: false, finalPrice: 0, message: "محصول یافت نشد" };
    const torobBlock = torobDecisionBlockReason(d, p);
    if (torobBlock)
        return { ok: false, finalPrice: 0, message: torobBlock };
    const nextFinal = override.finalPrice != null && Number.isFinite(Number(override.finalPrice)) && Number(override.finalPrice) > 0
        ? Math.round(Number(override.finalPrice))
        : Math.round(d.finalPrice ?? 0);
    if (nextFinal <= 0) {
        return { ok: false, finalPrice: 0, message: "قیمت نهایی یوزر نامعتبر است" };
    }
    let nextBase = nextFinal;
    let nextPct = 0;
    let nextCampaign = d.campaignType ?? "none";
    let nextCampaignName = d.campaignName;
    let nextBadge = d.badgeTheme ?? "green-orange";
    let floorConfirmed = false;
    const disableDiscount = override.useDisplayDiscount === false ||
        (override.discountPct != null && Number.isFinite(Number(override.discountPct)) && Number(override.discountPct) <= 0);
    if (disableDiscount) {
        nextBase = nextFinal;
        nextPct = 0;
        nextCampaign = "none";
        nextCampaignName = null;
    }
    else {
        const wantsDiscount = override.useDisplayDiscount === true ||
            (override.discountPct != null && Number(override.discountPct) > 0) ||
            (override.basePrice != null && Number(override.basePrice) > nextFinal) ||
            ((d.discountPct ?? 0) > 0 && (d.basePrice ?? 0) > nextFinal);
        if (wantsDiscount) {
            let pct = override.discountPct != null && Number.isFinite(Number(override.discountPct)) && Number(override.discountPct) > 0
                ? Math.max(1, Math.min(90, Math.round(Number(override.discountPct))))
                : override.basePrice != null && Number.isFinite(Number(override.basePrice)) && Number(override.basePrice) > nextFinal
                    ? Math.max(1, Math.min(90, Math.floor(((Number(override.basePrice) - nextFinal) / Number(override.basePrice)) * 100)))
                    : Math.max(1, Math.min(90, Math.round(d.discountPct ?? 10)));
            nextBase = (0, discount_1.calibrateBaseForPct)(nextFinal, pct);
            nextPct = pct;
            floorConfirmed = Math.round(nextBase * (1 - nextPct / 100)) === nextFinal;
            if (override.campaignType && ["none", "flash", "featured", "timed_sale"].includes(override.campaignType)) {
                nextCampaign = override.campaignType;
                nextCampaignName =
                    nextCampaign === "flash"
                        ? "پیشنهاد لحظه‌ای"
                        : nextCampaign === "featured"
                            ? "پیشنهاد شگفت‌انگیز"
                            : nextCampaign === "timed_sale"
                                ? "فرصت زمان‌دار"
                                : null;
                nextBadge =
                    nextCampaign === "flash" ? "gold-red" : nextCampaign === "featured" ? "red-purple" : "green-orange";
            }
        }
    }
    const { safety, config } = await decisionSafety(p, d, nextFinal);
    if (!safety.ok)
        return { ok: false, finalPrice: nextFinal, message: safety.reason };
    const manualSelection = nextCampaign !== d.campaignType ||
        d.steps.some(s => s.step === "human_edit" && s.data?.manualSelection === true);
    const promo = await validatePromotion(p, d, nextFinal, nextBase, nextPct, nextCampaign, config, manualSelection);
    if (promo.error)
        return { ok: false, finalPrice: nextFinal, message: promo.error };
    const effectiveCost = safety.effectiveCost;
    const netProfitToman = effectiveCost > 0 ? nextFinal - effectiveCost : 0;
    const netMarginPct = effectiveCost > 0 ? Math.round(((nextFinal - effectiveCost) / effectiveCost) * 10000) / 100 : 0;
    const unchanged = nextFinal === d.finalPrice && nextBase === d.basePrice &&
        nextCampaign === d.campaignType && nextPct === d.discountPct;
    const idempotencyKey = unchanged && d.idempotencyKey ? d.idempotencyKey
        : `decision-${d.id}-p${p.id}-${nextFinal}-${nextBase}-${nextPct}-${nextCampaign}`;
    const nextSteps = [
        ...(Array.isArray(d.steps) ? d.steps : []),
        {
            step: "human_edit",
            title: "ویرایش دستی مدیر پیش از تأیید",
            message: nextPct > 0
                ? `قیمت نهایی یوزر به ${nextFinal.toLocaleString("fa-IR")} تومان با ${nextPct}% تخفیف نمایشی (سقف ${nextBase.toLocaleString("fa-IR")} تومان · کمپین: ${nextCampaign}) تنظیم شد`
                : `قیمت مستقیم نهایی یوزر به ${nextFinal.toLocaleString("fa-IR")} تومان بدون تخفیف نمایشی تنظیم شد`,
            level: "info",
            data: { finalPrice: nextFinal, basePrice: nextBase, discountPct: nextPct, campaignType: nextCampaign,
                manualSelection },
        },
    ];
    await index_ts_1.db
        .update(schema_1.priceDecisions)
        .set({
        finalPrice: nextFinal,
        basePrice: nextBase,
        discountPct: nextPct,
        campaignType: nextCampaign,
        campaignName: nextCampaignName,
        badgeTheme: nextBadge,
        floorConfirmed,
        netProfitToman,
        netMarginPct,
        idempotencyKey,
        steps: nextSteps,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
    return { ok: true, finalPrice: nextFinal };
}
async function applyDecision(decisionId, campaignEndsAtOrOpts, opts) {
    const { campaignEndsAt: requestedEnd, opts: resolvedOpts } = resolveApplyOptions(campaignEndsAtOrOpts, opts);
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d) {
        return { ok: false, code: "INVALID_DECISION", message: "تصمیم نامعتبر" };
    }
    const earlyTorobBlock = torobDecisionBlockReason(d);
    if (earlyTorobBlock)
        return { ok: false, code: "TOROB_REVIEW_REQUIRED", message: earlyTorobBlock };
    if (!d.finalPrice || !d.basePrice)
        return { ok: false, code: "INVALID_DECISION", message: "تصمیم نامعتبر" };
    const [p] = await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId)).limit(1);
    if (!p) {
        return { ok: false, code: "PRODUCT_NOT_FOUND", message: "محصول یافت نشد" };
    }
    const torobBlock = torobDecisionBlockReason(d, p);
    if (torobBlock)
        return { ok: false, code: "TOROB_REVIEW_REQUIRED", message: torobBlock };
    if (d.isSimulated || d.validationSource === "simulated" || d.source === "simulate") {
        return {
            ok: false,
            code: "SIMULATED_DECISION_BLOCKED",
            message: "اعمال تصمیم شبیه‌سازی‌شده (simulated) روی فروشگاه واقعی ممنوع است",
        };
    }
    if (d.source !== "torob" && d.source !== "manual") {
        return {
            ok: false,
            code: "INVALID_DECISION_SOURCE",
            message: `اعمال تصمیم با منبع «${d.source}» ممنوع است؛ فقط تصمیم‌های مبتنی بر داده واقعی ترب یا ورود دستی مجاز به ارسال به فروشگاه‌اند`,
        };
    }
    if (isSupervisorRejected({ status: d.status, steps: (d.steps ?? []) }) &&
        !resolvedOpts.force) {
        return {
            ok: false,
            code: "SUPERVISOR_REJECTED",
            message: "این تصمیم توسط ناظر SystemOne رد شده (امتیاز زیر آستانه رد) و قابل اعمال نیست. برای بازبینی، محصول را با منبع/قیمت اصلاح و دوباره استعلام بگیرید.",
        };
    }
    const { safety, config } = await decisionSafety(p, d, d.finalPrice);
    if (!safety.ok)
        return { ok: false, code: safety.status.toUpperCase(), message: safety.reason };
    const { effectiveCost, effectiveFloor } = safety;
    const manualSelection = d.steps.some(s => s.step === "human_edit" && s.data?.manualSelection === true);
    const promo = await validatePromotion(p, d, d.finalPrice, d.basePrice, d.discountPct ?? 0, d.campaignType ?? "none", config, manualSelection);
    if (promo.error)
        return { ok: false, code: "INVALID_PROMOTION", message: promo.error };
    const campaignEndsAt = promo.endsAt && requestedEnd
        ? new Date(Math.min(requestedEnd.getTime(), promo.endsAt.getTime())) : promo.endsAt ?? null;
    const idempotencyKey = d.idempotencyKey ||
        (0, connectors_1.buildIdempotencyKey)({
            productId: p.id,
            sku: p.sku,
            basePrice: d.basePrice,
            finalPrice: d.finalPrice,
            discountPct: d.discountPct ?? 0,
            campaignType: d.campaignType ?? "none",
            decisionId: d.id,
            confidence: d.confidence,
        });
    const attemptTime = new Date();
    const push = await (0, connectors_1.pushToStore)({
        productId: p.id,
        sku: p.sku,
        storeExternalId: p.storeExternalId,
        effectiveCostPrice: effectiveCost,
        hardFloorPrice: effectiveFloor,
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
        idempotencyKey,
        confidence: d.confidence,
        projectedNationalRank: d.projectedNationalRank,
        projectedLocalRank: d.projectedLocalRank,
        competitionTier: d.competitionTier,
    });
    const nextAttempts = (d.pushAttempts ?? 0) + Math.max(1, push.attempts ?? 1);
    // اگر ارسال به فروشگاه تایید نشد (یا کانکتور فعال نبود)، هرگز قیمت محصول در دیتابیس محلی
    // به عنوان قیمت اعمال‌شده بازنویسی نمی‌شود و تصمیم برچسب applied نمی‌خورد!
    if (!push.ok || push.skipped) {
        const nextStatus = push.skipped ? "pending_sync" : "sync_failed";
        const nextPushStatus = push.skipped ? "skipped" : "failed";
        await index_ts_1.db
            .update(schema_1.priceDecisions)
            .set({
            status: nextStatus,
            pushStatus: nextPushStatus,
            pushError: push.message,
            pushAttempts: nextAttempts,
            lastPushAttemptAt: attemptTime,
            idempotencyKey,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
        await (0, bootstrap_1.logActivity)("apply", `عدم اعمال قیمت ${p.sku} در فروشگاه (${nextStatus}): ${push.message}`, {
            decisionId: d.id,
            productId: p.id,
            status: nextStatus,
            pushStatus: nextPushStatus,
            attempts: nextAttempts,
            code: push.code,
        }, push.skipped ? "warn" : "error");
        return {
            ok: false,
            code: push.code ?? (push.skipped ? "NO_ACTIVE_CONNECTOR" : "STORE_SYNC_FAILED"),
            status: nextStatus,
            pushStatus: nextPushStatus,
            message: push.message,
            push,
            idempotencyKey,
        };
    }
    const confirmedFinalPrice = push.confirmedPrice ?? d.finalPrice;
    // فقط پس از تایید قطعی فروشگاه، قیمت‌های فعلی محصول و وضعیت applied بروزرسانی می‌شوند
    await index_ts_1.db
        .update(schema_1.products)
        .set({
        currentBasePrice: d.basePrice,
        currentFinalPrice: confirmedFinalPrice,
        currentDiscountPct: d.discountPct,
        currentCampaign: d.campaignType,
        currentCampaignName: d.campaignName,
        currentBadgeTheme: d.badgeTheme ?? "green-orange",
        currentShowInFeatured: d.showInFeatured ?? false,
        // P0-3: تایمر کمپین روی خودِ محصول ذخیره می‌شود تا پیوستگی و گارد انقضا کار کند
        currentCampaignEndsAt: campaignEndsAt,
        lastDecisionId: d.id,
        needsRefresh: false,
        status: "active",
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.products.id, p.id));
    await index_ts_1.db
        .update(schema_1.priceDecisions)
        .set({
        status: "applied",
        pushStatus: "pushed",
        pushError: null,
        pushedAt: attemptTime,
        lastPushAttemptAt: attemptTime,
        pushAttempts: nextAttempts,
        storeConfirmedPrice: confirmedFinalPrice,
        idempotencyKey,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
    // ۴.۲.۱ (F5): در این ساختار، قیمت محصول فقط پس از تایید قطعی فروشگاه نوشته می‌شود (بالا)؛
    // بنابراین در شکست push، «قیمت فعلی» موتور همان قیمت قبل از تصمیم می‌ماند و اجرای بعد دوباره تلاش می‌کند.
    await (0, bootstrap_1.logActivity)("apply", `قیمت ${p.sku}: سقف معیار ${d.basePrice} با ${d.discountPct}% تخفیف → کف تاییدشده ${confirmedFinalPrice} | کمپین: ${d.campaignType}${campaignEndsAt ? ` تا ${campaignEndsAt.toISOString()}` : ""} | رتبه مشهد: #${d.projectedLocalRank ?? "-"} — ${push.message}${resolvedOpts.force ? " (اعمال دستی با force)" : ""}`, {
        decisionId: d.id,
        productId: p.id,
        forced: !!resolvedOpts.force,
        idempotencyKey,
        confirmedPrice: confirmedFinalPrice,
        attempts: nextAttempts,
    }, "info");
    return {
        ok: true,
        code: push.code ?? "STORE_SYNC_CONFIRMED",
        status: "applied",
        pushStatus: "pushed",
        message: push.message,
        push,
        idempotencyKey,
        confirmedPrice: confirmedFinalPrice,
    };
}
exports.applyDecisionToStore = applyDecision;
async function retryDecisionSync(decisionId, opts) {
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d) {
        return { ok: false, code: "DECISION_NOT_FOUND", message: "تصمیم یافت نشد" };
    }
    const [newerPushed] = await index_ts_1.db
        .select({ id: schema_1.priceDecisions.id })
        .from(schema_1.priceDecisions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, d.productId), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.eq)(schema_1.priceDecisions.pushStatus, "pushed"), (0, drizzle_orm_1.gt)(schema_1.priceDecisions.id, d.id)))
        .limit(1);
    if (newerPushed) {
        const msg = `تصمیم جدیدتر #${newerPushed.id} قبلاً روی فروشگاه اعمال شده است (superseded)`;
        await index_ts_1.db
            .update(schema_1.priceDecisions)
            .set({
            status: "superseded",
            pushStatus: "superseded",
            pushError: msg,
            lastPushAttemptAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, d.id));
        return {
            ok: false,
            code: "DECISION_SUPERSEDED",
            status: "superseded",
            pushStatus: "superseded",
            message: msg,
        };
    }
    return applyDecision(decisionId, opts);
}
async function reconcilePendingDecisions(opts) {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? MAX_AUTO_SYNC_ATTEMPTS);
    const conds = [
        (0, drizzle_orm_1.or)((0, drizzle_orm_1.inArray)(schema_1.priceDecisions.status, ["pending_sync", "sync_failed"]), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.ne)(schema_1.priceDecisions.pushStatus, "pushed")), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.priceDecisions.status, "applied"), (0, drizzle_orm_1.isNull)(schema_1.priceDecisions.pushStatus))),
        (0, drizzle_orm_1.lt)(schema_1.priceDecisions.pushAttempts, maxAttempts),
    ];
    if (opts?.productId) {
        conds.push((0, drizzle_orm_1.eq)(schema_1.priceDecisions.productId, opts.productId));
    }
    const pendingRows = await index_ts_1.db
        .select()
        .from(schema_1.priceDecisions)
        .where((0, drizzle_orm_1.and)(...conds))
        .orderBy((0, drizzle_orm_1.asc)(schema_1.priceDecisions.id))
        .limit(limit);
    // برای هر محصول فقط آخرین تصمیم در انتظار همگام‌سازی باید اعمال شود و قدیمی‌ترها superseded می‌شوند
    const latestPendingByProduct = new Map();
    for (const row of pendingRows) {
        const prev = latestPendingByProduct.get(row.productId) ?? 0;
        if (row.id > prev)
            latestPendingByProduct.set(row.productId, row.id);
    }
    let synced = 0;
    let failed = 0;
    let skipped = 0;
    let superseded = 0;
    const results = [];
    for (const row of pendingRows) {
        const latestPendingId = latestPendingByProduct.get(row.productId) ?? row.id;
        if (row.id < latestPendingId) {
            const msg = `تصمیم جدیدتر #${latestPendingId} در صف همگام‌سازی همین محصول وجود دارد (superseded)`;
            await index_ts_1.db
                .update(schema_1.priceDecisions)
                .set({
                status: "superseded",
                pushStatus: "superseded",
                pushError: msg,
                lastPushAttemptAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, row.id));
            superseded++;
            results.push({ decisionId: row.id, productId: row.productId, ok: false, status: "superseded", message: msg });
            continue;
        }
        const res = await retryDecisionSync(row.id, { force: opts?.force });
        const status = res.status ?? (res.ok ? "applied" : "sync_failed");
        if (res.ok)
            synced++;
        else if (status === "superseded")
            superseded++;
        else if (res.push?.skipped)
            skipped++;
        else
            failed++;
        results.push({
            decisionId: row.id,
            productId: row.productId,
            ok: res.ok,
            status,
            message: res.message,
        });
    }
    return {
        checked: pendingRows.length,
        synced,
        failed,
        skipped,
        superseded,
        results,
    };
}
async function rejectDecision(decisionId) {
    const [d] = await index_ts_1.db.select().from(schema_1.priceDecisions).where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId)).limit(1);
    if (!d)
        return;
    await index_ts_1.db
        .update(schema_1.priceDecisions)
        .set({ status: "rejected", campaignType: "none", campaignName: null, showInFeatured: false })
        .where((0, drizzle_orm_1.eq)(schema_1.priceDecisions.id, decisionId));
    await index_ts_1.db.update(schema_1.products).set({ status: "active", updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.products.id, d.productId));
    await (0, bootstrap_1.logActivity)("apply", `تصمیم #${decisionId} رد شد`, { decisionId });
}
/**
 * پاک‌سازی فوری کارت‌هایی که به اشتباه در دسته ۳ (فرصت‌های زمان‌دار / timed_sale) قرار گرفته‌اند
 * + حذف آن‌ها از کالکشن Sale در بک‌اند فروشگاه (ekgkala-backend) و ریست قفل ترب
 */
async function cleanupWrongTimedSaleCards(opts) {
    const targetRows = opts?.productId
        ? await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.id, opts.productId))
        : await index_ts_1.db.select().from(schema_1.products).where((0, drizzle_orm_1.eq)(schema_1.products.currentCampaign, "timed_sale"));
    const cleanedProducts = [];
    const storeResetResults = [];
    for (const p of targetRows) {
        const safePrice = p.currentFinalPrice || p.currentBasePrice || 0;
        await index_ts_1.db
            .update(schema_1.products)
            .set({
            currentCampaign: "none",
            currentCampaignName: null,
            currentDiscountPct: 0,
            currentShowInFeatured: false,
            currentCampaignEndsAt: null,
            currentBasePrice: safePrice > 0 ? safePrice : p.currentBasePrice,
            // اگر محصول قیمت خرید نداشت و به اشتباه به یک PRK ترب قفل شده بود، قفل PRK را آزاد کن تا دوباره تمیز استعلام شود
            ...(p.costPrice <= 0 ? { torobPrk: p.torobLinkConfirmation?.prk ?? null, torobDetailsUrl: null, autoApply: false } : {}),
            status: "active",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.products.id, p.id));
        await index_ts_1.db
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
            const current = await currentSupply(p);
            const pushRes = await (0, connectors_1.pushToStore)({
                productId: p.id,
                sku: p.sku,
                storeExternalId: p.storeExternalId,
                effectiveCostPrice: current.effectiveCostPrice,
                hardFloorPrice: current.hardFloorPrice,
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
    await index_ts_1.db
        .update(schema_1.discountCampaigns)
        .set({ active: false, minDiscountPct: 10, cardRangeFrom: 21, cardRangeTo: 50 })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountCampaigns.type, "timed_sale"), (0, drizzle_orm_1.eq)(schema_1.discountCampaigns.minDiscountPct, 3)));
    // آزادسازی قفل‌های گیرکردهٔ محصولات در دیتابیس
    await index_ts_1.db.update(schema_1.products).set({ lockedUntil: null }).where((0, drizzle_orm_1.isNotNull)(schema_1.products.lockedUntil));
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
