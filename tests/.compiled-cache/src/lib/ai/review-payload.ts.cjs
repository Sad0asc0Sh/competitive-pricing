"use strict";
/**
 * ساخت payload امن برای «نظر دوم» مدل زبانی (LLM)
 *
 * مسئله: نسخهٔ قبلی `reviewDecisionWithAI` قیمت تمام‌شده (`costPrice`) و متن دلایل بازبینی را مستقیم به API
 * شخص ثالث می‌فرستاد؛ قیمت خرید/کف سود از محرمانه‌ترین داده‌های فروشگاه است (رقیب با دانستنِ آن می‌تواند حاشیهٔ ما را بداند).
 *
 * اصول این ماژول:
 *  1) هیچ‌چیز دربارهٔ قیمت خرید، تمام‌شده، کف سود یا حاشیه به LLM نمی‌رود. ایمنیِ سود در کد (نه در LLM) تضمین می‌شود:
 *     پیشنهادِ زیر کف/تمام‌شده در runner رد می‌شود؛ LLM فقط «مشاور» است و نمی‌تواند خودش قیمتی را اعمال کند.
 *  2) دلایل بازبینی که به هزینه/کف/حاشیه اشاره دارند حذف می‌شوند؛ هر عددِ برابر با تمام‌شده/کف (با هر قالب رقم و جداکننده)
 *     در بقیهٔ متن‌ها با «[محرمانه]» جایگزین می‌شود (دفاع در عمق).
 *  3) داده‌های بیرونی (نام فروشنده‌های ترب) نامطمئن‌اند: کاراکترهای کنترلی حذف و طول محدود می‌شود تا تزریق پرامپت ساده نشود.
 *
 * این فایل عمداً «خالص» است (بدون import از db/شبکه) تا واحد‌آزمون‌پذیر باشد.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLatinDigits = toLatinDigits;
exports.isConfidentialReason = isConfidentialReason;
exports.redactSecretNumbers = redactSecretNumbers;
exports.buildReviewPayload = buildReviewPayload;
/** تبدیل ارقام فارسی/عربی-هندی به لاتین (فقط برای مقایسه) */
function toLatinDigits(s) {
    return s
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
/** اشاره به قیمت خرید/تمام‌شده/کف سود/حاشیه؟ */
const CONFIDENTIAL_TOPIC = /قیمت\s*خرید|تمام[\s‌‍]*شده|کف\s*(?:سود|خرید|تامین|تأمین|قطعی|فروش)|خط\s*قرمز|حاشیه|هزینه|سود|همکار|تامین|تأمین|cost|floor|margin|profit|supplier/i;
function isConfidentialReason(text) {
    return CONFIDENTIAL_TOPIC.test(toLatinDigits(text));
}
/**
 * عددهای محرمانه (مثل تمام‌شده و کف) را از متن حذف می‌کند. تطبیق «برابریِ دقیق مقدار» است، نه شباهت؛
 * اعدادِ بازار که اتفاقاً نزدیک‌اند دست‌نخورده می‌مانند.
 */
function redactSecretNumbers(text, secrets) {
    const set = new Set();
    for (const s of secrets) {
        if (typeof s === "number" && Number.isFinite(s) && s > 0) {
            set.add(Math.round(s));
            set.add(Math.round(s * 10)); // معادل ریالی
        }
    }
    if (!set.size)
        return text;
    // توکن عددی: رقم (لاتین/فارسی/عربی) + جداکننده‌های هزارگان
    return text.replace(/[0-9۰-۹٠-٩][0-9۰-۹٠-٩,٬،.\s]*[0-9۰-۹٠-٩]|[0-9۰-۹٠-٩]/g, (tok) => {
        const compact = toLatinDigits(tok).replace(/[,٬،\s]/g, "");
        // «1.234.567» (جداکنندهٔ نقطه‌ای) و «1234567.0»
        const asInt = /^\d{1,3}(\.\d{3})+$/.test(compact) ? compact.replace(/\./g, "") : compact;
        const n = Number(asInt);
        if (Number.isFinite(n) && set.has(Math.round(n)))
            return "[محرمانه]";
        return tok;
    });
}
function cleanExternalText(s, max) {
    return String(s ?? "")
        .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}
/**
 * @param secrets اعداد محرمانهٔ فروشگاه (تمام‌شده، کف سود، قیمت خرید پایه، …)
 */
function buildReviewPayload(input, secrets) {
    const safe = (t, max = 300) => redactSecretNumbers(cleanExternalText(t, max), secrets);
    const reasons = input.reviewReasons
        .filter((r) => typeof r === "string" && r.trim() && !isConfidentialReason(r))
        .map((r) => safe(r, 400))
        .slice(0, 12);
    const offers = input.offers.slice(0, 40).map((o) => ({
        shopName: safe(o.shopName, 80),
        price: o.price,
        included: o.included,
        ...(o.excludeReason ? { excludeReason: isConfidentialReason(o.excludeReason) ? "نامعتبر" : safe(o.excludeReason, 160) } : {}),
    }));
    // قیمت جایگزین ممکن است با کف ما برابر شود (وقتی سناریو کف‌-محدود است)؛ اگر برابرِ عدد محرمانه بود ارسال نمی‌شود
    const secretSet = new Set();
    for (const s of secrets)
        if (Number.isFinite(s) && s > 0)
            secretSet.add(Math.round(s));
    const alt = input.alternative;
    const alternative = alt && Number.isFinite(alt.finalPrice) && !secretSet.has(Math.round(alt.finalPrice))
        ? {
            price: Math.round(alt.finalPrice),
            probability: Math.round(alt.p * 100) / 100,
            ifCheapestValidOfferIs: Math.round(alt.lowestPrice),
            shopName: safe(alt.shopName, 80),
        }
        : null;
    return {
        productName: safe(input.productName, 200),
        offers,
        referencePrice: input.referencePrice,
        // قیمت پیشنهادی خودِ تصمیم است و باید دیده شود (حتی اگر روی کف بایستد؛ نسبتش با کف/هزینه هرگز اعلام نمی‌شود)
        proposedFinalPrice: input.finalPrice,
        ceilingPrice: input.basePrice != null && !secretSet.has(Math.round(input.basePrice)) ? input.basePrice : null,
        reviewReasons: reasons,
        engineConfidence: input.confidence != null && Number.isFinite(input.confidence) ? Math.round(input.confidence * 100) / 100 : null,
        alternative,
    };
}
