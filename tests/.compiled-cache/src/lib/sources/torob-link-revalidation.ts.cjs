"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REVALIDATION_FRESHNESS_DAYS = void 0;
exports.classifyStoredLink = classifyStoredLink;
/**
 * §12 سند رخداد — اعتبارسنجی مجدد ایمن و ممیزی‌پذیر روابط ذخیره‌شدهٔ محصول↔PRK.
 *
 * هدف: تأییدهای نادرست تاریخی نباید راهنمای جستجوی دائمی شوند؛ بدون حذف تاریخچه، چهار وضعیت جدا می‌شود:
 *  - valid            → راستی‌آزمایی تازهٔ کامل (MATCH_CONFIRMED بدون hasConflict) — وضعیت ذخیره‌شده فقط تازه می‌شود
 *  - review_required  → هویت در راستی‌آزمایی تازه تأیید کامل نشد — downgrade به review_required
 *  - incompatible     → تعارض ساختاری/خانواده/انکودینگ اثبات‌شده — نگاشت به relation_status='rejected' (enum موجود)
 *  - stale            → شواهد قدیمی‌تر از پنجرهٔ freshness — وضعیت ثابت می‌ماند و فقط lastReason/lastVerifiedAt تازه می‌شود
 *
 * گاردهای ایمنی (بدون استثنا):
 *  - ردیف origin='admin_review' هرگز خودکار downgrade نمی‌شود (فقط پرچم بازبینی مدیر).
 *  - ردیف rejected هرگز زنده نمی‌شود.
 *  - هیچ ردیفی حذف نمی‌شود؛ فقط UPDATE ستون‌های وضعیت/دلیل/زمان.
 *  - products.torob_prk باند‌شده به PRK ناسازگار پرچم requiresManualUnbind می‌گیرد؛ آزادسازی فقط با اسکریپت CLI مشروط.
 */
const matcher_1 = require("../pricing/matcher");
const parse_1 = require("../pricing/match/parse");
const torob_identity_1 = require("./torob-identity");
/** پنجرهٔ freshness شواهد ذخیره‌شده (هم‌سو با CONFIRMED_HINT_FRESHNESS_DAYS در torob-index.ts). */
exports.DEFAULT_REVALIDATION_FRESHNESS_DAYS = 30;
function classifyStoredLink(opts) {
    const now = opts.now ?? new Date();
    const freshnessDays = opts.freshnessDays ?? exports.DEFAULT_REVALIDATION_FRESHNESS_DAYS;
    const previous = opts.record.relationStatus;
    const adminProtected = opts.record.origin === "admin_review";
    const prk = opts.record.prk;
    const lastVerifiedMs = opts.record.lastVerifiedAt ? new Date(opts.record.lastVerifiedAt).getTime() : null;
    const isStale = lastVerifiedMs == null || now.getTime() - lastVerifiedMs > freshnessDays * 86_400_000;
    if (!opts.card) {
        return {
            prk,
            previousRelationStatus: previous,
            status: "stale",
            suggestedRelationStatus: previous,
            reason: "کارت ترب برای راستی‌آزمایی در دسترس نیست؛ رابطهٔ ذخیره‌شده کهنه محسوب می‌شود و وضعیتش ثابت می‌ماند",
            hardContradictions: [],
            requiresManualUnbind: false,
        };
    }
    // ارزیابی ساختاری تازه — بدون قیمت تا وتوی قیمتیِ لحظه‌ای تعارض ساختاری جعل نکند؛
    // گیت خانواده/انکودینگ از طریق evaluateTorobCandidate + assessDiscoveryEligibility اعمال می‌شود.
    const scored = (0, matcher_1.evaluateTorobCandidate)(opts.target, { ...opts.card, priceToman: null });
    const targetTitle = (0, parse_1.parseTitle)(opts.target.productName, { sku: opts.target.sku });
    const eligibility = (0, torob_identity_1.assessDiscoveryEligibility)(opts.target, targetTitle, scored);
    const hardContradictions = eligibility.hardContradictions;
    const incompatible = hardContradictions.length > 0 || scored.status === "IDENTITY_MISMATCH" || scored.hasConflict === true;
    if (incompatible) {
        const detail = scored.rejectReason ?? hardContradictions[0] ?? "تعارض ساختاری با محصول هدف";
        return {
            prk,
            previousRelationStatus: previous,
            status: adminProtected ? "review_required" : "incompatible",
            suggestedRelationStatus: adminProtected ? previous : "rejected",
            reason: adminProtected
                ? `رابطهٔ تأییدشدهٔ مدیر با شواهد تازه ناسازگار است (${detail})؛ فقط بازبینی مدیر می‌تواند آن را تغییر دهد`
                : `رابطهٔ ذخیره‌شده با راستی‌آزمایی تازه ناسازگار است: ${detail}`,
            hardContradictions,
            identityStatus: scored.status,
            matchScore: scored.score,
            requiresManualUnbind: Boolean(opts.isBoundProductPrk) && !adminProtected,
        };
    }
    // رد قبلی هرگز به‌صورت خودکار زنده نمی‌شود؛ حتی با شواهد تازهٔ مثبت فقط پرچم بازبینی مدیر.
    if (previous === "rejected") {
        return {
            prk,
            previousRelationStatus: previous,
            status: "review_required",
            suggestedRelationStatus: "rejected",
            reason: "رابطهٔ ردشده به‌صورت خودکار زنده نمی‌شود؛ شواهد تازه فقط برای بازبینی مدیر ثبت شد",
            hardContradictions: [],
            identityStatus: scored.status,
            matchScore: scored.score,
            requiresManualUnbind: false,
        };
    }
    if (isStale) {
        return {
            prk,
            previousRelationStatus: previous,
            status: "stale",
            suggestedRelationStatus: previous,
            reason: "شواهد ذخیره‌شده قدیمی‌تر از پنجرهٔ freshness است و نیاز به راستی‌آزمایی تازه دارد؛ وضعیت ثابت ماند",
            hardContradictions: [],
            identityStatus: scored.status,
            matchScore: scored.score,
            requiresManualUnbind: false,
        };
    }
    if (scored.status === "MATCH_CONFIRMED" && !scored.hasConflict) {
        return {
            prk,
            previousRelationStatus: previous,
            status: "valid",
            suggestedRelationStatus: previous,
            reason: "رابطهٔ ذخیره‌شده با احراز تازهٔ کامل هویت معتبر ماند",
            hardContradictions: [],
            identityStatus: scored.status,
            matchScore: scored.score,
            requiresManualUnbind: false,
        };
    }
    return {
        prk,
        previousRelationStatus: previous,
        status: "review_required",
        suggestedRelationStatus: adminProtected ? previous : "review_required",
        reason: `هویت ذخیره‌شده در راستی‌آزمایی تازه تأیید کامل نشد (${scored.blockers?.[0] ?? "شواهد ناقص"})؛ نیازمند بازبینی`,
        hardContradictions: [],
        identityStatus: scored.status,
        matchScore: scored.score,
        requiresManualUnbind: false,
    };
}
