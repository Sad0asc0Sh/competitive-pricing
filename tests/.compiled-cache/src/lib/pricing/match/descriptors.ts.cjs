"use strict";
/**
 * سیاست طبقه‌بندی توصیف‌گرهای محصول حساس به رده (Category-Sensitive Descriptor Policy).
 *
 * هدف: تمایز صریح بین صفات تبلیغاتی، سبک ظاهری، رنگ، جنس، شکل فیزیکی، ویژگی فنی،
 * شناسهٔ مدل، سازگاری و بسته‌بندی — به‌جای یکسان‌انگاری کورکورانه یا رد خودکار کارت‌ها.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCategoryDescriptorPolicy = resolveCategoryDescriptorPolicy;
exports.classifyDescriptorToken = classifyDescriptorToken;
exports.analyzeTitleDescriptors = analyzeTitleDescriptors;
exports.compareTitleDescriptors = compareTitleDescriptors;
const DEFAULT_GROUP_TERMS = {
    marketing: [
        "لوکس",
        "شیک",
        "زیبا",
        "خاص",
        "عالی",
        "اقتصادی",
        "ممتاز",
        "پرفروش",
        "محبوب",
        "خوشدست",
        "کاربردی",
        "استاندارد",
        "حرفه‌ای",
        "حرفهای",
        "تایوانی",
        "سوپر",
        "مخصوص",
        "ویژه",
        "vip",
        "luxury",
        "deluxe",
        "premium",
        "elegant",
    ],
    cosmetic_style: [
        "فانتزی",
        "طرحدار",
        "عروسکی",
        "ساده",
        "کلاسیک",
        "مدرن",
        "اسپرت",
        "کلیددار",
        "کشویی",
        "تاشو",
        "fancy",
        "classic",
        "modern",
        "sport",
    ],
    color: [
        "رنگی",
        "چندرنگ",
        "چندرنگی",
        "مولتیکالر",
        "مشکی",
        "سفید",
        "قرمز",
        "آبی",
        "ابی",
        "سبز",
        "زرد",
        "نارنجی",
        "بنفش",
        "صورتی",
        "طوسی",
        "خاکستری",
        "نقره‌ای",
        "نقرهای",
        "طلایی",
        "قهوه‌ای",
        "قهوهای",
        "سرمه‌ای",
        "سرمهای",
        "کرم",
        "زرشکی",
        "multicolor",
        "colorful",
        "black",
        "white",
        "red",
        "blue",
        "green",
        "yellow",
        "silver",
        "gold",
        "gray",
        "grey",
        "pink",
        "purple",
    ],
    shape: [
        "مکعب",
        "مکعبی",
        "گرد",
        "دایره‌ای",
        "دایرهای",
        "بیضی",
        "مستطیلی",
        "مستطیل",
        "تخممرغی",
        "اشکی",
        "قطره‌ای",
        "قطرهای",
        "جاسوئیچی",
        "آویز",
        "اویز",
        "جیبی",
        "مربعی",
        "مربع",
        "cube",
        "cubic",
        "round",
        "oval",
        "keychain",
    ],
    material: [
        "سیلیکونی",
        "سیلیکون",
        "پلاستیکی",
        "پلاستیک",
        "فشرده",
        "فلزی",
        "فلز",
        "استیل",
        "آلومینیومی",
        "الومینیومی",
        "آلومینیوم",
        "الومینیوم",
        "چرمی",
        "چرم",
        "کربن",
        "کربنی",
        "کریستالی",
        "شیشه‌ای",
        "شیشهای",
        "چوبی",
        "چوب",
        "مسی",
        "مس",
        "silicone",
        "silicon",
        "plastic",
        "metal",
        "steel",
        "aluminum",
        "aluminium",
        "leather",
        "carbon",
    ],
};
const DEFAULT_BASE_POLICY = {
    marketing: "review_uncertainty",
    cosmetic_style: "review_uncertainty",
    color: "review_uncertainty",
    shape: "review_uncertainty",
    material: "review_uncertainty",
    unknown: "review_uncertainty",
};
const DEFAULT_CATEGORY_POLICIES = {
    "acc:remote": {
        marketing: "review_uncertainty",
        cosmetic_style: "review_uncertainty",
        color: "review_uncertainty",
        shape: "review_uncertainty",
        material: "review_uncertainty",
        unknown: "review_uncertainty",
    },
    camera: {
        color: "technical",
        shape: "strict_variant",
    },
    hdd: {
        color: "strict_variant",
        cosmetic_style: "strict_variant",
    },
    ssd: {
        color: "strict_variant",
        cosmetic_style: "strict_variant",
    },
    cable: {
        material: "technical",
        color: "review_uncertainty",
    },
    switch: {
        shape: "strict_variant",
    },
};
function normalizeTerm(word) {
    return word
        .trim()
        .toLowerCase()
        .replace(/[يى]/g, "ی")
        .replace(/[ك]/g, "ک")
        .replace(/[ةۀ]/g, "ه")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/[\u200c\u200d\s]+/g, "");
}
const TERM_TO_GROUP = new Map();
for (const [group, terms] of Object.entries(DEFAULT_GROUP_TERMS)) {
    for (const term of terms) {
        TERM_TO_GROUP.set(normalizeTerm(term), group);
    }
}
function resolveCategoryDescriptorPolicy(productClass, config) {
    const cls = productClass ?? "*";
    return {
        ...DEFAULT_BASE_POLICY,
        ...(DEFAULT_CATEGORY_POLICIES[cls] ?? {}),
        ...(config?.categoryOverrides?.["*"] ?? {}),
        ...(config?.categoryOverrides?.[cls] ?? {}),
    };
}
function classifyDescriptorToken(token, productClass, config) {
    const norm = normalizeTerm(token);
    let group;
    if (config?.extraTerms) {
        for (const [g, terms] of Object.entries(config.extraTerms)) {
            if (terms?.some((t) => normalizeTerm(t) === norm)) {
                group = g;
                break;
            }
        }
    }
    group ??= TERM_TO_GROUP.get(norm) ?? "unknown";
    const policy = resolveCategoryDescriptorPolicy(productClass, config);
    const behavior = group === "technical"
        ? "technical"
        : group === "model_identifier" || group === "compatibility" || group === "packaging"
            ? "strict_variant"
            : policy[group];
    return { token, group, behavior };
}
function analyzeTitleDescriptors(tokens, productClass, config) {
    const byGroup = {
        marketing: [],
        cosmetic_style: [],
        color: [],
        shape: [],
        material: [],
        technical: [],
        model_identifier: [],
        compatibility: [],
        packaging: [],
        unknown: [],
    };
    const entries = [];
    const softTokens = [];
    const strictTokens = [];
    const unknownTokens = [];
    const seen = new Set();
    for (const token of tokens) {
        if (!token || seen.has(token))
            continue;
        seen.add(token);
        const entry = classifyDescriptorToken(token, productClass, config);
        entries.push(entry);
        byGroup[entry.group].push(token);
        if (entry.behavior === "strict_variant") {
            strictTokens.push(token);
        }
        else if (entry.group === "unknown") {
            unknownTokens.push(token);
        }
        else if (entry.behavior === "review_uncertainty" || entry.behavior === "soft_ignore") {
            softTokens.push(token);
        }
    }
    return { entries, byGroup, softTokens, strictTokens, unknownTokens };
}
function stemDescriptor(word) {
    return word.replace(/(?:های|ها|ان|ی|ه|ات)$/u, "");
}
function tokenMatchesSet(token, otherTokens, otherNorm) {
    const st = stemDescriptor(token);
    const otherStems = new Set(otherTokens.map(stemDescriptor));
    return otherStems.has(st) || otherNorm.includes(` ${token} `);
}
function compareTitleDescriptors(targetTokens, targetNorm, candTokens, candNorm, productClass, config) {
    const tClass = analyzeTitleDescriptors(targetTokens, productClass, config);
    const cClass = analyzeTitleDescriptors(candTokens, productClass, config);
    const matchedSoft = [];
    const matchedColors = [];
    const unmatchedTargetSoft = [];
    const unmatchedCandSoft = [];
    const unmatchedTargetHard = [];
    const unmatchedCandHard = [];
    const strictVariantMismatch = [];
    for (const entry of tClass.entries) {
        const hit = tokenMatchesSet(entry.token, candTokens, ` ${candNorm} `);
        if (hit) {
            if (entry.group === "color")
                matchedColors.push(entry.token);
            if (entry.behavior === "review_uncertainty" || entry.behavior === "soft_ignore")
                matchedSoft.push(entry.token);
            continue;
        }
        if (entry.behavior === "strict_variant") {
            unmatchedTargetHard.push(entry.token);
            strictVariantMismatch.push(entry.token);
        }
        else if (entry.group === "unknown") {
            unmatchedTargetHard.push(entry.token);
        }
        else if (entry.behavior !== "soft_ignore") {
            unmatchedTargetSoft.push(`${entry.group}:${entry.token}`);
        }
    }
    for (const entry of cClass.entries) {
        const hit = tokenMatchesSet(entry.token, targetTokens, ` ${targetNorm} `);
        if (hit)
            continue;
        if (entry.behavior === "strict_variant") {
            unmatchedCandHard.push(entry.token);
            strictVariantMismatch.push(entry.token);
        }
        else if (entry.group === "unknown") {
            unmatchedCandHard.push(entry.token);
        }
        else if (entry.behavior !== "soft_ignore") {
            unmatchedCandSoft.push(`${entry.group}:${entry.token}`);
        }
    }
    const hasSoftDescriptorDifference = unmatchedTargetSoft.length > 0 || unmatchedCandSoft.length > 0;
    const softDifferenceOnly = hasSoftDescriptorDifference && unmatchedTargetHard.length === 0 && unmatchedCandHard.length === 0;
    return {
        matchedSoft,
        matchedColors,
        unmatchedTargetSoft,
        unmatchedCandSoft,
        unmatchedTargetHard,
        unmatchedCandHard,
        hasSoftDescriptorDifference,
        softDifferenceOnly,
        strictVariantMismatch: [...new Set(strictVariantMismatch)],
    };
}
