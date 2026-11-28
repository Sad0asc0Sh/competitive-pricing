"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MATCHER_FLAGS = void 0;
exports.setMatcherFlags = setMatcherFlags;
exports.resetMatcherFlags = resetMatcherFlags;
exports.isInternalOrDatabaseId = isInternalOrDatabaseId;
exports.normalizeProductText = normalizeProductText;
exports.extractModelAndSpecTokens = extractModelAndSpecTokens;
exports.evaluateTorobCandidate = evaluateTorobCandidate;
exports.areCompatibleConfirmedIdentities = areCompatibleConfirmedIdentities;
exports.selectBestTorobSearchMatch = selectBestTorobSearchMatch;
const compare_1 = require("./match/compare");
const descriptors_1 = require("./match/descriptors");
const lexicon_1 = require("./match/lexicon");
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
    const unit = {
        mp: "mp",
        ch: "ch",
        cap: "gb",
        ram: "gb",
        ports: "port",
        volt: "v",
        amp: "a",
        watt: "w",
        va: "va",
        ah: "ah",
        uf: "uf",
        kvar: "kvar",
        ka: "ka",
        poles: "p",
        len: "m",
        cm: "cm",
        mm2: "mm2",
    };
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
function evaluateTorobCandidate(target, candidate, _minSellerCount = 1) {
    const rejectBelowPct = target.rejectBelowPct ?? 45;
    const approveAbovePct = target.approveAbovePct ?? 80;
    const candText = `${candidate.titleFa ?? ""} ${candidate.titleEn ?? ""}`.trim();
    if (!(0, text_1.normalizeText)(candText)) {
        const titleState = candidate.titleEvidence?.parsed ? "mapping_missing"
            : candidate.titleEvidence?.fields.length ? "parser_missing" : "source_missing";
        return {
            candidate,
            score: 0,
            noul: 0,
            verdict: "review",
            status: "EXTRACTION_INCOMPLETE",
            titleState,
            rejected: false,
            needsReview: true,
            matchedModelTokens: [],
            missingModelTokens: [],
            notes: ["عنوان قابل استفاده برای سنجش هویت کارت دریافت نشد"],
        };
    }
    const t = (0, parse_1.parseTitle)(target.productName, { sku: target.sku, brand: target.brand });
    let c = (0, parse_1.parseIdentityTitle)(candText, candidate.specs);
    if ((0, text_1.normalizeText)(candidate.titleFa) && (0, text_1.normalizeText)(candidate.titleEn)) {
        const fa = (0, parse_1.parseTitle)(candidate.titleFa);
        const en = (0, parse_1.parseTitle)(candidate.titleEn);
        const faCodes = fa.codes.filter((code) => !code.inCompat);
        const enCodes = en.codes.filter((code) => !code.inCompat);
        const conflict = faCodes.length && enCodes.length &&
            !faCodes.some((a) => enCodes.some((b) => ["equal", "alias", "tail"].includes((0, compare_1.relateCodes)(a, b))));
        if (conflict) {
            c = { ...c, evidenceConflicts: [...(c.evidenceConflicts ?? []), "عنوان فارسی و لاتین کارت کد مدل متفاوتی دارند"] };
        }
    }
    const r = (0, compare_1.compareParsed)(t, c, {
        priceRatio: priceRatio(target, candidate),
        anchorPriceToman: target.anchorPriceToman,
        rejectBelowPct,
        approveAbovePct,
        flags: exports.MATCHER_FLAGS,
        descriptorPolicy: target.descriptorPolicy,
    });
    const notes = [...r.notes];
    if (candidate.available === false)
        notes.push("کارت در ترب ناموجود است");
    const sellers = candidate.sellerCount ?? 0;
    if (sellers >= 2)
        notes.push(`لیستینگ ادغام‌شده معتبر (${sellers} فروشنده)`);
    else if (sellers === 1)
        notes.push("لیستینگ تک‌فروشنده‌ای");
    const rejected = r.verdict === "reject";
    return {
        candidate,
        score: r.score,
        noul: Math.round(r.score) / 100,
        verdict: r.verdict,
        status: rejected ? "IDENTITY_MISMATCH" : r.verdict === "approve" ? "MATCH_CONFIRMED" : "REVIEW_REQUIRED",
        titleState: "present",
        parsed: c,
        scoreComponents: r.scoreComponents,
        rawScore: r.rawScore,
        hasConflict: r.hasConflict,
        familyConflict: r.familyConflict,
        unexplainedFamily: r.unexplainedFamily,
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
function areCompatibleConfirmedIdentities(a, b) {
    if (a.status !== "MATCH_CONFIRMED" || b.status !== "MATCH_CONFIRMED" || a.hasConflict || b.hasConflict ||
        !a.parsed || !b.parsed)
        return false;
    if (a.identityKey?.startsWith("code:") && b.identityKey?.startsWith("code:") && a.identityKey !== b.identityKey) {
        return false;
    }
    const left = a.parsed;
    const right = b.parsed;
    if (left.head && right.head && left.head.cls !== right.head.cls)
        return false;
    // §10 ناوردای ۷ — دو واریانت ناسازگار تجمیع نمی‌شوند: خانوادهٔ نام‌دار دوطرفهٔ متفاوت مانع تجمیع است؛
    // تعارض انکودینگ از مجرای conflictingPrimarySpec (پایین) خودکار پوشش داده می‌شود.
    if ((0, descriptors_1.compareNamedFamilies)(left.designFamily, right.designFamily).familyMismatch)
        return false;
    if (!(0, lexicon_1.areKnownBrandSetsCompatible)([...left.brands, ...left.impliedBrands], [...right.brands, ...right.impliedBrands]))
        return false;
    const codesA = left.codes.filter(({ inCompat }) => !inCompat);
    const codesB = right.codes.filter(({ inCompat }) => !inCompat);
    const codesCover = (xs, ys) => xs.every((code) => ys.some((other) => ["equal", "alias", "tail"].includes((0, compare_1.relateCodes)(code, other))));
    if (codesA.length && codesB.length && (!codesCover(codesA, codesB) || !codesCover(codesB, codesA))) {
        return false;
    }
    if (left.packageUnits != null && right.packageUnits != null && left.packageUnits !== right.packageUnits) {
        return false;
    }
    if ((0, compare_1.conflictingPrimarySpec)(left, right))
        return false;
    for (const key of ["form", "tech", "hddkind", "mgmt", "tier"]) {
        const lf = left.features[key];
        const rf = right.features[key];
        if (lf?.length && rf?.length && !lf.some((value) => rf.includes(value)))
            return false;
    }
    return true;
}
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
    const reviewCap = Math.min(approveAbovePct - 1, Math.max(rejectBelowPct + 5, approveAbovePct - 6));
    let evaluated = candidates.map((c) => evaluateTorobCandidate(target, c, minSellerCount));
    // قاعدهٔ ابهام بین‌کارتی: اگر دو کارت با «هویت متفاوت» یا مشخصات اصلی متضاد هر دو تایید خودکار شدند، هیچ‌کدام خودکار نیست
    const approved = evaluated.filter((x) => x.verdict === "approve");
    if (approved.some((a, i) => approved.slice(i + 1).some((b) => !areCompatibleConfirmedIdentities(a, b)))) {
        evaluated = evaluated.map((x) => x.verdict === "approve"
            ? {
                ...x,
                score: Math.min(x.score, reviewCap),
                noul: Math.min(x.score, reviewCap) / 100,
                verdict: "review",
                status: "REVIEW_REQUIRED",
                needsReview: true,
                blockers: [...(x.blockers ?? []), "چند کارت با هویت یا مشخصات متفاوت هم‌زمان با محصول سایت منطبق‌اند"],
                notes: [...x.notes, "⚠ چند کارت با هویت متفاوت هم‌زمان با محصول سایت منطبق‌اند؛ انتخاب با بازبین"],
            }
            : x);
    }
    const allRanked = [...evaluated].sort((a, b) => {
        if (a.rejected !== b.rejected)
            return a.rejected ? 1 : -1;
        // تعارض خانوادهٔ اثبات‌شده با وتو خودش rejected=true می‌سازد و در گروه ردشده‌ها پیش از score می‌نشیند.
        if (VERDICT_RANK[b.verdict] !== VERDICT_RANK[a.verdict])
            return VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
        if (a.titleState !== b.titleState && (a.titleState === "present" || b.titleState === "present")) {
            return a.titleState === "present" ? -1 : 1;
        }
        if (b.score !== a.score)
            return b.score - a.score;
        // مارکر نامفهومِ خانواده فقط در تساوی score و پیش از tie-break فروشنده‌شمار اثر دارد:
        // تعداد فروشنده هرگز جبران ابهام هویتی نیست (§11 سند)، ولی کارت چندفروشندهٔ تمیز تنزیل نمی‌شود (§8).
        const ua = a.unexplainedFamily?.length ?? 0;
        const ub = b.unexplainedFamily?.length ?? 0;
        if (ua !== ub)
            return ua - ub;
        const sa = a.candidate.sellerCount ?? 0;
        const sb = b.candidate.sellerCount ?? 0;
        if (sb !== sa)
            return sb - sa;
        return Number(b.candidate.available !== false) - Number(a.candidate.available !== false);
    });
    // کارت‌های هم‌هویت (تکرار لیستینگ): از میان آنها پرفروشنده‌ترینِ موجود جلو بیاید
    const head = allRanked[0];
    if (head?.identityKey && !head.rejected) {
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
    const nonRejected = allRanked.filter((x) => !x.rejected && x.titleState === "present");
    if (!nonRejected.length) {
        if (allRanked.some((x) => x.status === "EXTRACTION_INCOMPLETE")) {
            return {
                best: null,
                allRanked,
                confident: false,
                verdict: "review",
                explanation: "داوری هویت برخی کارت‌های ترب به دلیل عنوان ناقص به دریافت جزئیات نیاز دارد",
            };
        }
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
