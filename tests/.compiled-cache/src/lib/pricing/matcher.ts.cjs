"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MATCHER_FLAGS = void 0;
exports.setMatcherFlags = setMatcherFlags;
exports.resetMatcherFlags = resetMatcherFlags;
exports.isInternalOrDatabaseId = isInternalOrDatabaseId;
exports.normalizeProductText = normalizeProductText;
exports.extractModelAndSpecTokens = extractModelAndSpecTokens;
exports.evaluateTorobCandidate = evaluateTorobCandidate;
exports.selectBestTorobSearchMatch = selectBestTorobSearchMatch;
/**
 * موتور تطابق محصول v2 — انتخاب «کارت درست» ترب برای یک محصول فروشگاه و راستی‌آزمایی هویت.
 *
 * تفاوت اصلی با v1: به‌جای جمع امتیاز شباهت واژگان (که مدل‌های هم‌خانواده را هم بالای ۸۰٪ می‌برد)،
 * هویت کالا به‌صورت ساختاریافته استخراج و مقایسه می‌شود (برند، کد مدل، نوع کالا، مشخصات تایپ‌شده، پک/استوک/لوازم جانبی)
 * و «تایید خودکار» فقط با شناسایی مثبت (کد مدل یکسان/هم‌ارز، یا مشخصات کاملِ کالای بی‌کد) صادر می‌شود.
 * جزئیات: src/lib/pricing/match/*.ts  و  docs/MATCHER_V2.md
 */
