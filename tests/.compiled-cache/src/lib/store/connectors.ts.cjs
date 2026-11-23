"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sgeoooleAdapter = exports.adapters = void 0;
exports.buildIdempotencyKey = buildIdempotencyKey;
exports.canonicalizePricingSyncPayload = canonicalizePricingSyncPayload;
exports.computePricingSyncSignature = computePricingSyncSignature;
exports.buildSgeoooleRequestPayload = buildSgeoooleRequestPayload;
exports.verifyStoreDryRun = verifyStoreDryRun;
exports.getActiveConnector = getActiveConnector;
exports.getStoreStatus = getStoreStatus;
exports.pushToStore = pushToStore;
const node_crypto_1 = __importDefault(require("node:crypto"));
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const sgeooole_ack_1 = require("./sgeooole-ack");
const drizzle_orm_1 = require("drizzle-orm");
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 150;
function buildIdempotencyKey(p) {
    const explicit = p.idempotencyKey?.trim();
    if (explicit)
        return explicit;
    return `decision-${p.decisionId}-p${p.productId}-${Math.round(p.finalPrice)}`;
}
function canonicalizePricingSyncPayload(payload) {
    const pricingMeta = payload.pricingMeta ?? {};
    const timedSale = payload.timedSale ?? {};
    const decisionId = payload.decisionId ?? pricingMeta.decisionId ?? null;
    const idempotencyKey = payload.idempotencyKey ?? pricingMeta.idempotencyKey ?? null;
    const canonical = {
        sku: String(payload.sku ?? "").trim(),
        productCode: String(payload.productCode ?? "").trim().toUpperCase(),
        productId: String(payload.productId ?? "").trim(),
        finalPrice: Number(payload.finalPrice ?? payload.price ?? 0),
        basePrice: Number(payload.basePrice ?? payload.compareAtPrice ?? payload.finalPrice ?? payload.price ?? 0),
        costPrice: Number(payload.costPrice ?? 0),
        hardFloorPrice: Number(payload.hardFloorPrice ?? 0),
        campaignType: String(payload.campaignType ?? "none"),
        discount: Number(payload.discount ?? timedSale.discountPercentage ?? 0),
        decisionId: decisionId != null ? String(decisionId) : "",
        idempotencyKey: idempotencyKey != null ? String(idempotencyKey) : "",
    };
    return JSON.stringify(canonical);
}
function computePricingSyncSignature(secret, timestamp, payload) {
    const canonical = canonicalizePricingSyncPayload(payload);
    return node_crypto_1.default.createHmac("sha256", String(secret)).update(`${timestamp}.${canonical}`, "utf8").digest("hex");
}
function hasValidBelowCostOverride(override) {
    return Boolean(override &&
        override.allowBelowCost === true &&
        typeof override.reason === "string" &&
        override.reason.trim().length >= 5 &&
        typeof override.authorizedBy === "string" &&
        override.authorizedBy.trim().length >= 2);
}
async function fetchWithTimeout(url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Store request timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function sleep(ms) {
    if (ms <= 0)
        return;
    await new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * کانکتور اختصاصی فروشگاه sgeooole (`ekgkala-backend`):
 * پشتیبانی کامل و بدون تداخل از هر ۳ سیستم تخفیف `sgeooole`:
 *  1. `flash` («پیشنهاد لحظه‌ای» در صفحه اصلی):
 *     - `Product.isFlashDeal = true`, `Product.isSpecialOffer = false`
 *     - حذف خودکار محصول از کمپین‌های `Sale` فعال برای جلوگیری از خطای `409 CAMPAIGN_CONFLICT`
 *  2. `featured` («پیشنهاد شگفت‌انگیز» در صفحه اصلی):
 *     - `Product.isSpecialOffer = true`, `Product.isFlashDeal = false`
 *     - حذف خودکار محصول از کمپین‌های `Sale` فعال برای جلوگیری از خطای `409 CAMPAIGN_CONFLICT`
 *  3. `timed_sale` («مدیریت فرصت‌های زمان‌دار» در بخش مالی و تخفیف پنل مدیریت — مدل `Sale`):
 *     - ساخت یا بروزرسانی خودکار سند `Sale` در بخش مالی و تخفیف با `name`, `discountPercentage`, `badgeTheme` (`green-orange` | `gold-red` | `red-purple`) و `showInFeatured` (نمایش در بخش منتخب‌های صفحه اصلی)
 *     - تنظیم `Product.price = basePrice (سقف معیار)` و خاموش کردن `isFlashDeal` / `isSpecialOffer` و `discount = 0` روی خود `Product` تا تخفیف دقیقاً از طریق کمپین `Sale` روی کف اعمال شود!
 */
function buildSgeoooleRequestPayload(p) {
    const intDiscountPct = p.discountPct > 0 && p.basePrice > p.finalPrice
        ? Math.max(1, Math.min(99, Math.round(p.discountPct)))
        : 0;
    const isFlash = p.campaignType === "flash" && intDiscountPct > 0;
    const isSpecial = p.campaignType === "featured" && intDiscountPct > 0;
    const isTimedSale = p.campaignType === "timed_sale" && intDiscountPct > 0;
    const hasDirectProductPromo = isFlash || isSpecial;
    const hasAnyPromo = hasDirectProductPromo || isTimedSale;
    const defaultHours = isFlash ? 12 : isSpecial ? 48 : 72;
    const endIso = p.campaignEndsAt ?? new Date(Date.now() + defaultHours * 3600 * 1000).toISOString();
    const badgeTheme = p.badgeTheme ||
        (isFlash ? "gold-red" : isSpecial ? "red-purple" : "green-orange");
    const idempotencyKey = buildIdempotencyKey(p);
    const belowCostOverride = hasValidBelowCostOverride(p.belowCostOverride)
        ? {
            allowBelowCost: true,
            reason: p.belowCostOverride.reason.trim(),
            authorizedBy: p.belowCostOverride.authorizedBy.trim(),
        }
        : undefined;
    return {
        sku: p.sku,
        productCode: p.storeExternalId?.toUpperCase().startsWith("KY-") ? p.storeExternalId.toUpperCase() : undefined,
        productId: p.storeExternalId && !p.storeExternalId.toUpperCase().startsWith("KY-") ? p.storeExternalId : undefined,
        decisionId: p.decisionId,
        idempotencyKey,
        ...(belowCostOverride ? { belowCostOverride } : {}),
        // فیلدهای استاندارد مدل Product در sgeooole:
        // نکته کلیدی: در timed_sale قیمت پایه روی Product برابر سقف معیار (basePrice) قرار می‌گیرد و تخفیف از طریق مدل Sale اعمال می‌شود
        price: hasAnyPromo ? p.basePrice : p.finalPrice,
        compareAtPrice: hasDirectProductPromo ? p.basePrice : null,
        discount: hasDirectProductPromo ? intDiscountPct : 0,
        isFlashDeal: isFlash,
        flashDealEndTime: isFlash ? endIso : null,
        isSpecialOffer: isSpecial,
        specialOfferEndTime: isSpecial ? endIso : null,
        // اطلاعات کامل سیستم تخفیف برای هماهنگی هر ۳ موتور در بک‌اند sgeooole
        campaignType: hasAnyPromo ? p.campaignType : "none",
        timedSale: isTimedSale
            ? {
                enabled: true,
                name: p.campaignName || "فروش ویژه هوشمند",
                discountPercentage: intDiscountPct,
                endDate: endIso,
                badgeTheme,
                showInFeatured: p.showInFeatured ?? true,
            }
            : {
                enabled: false,
            },
        // فیلدهای تکمیلی قیمت‌گذاری رقابتی، سقف و کف بازار و تامین همکاران
        finalPrice: p.finalPrice,
        basePrice: p.basePrice,
        monitoredMarketCeiling: p.monitoredMarketCeiling ?? p.basePrice,
        costPrice: p.effectiveCostPrice ?? 0,
        hardFloorPrice: p.hardFloorPrice ?? 0,
        pricingMeta: {
            decisionId: p.decisionId,
            idempotencyKey,
            ...(belowCostOverride ? { belowCostOverride } : {}),
            confidence: p.confidence,
            projectedNationalRank: p.projectedNationalRank ?? null,
            projectedLocalRank: p.projectedLocalRank ?? null,
            competitionTier: p.competitionTier ?? null,
            campaignType: hasAnyPromo ? p.campaignType : "none",
            campaignName: p.campaignName ?? null,
            badgeTheme,
            showInFeatured: p.showInFeatured ?? (isSpecial || isTimedSale),
            updatedAt: new Date().toISOString(),
        },
        rebuildTorobFeed: true,
    };
}
/**
 * اعتبارسنجی سخت‌گیرانه (fail-closed) در برابر اندپوینت `?dryRun=1` فروشگاه:
 * هرگونه خطای شبکه، تایم‌اوت، وضعیت HTTP غیر 2xx، بدنه خالی، JSON نامعتبر،
 * یا نبود تایید صریح (`ok === true && valid === true`) مانع ارسال قیمت زنده می‌شود.
 */
async function verifyStoreDryRun(cfg, p, opts) {
    const baseUrl = (cfg.baseUrl ?? process.env.SGEOOOLE_API_URL ?? "").replace(/\/$/, "");
    const apiKey = (cfg.apiKey ?? process.env.SGEOOOLE_PRICING_SECRET ?? process.env.STORE_WEBHOOK_SECRET ?? "").trim();
    const bearerToken = (cfg.adminToken ?? process.env.SGEOOOLE_ADMIN_TOKEN ?? "").trim();
    const timeoutMs = Number(cfg.timeoutMs ?? opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!baseUrl) {
        return {
            ok: false,
            code: "MISSING_BASE_URL",
            stage: "config",
            retryable: false,
            message: "آدرس سرور sgeooole (baseUrl / SGEOOOLE_API_URL) تنظیم نشده است",
        };
    }
    const bodyPayload = buildSgeoooleRequestPayload(p);
    const timestamp = String(Date.now());
    const headers = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": bodyPayload.idempotencyKey,
        "X-Pricing-Timestamp": timestamp,
        ...(apiKey
            ? {
                "X-Pricing-Secret": apiKey,
                "X-Pricing-Signature": `sha256=${computePricingSyncSignature(apiKey, timestamp, bodyPayload)}`,
            }
            : {}),
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    };
    const syncProbeUrl = `${baseUrl}/api/products/pricing-sync?dryRun=1`;
    let dryRes;
    try {
        dryRes = await fetchWithTimeout(syncProbeUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyPayload),
            cache: "no-store",
        }, timeoutMs);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            code: "DRY_RUN_NETWORK_ERROR",
            stage: "dry_run",
            retryable: true,
            idempotencyKey: bodyPayload.idempotencyKey,
            message: `خطای شبکه/تایم‌اوت در dry-run فروشگاه (اعمال قیمت متوقف شد): ${msg}`,
        };
    }
    const rawText = await dryRes.text().catch(() => "");
    if (!rawText || !rawText.trim()) {
        return {
            ok: false,
            code: dryRes.ok ? "DRY_RUN_EMPTY_RESPONSE" : `DRY_RUN_HTTP_${dryRes.status}`,
            stage: "dry_run",
            retryable: dryRes.status >= 500 || dryRes.status === 429,
            idempotencyKey: bodyPayload.idempotencyKey,
            message: `پاسخ خالی از dry-run فروشگاه (HTTP ${dryRes.status}) — اعمال قیمت متوقف شد`,
        };
    }
    let dryJson = null;
    try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            dryJson = parsed;
        }
    }
    catch {
        dryJson = null;
    }
    if (!dryJson) {
        return {
            ok: false,
            code: "DRY_RUN_INVALID_JSON",
            stage: "dry_run",
            retryable: dryRes.status >= 500,
            idempotencyKey: bodyPayload.idempotencyKey,
            message: `پاسخ غیر JSON یا نامعتبر از dry-run فروشگاه (HTTP ${dryRes.status}) — اعمال قیمت متوقف شد`,
        };
    }
    if (!dryRes.ok) {
        const errMsg = String(dryJson.message ?? dryJson.error ?? dryJson.reason ?? `HTTP ${dryRes.status}`);
        const errCode = String(dryJson.code ?? `DRY_RUN_HTTP_${dryRes.status}`);
        return {
            ok: false,
            code: errCode,
            stage: "dry_run",
            retryable: dryRes.status >= 500 || dryRes.status === 429,
            idempotencyKey: bodyPayload.idempotencyKey,
            message: `خطای HTTP ${dryRes.status} در dry-run فروشگاه: ${errMsg}`,
        };
    }
    if (dryJson.ok !== true || dryJson.valid !== true) {
        const errMsg = String(dryJson.message ?? dryJson.error ?? dryJson.reason ?? "تایید صریح ok/valid دریافت نشد");
        const errCode = String(dryJson.code ?? "DRY_RUN_REJECTED");
        return {
            ok: false,
            code: errCode,
            stage: "dry_run",
            retryable: false,
            idempotencyKey: bodyPayload.idempotencyKey,
            message: `dry-run فروشگاه رد کرد (${errCode}): ${errMsg}`,
        };
    }
    return {
        ok: true,
        code: "DRY_RUN_OK",
        stage: "dry_run",
        idempotencyKey: bodyPayload.idempotencyKey,
        message: "dry-run فروشگاه با موفقیت تایید شد",
    };
}
const sgeooole = {
    type: "sgeooole",
    async push(cfg, p, opts) {
        const overrideAllowed = hasValidBelowCostOverride(p.belowCostOverride);
        // حفاظت نهایی قبل از ارسال به سایت: هرگز قیمت فروش <= قیمت خرید نباشد (مگر با مجوز صریح ممیزی‌شده)
        if (!overrideAllowed && p.effectiveCostPrice && p.effectiveCostPrice > 0 && p.finalPrice <= p.effectiveCostPrice) {
            return {
                ok: false,
                code: "BELOW_COST_PRICE",
                stage: "precheck",
                retryable: false,
                attempts: 1,
                message: `مسدود شد: قیمت نهایی (${p.finalPrice}) کمتر یا مساوی قیمت خرید/تامین (${p.effectiveCostPrice}) است!`,
            };
        }
        if (!overrideAllowed && p.hardFloorPrice && p.hardFloorPrice > 0 && p.finalPrice < p.hardFloorPrice) {
            return {
                ok: false,
                code: "BELOW_HARD_FLOOR",
                stage: "precheck",
                retryable: false,
                attempts: 1,
                message: `مسدود شد: قیمت نهایی (${p.finalPrice}) کمتر از خط قرمز کف سود (${p.hardFloorPrice}) است!`,
            };
        }
        const baseUrl = (cfg.baseUrl ?? process.env.SGEOOOLE_API_URL ?? "").replace(/\/$/, "");
        const apiKey = (cfg.apiKey ?? process.env.SGEOOOLE_PRICING_SECRET ?? process.env.STORE_WEBHOOK_SECRET ?? "").trim();
        const bearerToken = (cfg.adminToken ?? process.env.SGEOOOLE_ADMIN_TOKEN ?? "").trim();
        const timeoutMs = Number(cfg.timeoutMs ?? opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const maxAttempts = Math.max(1, Math.min(5, Number(cfg.maxRetries ?? opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)));
        const baseDelayMs = Math.max(0, Number(cfg.retryDelayMs ?? opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
        if (!baseUrl) {
            return {
                ok: false,
                code: "MISSING_BASE_URL",
                stage: "config",
                retryable: false,
                attempts: 0,
                message: "آدرس سرور sgeooole (baseUrl / SGEOOOLE_API_URL) تنظیم نشده است",
            };
        }
        const idempotencyKey = buildIdempotencyKey(p);
        let lastFailure = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                await sleep(baseDelayMs * Math.pow(2, attempt - 2));
            }
            // ۰) اعتبارسنجی fail-closed از طریق dry-run قبل از هر ارسال زنده
            const dryCheck = await verifyStoreDryRun(cfg, { ...p, idempotencyKey }, { timeoutMs });
            if (!dryCheck.ok) {
                lastFailure = { ...dryCheck, attempts: attempt };
                if (dryCheck.retryable && attempt < maxAttempts) {
                    continue;
                }
                return lastFailure;
            }
            const bodyPayload = buildSgeoooleRequestPayload({ ...p, idempotencyKey });
            const timestamp = String(Date.now());
            const headers = {
                "Content-Type": "application/json",
                "X-Idempotency-Key": bodyPayload.idempotencyKey,
                "X-Pricing-Timestamp": timestamp,
                ...(apiKey
                    ? {
                        "X-Pricing-Secret": apiKey,
                        "X-Pricing-Signature": `sha256=${computePricingSyncSignature(apiKey, timestamp, bodyPayload)}`,
                    }
                    : {}),
                ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
            };
            // ۱) ارسال به اندپوینت اختصاصی همگام‌سازی قیمت در sgeooole
            const syncUrl = `${baseUrl}/api/products/pricing-sync`;
            let res;
            try {
                res = await fetchWithTimeout(syncUrl, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(bodyPayload),
                    cache: "no-store",
                }, timeoutMs);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                lastFailure = {
                    ok: false,
                    code: "LIVE_PUSH_NETWORK_ERROR",
                    stage: "live_push",
                    retryable: true,
                    attempts: attempt,
                    idempotencyKey,
                    message: `خطای شبکه/تایم‌اوت هنگام ارسال قیمت به sgeooole: ${msg}`,
                };
                if (attempt < maxAttempts)
                    continue;
                return lastFailure;
            }
            const rawBody = await res.text().catch(() => "");
            let liveJson = null;
            if (rawBody && rawBody.trim()) {
                try {
                    const parsed = JSON.parse(rawBody);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        liveJson = parsed;
                    }
                }
                catch {
                    liveJson = null;
                }
            }
            if (!res.ok) {
                const errMsg = liveJson
                    ? String(liveJson.message ?? liveJson.error ?? `HTTP ${res.status}`)
                    : rawBody.slice(0, 300) || `HTTP ${res.status}`;
                const errCode = liveJson && liveJson.code ? String(liveJson.code) : `LIVE_PUSH_HTTP_${res.status}`;
                const retryable = res.status >= 500 || res.status === 429;
                lastFailure = {
                    ok: false,
                    code: errCode,
                    stage: "live_push",
                    retryable,
                    attempts: attempt,
                    idempotencyKey,
                    message: `sgeooole HTTP ${res.status} — ${errMsg}`,
                };
                if (retryable && attempt < maxAttempts)
                    continue;
                return lastFailure;
            }
            if (!liveJson || (liveJson.success !== true && liveJson.ok !== true)) {
                const errMsg = liveJson
                    ? String(liveJson.message ?? liveJson.error ?? "پاسخ فروشگاه فاقد تایید موفقیت بود")
                    : "پاسخ فروشگاه JSON معتبر نبود";
                lastFailure = {
                    ok: false,
                    code: liveJson && liveJson.code ? String(liveJson.code) : "LIVE_PUSH_UNCONFIRMED",
                    stage: "reconcile",
                    retryable: false,
                    attempts: attempt,
                    idempotencyKey,
                    message: `عدم تایید اعمال قیمت توسط sgeooole: ${errMsg}`,
                };
                return lastFailure;
            }
            // ۲) تطبیق قیمت تاییدشده فروشگاه با قیمت ارسالی (Store Reconciliation)
            const dataObj = liveJson.data && typeof liveJson.data === "object" && !Array.isArray(liveJson.data)
                ? liveJson.data
                : null;
            const confirmedFinalPrice = dataObj && dataObj.finalPrice !== undefined && dataObj.finalPrice !== null
                ? Number(dataObj.finalPrice)
                : Math.round(p.finalPrice);
            if (!Number.isFinite(confirmedFinalPrice) || Math.abs(confirmedFinalPrice - Math.round(p.finalPrice)) > 1) {
                return {
                    ok: false,
                    code: "STORE_RECONCILIATION_MISMATCH",
                    stage: "reconcile",
                    retryable: false,
                    attempts: attempt,
                    idempotencyKey,
                    message: `عدم تطابق قیمت تاییدشده فروشگاه (${confirmedFinalPrice}) با قیمت تصمیم (${Math.round(p.finalPrice)})`,
                };
            }
            // ۴.۲.۱ — تأیید حلقه‌بسته (F4): فروشگاه «قیمت مؤثر» (همان که مشتری و فید ترب می‌بینند) را برمی‌گرداند.
            // اگر با قیمت تصمیم فرق داشته باشد (کمپین/Sale دستی، گارد کف، محصول متغیر…) «اعمال موفق» گزارش نمی‌شود.
            // فروشگاه قدیمی که effective* نمی‌فرستد ⇒ interpretSgeoooleAck برابر null است و رفتار قبلی حفظ می‌شود.
            const ackFailure = (0, sgeooole_ack_1.interpretSgeoooleAck)(liveJson, p.finalPrice);
            if (ackFailure) {
                return {
                    ok: false,
                    code: "STORE_EFFECTIVE_MISMATCH",
                    stage: "reconcile",
                    retryable: false,
                    attempts: attempt,
                    idempotencyKey,
                    message: ackFailure.message,
                };
            }
            return {
                ok: true,
                code: liveJson.idempotentReplay ? "STORE_SYNC_IDEMPOTENT_REPLAY" : "STORE_SYNC_CONFIRMED",
                stage: "reconcile",
                attempts: attempt,
                confirmedPrice: confirmedFinalPrice,
                idempotencyKey,
                idempotentReplay: Boolean(liveJson.idempotentReplay),
                message: `sgeooole: محصول ${p.sku} بروزرسانی شد (سقف معیار: ${p.basePrice.toLocaleString("fa-IR")} با ${p.discountPct}% تخفیف → کف قطعی: ${confirmedFinalPrice.toLocaleString("fa-IR")} تومان | کمپین: ${p.campaignType})`,
            };
        }
        return (lastFailure ?? {
            ok: false,
            code: "STORE_SYNC_EXHAUSTED",
            stage: "live_push",
            attempts: maxAttempts,
            idempotencyKey,
            message: "ارسال قیمت به فروشگاه پس از حداکثر تلاش‌ها ناموفق ماند",
        });
    },
};
/** ووکامرس: PUT /wp-json/wc/v3/products/{id} */
const woocommerce = {
    type: "woocommerce",
    async push(cfg, p) {
        const base = (cfg.baseUrl ?? process.env.WC_BASE_URL ?? "").replace(/\/$/, "");
        const key = cfg.consumerKey ?? process.env.WC_CONSUMER_KEY ?? "";
        const secret = cfg.consumerSecret ?? process.env.WC_CONSUMER_SECRET ?? "";
        if (!base || !key || !secret)
            return { ok: false, message: "تنظیمات ووکامرس ناقص است (baseUrl/consumerKey/consumerSecret)" };
        if (!p.storeExternalId)
            return { ok: false, message: "شناسه محصول در فروشگاه (storeExternalId) خالی است" };
        const auth = Buffer.from(`${key}:${secret}`).toString("base64");
        const body = {
            regular_price: String(p.basePrice),
            sale_price: String(p.finalPrice),
            date_on_sale_to: p.campaignEndsAt ?? null,
            meta_data: [
                { key: "_pricing_campaign", value: p.campaignType },
                { key: "_pricing_decision_id", value: String(p.decisionId) },
                { key: "_pricing_confidence", value: String(p.confidence) },
            ],
        };
        const res = await fetch(`${base}/wp-json/wc/v3/products/${p.storeExternalId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        return res.ok ? { ok: true, message: `ووکامرس: محصول ${p.storeExternalId} بروزرسانی شد` } : { ok: false, message: `ووکامرس HTTP ${res.status}` };
    },
};
/** وب‌هوک عمومی: POST JSON با هدر امضا */
const webhook = {
    type: "webhook",
    async push(cfg, p) {
        const url = cfg.url ?? process.env.STORE_WEBHOOK_URL ?? "";
        const secret = cfg.secret ?? process.env.STORE_WEBHOOK_SECRET ?? "";
        if (!url)
            return { ok: false, message: "آدرس وب‌هوک تنظیم نشده" };
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Pricing-Secret": secret },
            body: JSON.stringify({ event: "price.updated", data: p, sentAt: new Date().toISOString() }),
            cache: "no-store",
        });
        return res.ok ? { ok: true, message: `وب‌هوک: ${res.status}` } : { ok: false, message: `وب‌هوک HTTP ${res.status}` };
    },
};
exports.adapters = { sgeooole, woocommerce, webhook };
exports.sgeoooleAdapter = sgeooole;
async function getActiveConnector() {
    const rows = await index_ts_1.db.select().from(schema_1.storeConnectors).where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.active, true)).limit(1);
    return rows[0] ?? null;
}
/** وضعیت اتصال فروشگاه برای داشبورد و /api/health (بدون افشای سکرت) */
async function getStoreStatus() {
    try {
        const active = await getActiveConnector();
        if (active && active.type !== "none") {
            return {
                activeType: active.type,
                activeName: active.name,
                envFallback: false,
                baseUrl: active.type === "sgeooole" ? String(active.config?.baseUrl ?? "") : "",
                lastError: active.lastError ?? null,
            };
        }
    }
    catch {
        // ادامه به بررسی env
    }
    const envBase = (process.env.SGEOOOLE_API_URL ?? "").replace(/\/$/, "");
    const envKey = (process.env.SGEOOOLE_PRICING_SECRET ?? "").trim();
    return {
        activeType: null,
        activeName: null,
        envFallback: Boolean(envBase && envKey),
        baseUrl: envBase,
        lastError: null,
    };
}
async function pushToStore(payload, opts) {
    const idempotencyKey = buildIdempotencyKey(payload);
    const enrichedPayload = { ...payload, idempotencyKey };
    const connector = await getActiveConnector();
    if (connector && connector.type !== "none") {
        const adapter = exports.adapters[connector.type];
        if (!adapter) {
            return {
                ok: false,
                code: "UNKNOWN_CONNECTOR_TYPE",
                stage: "config",
                attempts: 0,
                idempotencyKey,
                message: `کانکتور ناشناخته: ${connector.type}`,
            };
        }
        try {
            const r = await adapter.push(connector.config, enrichedPayload, opts);
            await index_ts_1.db
                .update(schema_1.storeConnectors)
                .set({ lastPushAt: new Date(), lastError: r.ok ? null : r.message })
                .where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, connector.id));
            return {
                ...r,
                attempts: r.attempts ?? 1,
                confirmedPrice: r.confirmedPrice ?? (r.ok ? Math.round(payload.finalPrice) : undefined),
                idempotencyKey: r.idempotencyKey ?? idempotencyKey,
            };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await index_ts_1.db.update(schema_1.storeConnectors).set({ lastError: msg }).where((0, drizzle_orm_1.eq)(schema_1.storeConnectors.id, connector.id));
            return {
                ok: false,
                code: "CONNECTOR_EXCEPTION",
                stage: "live_push",
                attempts: 1,
                idempotencyKey,
                message: msg,
            };
        }
    }
    // سیستم واقعی بدون داده ساختگی: اگر کانکتوری در دیتابیس فعال نیست ولی
    // متغیرهای محیطی فروشگاه (SGEOOOLE_API_URL + SGEOOOLE_PRICING_SECRET) تنظیم‌اند،
    // مستقیم از env به sgeooole پوش کن تا قیمت‌ها واقعاً به سایت برسند.
    const envBase = (process.env.SGEOOOLE_API_URL ?? "").trim();
    const envKey = (process.env.SGEOOOLE_PRICING_SECRET ?? process.env.STORE_WEBHOOK_SECRET ?? "").trim();
    if (envBase && envKey) {
        try {
            const r = await sgeooole.push({ baseUrl: envBase, apiKey: envKey }, enrichedPayload, opts);
            return r.ok
                ? {
                    ...r,
                    confirmedPrice: r.confirmedPrice ?? Math.round(payload.finalPrice),
                    idempotencyKey: r.idempotencyKey ?? idempotencyKey,
                    message: `${r.message} (via env fallback)`,
                }
                : { ...r, idempotencyKey: r.idempotencyKey ?? idempotencyKey };
        }
        catch (e) {
            return {
                ok: false,
                code: "ENV_CONNECTOR_EXCEPTION",
                stage: "live_push",
                attempts: 1,
                idempotencyKey,
                message: e instanceof Error ? e.message : String(e),
            };
        }
    }
    return {
        ok: false,
        skipped: true,
        code: "NO_ACTIVE_CONNECTOR",
        stage: "config",
        attempts: 0,
        idempotencyKey,
        message: "کانکتور فروشگاه فعال نیست و SGEOOOLE_API_URL تنظیم نشده (در انتظار اتصال فروشگاه)",
    };
}