const systemone_supervisor_1 = require("./systemone-supervisor");
const compare_1 = require("./match/compare");
const parse_1 = require("./match/parse");
const text_1 = require("./match/text");
/** پرچم‌های ویژگی (برای ablation و خاموش‌کردن اضطراری هر قاعده) */
exports.MATCHER_FLAGS = { ...compare_1.DEFAULT_MATCH_FLAGS };
function setMatcherFlags(patch) {
    Object.assign(exports.MATCHER_FLAGS, patch);
    return exports.MATCHER_FLAGS;
}
function resetMatcherFlags() {
    Object.assign(exports.MATCHER_FLAGS, compare_1.DEFAULT_MATCH_FLAGS);
    return exports.MATCHER_FLAGS;
}
/** تشخیص شناسه‌های داخلی دیتابیس/فروشگاه که کد مدل سازنده نیستند (مثل MongoDB ObjectId یا KY-XXXX) */
function isInternalOrDatabaseId(token) {
    return (0, text_1.isInternalOrDatabaseId)(token);
}
/** (سازگاری با نسخهٔ قبل) نرمال‌سازی متن */
function normalizeProductText(input) {
    return (0, text_1.normalizeText)(input);
}
/** (سازگاری با نسخهٔ قبل) استخراج توکن‌های مدل/مشخصات از یک متن */
function extractModelAndSpecTokens(text, sku) {
    const p = (0, parse_1.parseTitle)(text, { sku });
    const specs = [];
    const unit = { mp: "mp", ch: "ch", cap: "gb", ports: "port", volt: "v", amp: "a", len: "m" };
    for (const [k, vals] of Object.entries(p.attrs)) {
        if (!unit[k])
            continue;
        for (const v of vals)
            specs.push(k === "cap" && typeof v === "number" && v % 1000 === 0 ? `${v / 1000}tb` : `${v}${unit[k]}`);
    }
    return {
        modelTokens: p.codes.filter((c) => !c.inCompat).map((c) => c.raw),
        numericSpecs: specs,
        words: p.words,
        distinctiveWords: p.words,
    };
}
function priceRatio(target, candidate) {
    const a = target.anchorPriceToman;
    const p = candidate.priceToman;
    if (a && a > 0 && p && p > 0)
        return p / a;
    return null;
}
function evaluateTorobCandidate(target, candidate, minSellerCount = 1) {
    const rejectBelowPct = target.rejectBelowPct ?? 45;
    const approveAbovePct = target.approveAbovePct ?? 80;
    const candText = `${candidate.titleFa ?? ""} ${candidate.titleEn ?? ""}`.trim();
    if (!(0, text_1.normalizeText)(candText)) {
        return {
            candidate,
            score: 0,
            noul: 0,
            verdict: "reject",
            rejected: true,
            needsReview: false,
            rejectReason: "عنوان کارت در ترب خالی است",
            matchedModelTokens: [],
            missingModelTokens: [],
            notes: [],
        };
    }
    const t = (0, parse_1.parseTitle)(target.productName, { sku: target.sku, brand: target.brand });
    const c = (0, parse_1.parseTitle)(candText);
    const r = (0, compare_1.compareParsed)(t, c, {
        priceRatio: priceRatio(target, candidate),
        rejectBelowPct,
        approveAbovePct,
        flags: exports.MATCHER_FLAGS,
    });
    const notes = [...r.notes];
    if (candidate.available === false)
        notes.push("کارت در ترب ناموجود است");
    const sellers = candidate.sellerCount ?? 1;
    if (sellers >= Math.max(3, minSellerCount))
        notes.push(`لیستینگ ادغام‌شده معتبر (${sellers} فروشنده)`);
    else if (sellers === 1)
        notes.push("لیستینگ تک‌فروشنده‌ای");
    const rejected = r.verdict === "reject";
    return {
        candidate,
        score: r.score,
        noul: Math.round(r.score) / 100,
        verdict: r.verdict,
        rejected,
        needsReview: r.verdict === "review",
        rejectReason: rejected ? r.rejectReason : undefined,
        matchedModelTokens: r.matchedCodes,
        missingModelTokens: r.missingCodes,
        notes,
        codeRelation: r.codeRel,
        identityKey: r.identityKey,
        blockers: r.blockers,
    };
}
const VERDICT_RANK = { approve: 2, review: 1, reject: 0 };
function selectBestTorobSearchMatch(target, candidates, minSellerCount = 1) {
    if (!candidates.length) {
        return {
            best: null,
            allRanked: [],
            confident: false,
            verdict: "reject",
            explanation: "هیچ نتیجه‌ای از جستجوی ترب دریافت نشد",
        };
    }
    const rejectBelowPct = target.rejectBelowPct ?? 45;
    const approveAbovePct = target.approveAbovePct ?? 80;
    const reviewCap = Math.max(rejectBelowPct + 5, approveAbovePct - 6);
    let evaluated = candidates.map((c) => evaluateTorobCandidate(target, c, minSellerCount));
    // قاعدهٔ ابهام بین‌کارتی: اگر دو کارت با «هویت متفاوت» هر دو تایید خودکار شدند، هیچ‌کدام خودکار نیست
    const approved = evaluated.filter((x) => x.verdict === "approve");
    const keys = new Set(approved.map((x) => x.identityKey));
    if (approved.length > 1 && keys.size > 1) {
        evaluated = evaluated.map((x) => x.verdict === "approve"
            ? {
                ...x,
                score: Math.min(x.score, reviewCap),
                noul: Math.min(x.score, reviewCap) / 100,
                verdict: (0, systemone_supervisor_1.classifyThreeZoneScore)(Math.min(x.score, reviewCap), rejectBelowPct, approveAbovePct),
                needsReview: true,
                notes: [...x.notes, "⚠ چند کارت با هویت متفاوت هم‌زمان با محصول سایت منطبق‌اند؛ انتخاب با بازبین"],
            }
            : x);
    }
    const allRanked = [...evaluated].sort((a, b) => {
        if (a.rejected !== b.rejected)
            return a.rejected ? 1 : -1;
        if (VERDICT_RANK[b.verdict] !== VERDICT_RANK[a.verdict])
            return VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
        if (b.score !== a.score)
            return b.score - a.score;
        const sa = a.candidate.sellerCount ?? 0;
        const sb = b.candidate.sellerCount ?? 0;
        if (sb !== sa)
            return sb - sa;
        return Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
    });
    // کارت‌های هم‌هویت (تکرار لیستینگ): از میان آنها پرفروشنده‌ترینِ موجود جلو بیاید
    const head = allRanked[0];
    if (head && !head.rejected) {
        const sameId = allRanked.filter((x) => !x.rejected && x.identityKey === head.identityKey && x.verdict === head.verdict);
        if (sameId.length > 1) {
            sameId.sort((a, b) => {
                const av = Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
                if (av)
                    return av;
                return (b.candidate.sellerCount ?? 0) - (a.candidate.sellerCount ?? 0);
            });
            const rest = allRanked.filter((x) => !sameId.includes(x));
            allRanked.splice(0, allRanked.length, ...sameId, ...rest);
        }
    }
    const nonRejected = allRanked.filter((x) => !x.rejected);
    if (!nonRejected.length) {
        const topRejected = allRanked[0];
        return {
            best: null,
            allRanked,
            confident: false,
            verdict: "reject",
            explanation: `رد کامل در گیت ورودی: از بین ${candidates.length} نتیجه جستجوی ترب، همه زیر خط قرمز تطابق (${rejectBelowPct}%) بودند (${topRejected?.rejectReason ?? "نامشخص"})`,
        };
    }
    const best = nonRejected[0];
    return {
        best,
        allRanked,
        confident: best.verdict === "approve",
        verdict: best.verdict,
        explanation: best.verdict === "approve"
            ? `تایید خودکار ورودی (${best.score}% ≥ ${approveAbovePct}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد و ${candidates.length - nonRejected.length} نتیجه نامرتبط رد گردید`
            : `ورود مشروط به بخش ریویو (${best.score}% در بازه ${rejectBelowPct}%..${approveAbovePct}% · noul=${best.noul.toFixed(2)}): کارت «${best.candidate.titleFa}» انتخاب شد ولی نیازمند تایید بازبینی است${best.blockers?.length ? ` — ${best.blockers[0]}` : ""}`,
    };
}
