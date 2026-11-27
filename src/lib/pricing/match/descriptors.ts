/**
 * سیاست طبقه‌بندی توصیف‌گرهای محصول حساس به رده (Category-Sensitive Descriptor Policy).
 *
 * هدف: تمایز صریح بین صفات تبلیغاتی، سبک ظاهری، رنگ، جنس، شکل فیزیکی، ویژگی فنی،
 * شناسهٔ مدل، سازگاری و بسته‌بندی — به‌جای یکسان‌انگاری کورکورانه یا رد خودکار کارت‌ها.
 */

export type DescriptorGroup =
  | "marketing"
  | "cosmetic_style"
  | "color"
  | "shape"
  | "material"
  | "technical"
  | "model_identifier"
  | "compatibility"
  | "packaging"
  | "unknown";

export type DescriptorPolicyBehavior =
  /** تفاوت یا نبود آن در کشف بی‌اثر است و در راستی‌آزمایی فقط ابهام (نیازمند بررسی) می‌سازد، نه رد قطعی. */
  | "review_uncertainty"
  /** در کشف بی‌اثر و در راستی‌آزمایی قابل اغماض است (مگر در تضاد صریح فنی/مدل). */
  | "soft_ignore"
  /** تفاوت صریح آن در این رده نشانهٔ واریانت یا مدل متفاوت است (مثل رنگ در هارد دیسک یا جنس رسانا در کابل). */
  | "strict_variant"
  /** در این رده یک مشخصهٔ فنی تلقی می‌شود (مثل «دید در شب رنگی» در دوربین). */
  | "technical";

export type CategoryDescriptorGroupPolicy = Record<
  "marketing" | "cosmetic_style" | "color" | "shape" | "material" | "unknown",
  DescriptorPolicyBehavior
>;

export interface DescriptorPolicyConfig {
  /** بازنویسی رفتار هر گروه توصیف‌گر برای یک ردهٔ مشخص (مثل acc:remote یا camera یا hdd) */
  categoryOverrides?: Record<string, Partial<CategoryDescriptorGroupPolicy>>;
  /** واژگان اضافی قابل تنظیم برای گروه‌های توصیف‌گر */
  extraTerms?: Partial<Record<DescriptorGroup, string[]>>;
}

export interface DescriptorEntry {
  token: string;
  group: DescriptorGroup;
  behavior: DescriptorPolicyBehavior;
}

export interface ClassifiedDescriptors {
  entries: DescriptorEntry[];
  byGroup: Record<DescriptorGroup, string[]>;
  /** واژه‌هایی که نباید مانع کشف شوند و به‌تنهایی تضاد هویت نمی‌سازند */
  softTokens: string[];
  /** واژه‌هایی که در این رده نقش واریانت/سری سخت‌گیرانه دارند */
  strictTokens: string[];
  /** واژه‌های توصیفی ناشناخته (عدم قطعیت، نه رد خودکار) */
  unknownTokens: string[];
}

const DEFAULT_GROUP_TERMS: Record<
  "marketing" | "cosmetic_style" | "color" | "shape" | "material",
  readonly string[]
> = {
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

const DEFAULT_BASE_POLICY: CategoryDescriptorGroupPolicy = {
  marketing: "review_uncertainty",
  cosmetic_style: "review_uncertainty",
  color: "review_uncertainty",
  shape: "review_uncertainty",
  material: "review_uncertainty",
  unknown: "review_uncertainty",
};

const DEFAULT_CATEGORY_POLICIES: Record<string, Partial<CategoryDescriptorGroupPolicy>> = {
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

function normalizeTerm(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[\u200c\u200d\s]+/g, "");
}

const TERM_TO_GROUP = new Map<string, DescriptorGroup>();
for (const [group, terms] of Object.entries(DEFAULT_GROUP_TERMS) as Array<
  [keyof typeof DEFAULT_GROUP_TERMS, readonly string[]]
>) {
  for (const term of terms) {
    TERM_TO_GROUP.set(normalizeTerm(term), group);
  }
}

export function resolveCategoryDescriptorPolicy(
  productClass: string | null | undefined,
  config?: DescriptorPolicyConfig,
): CategoryDescriptorGroupPolicy {
  const cls = productClass ?? "*";
  return {
    ...DEFAULT_BASE_POLICY,
    ...(DEFAULT_CATEGORY_POLICIES[cls] ?? {}),
    ...(config?.categoryOverrides?.["*"] ?? {}),
    ...(config?.categoryOverrides?.[cls] ?? {}),
  };
}

export function classifyDescriptorToken(
  token: string,
  productClass: string | null | undefined,
  config?: DescriptorPolicyConfig,
): DescriptorEntry {
  const norm = normalizeTerm(token);
  let group: DescriptorGroup | undefined;
  if (config?.extraTerms) {
    for (const [g, terms] of Object.entries(config.extraTerms) as Array<[DescriptorGroup, string[] | undefined]>) {
      if (terms?.some((t) => normalizeTerm(t) === norm)) {
        group = g;
        break;
      }
    }
  }
  group ??= TERM_TO_GROUP.get(norm) ?? "unknown";
  const policy = resolveCategoryDescriptorPolicy(productClass, config);
  const behavior: DescriptorPolicyBehavior =
    group === "technical"
      ? "technical"
      : group === "model_identifier" || group === "compatibility" || group === "packaging"
        ? "strict_variant"
        : policy[group];
  return { token, group, behavior };
}

export function analyzeTitleDescriptors(
  tokens: string[],
  productClass: string | null | undefined,
  config?: DescriptorPolicyConfig,
): ClassifiedDescriptors {
  const byGroup: Record<DescriptorGroup, string[]> = {
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
  const entries: DescriptorEntry[] = [];
  const softTokens: string[] = [];
  const strictTokens: string[] = [];
  const unknownTokens: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const entry = classifyDescriptorToken(token, productClass, config);
    entries.push(entry);
    byGroup[entry.group].push(token);
    if (entry.behavior === "strict_variant") {
      strictTokens.push(token);
    } else if (entry.group === "unknown") {
      unknownTokens.push(token);
    } else if (entry.behavior === "review_uncertainty" || entry.behavior === "soft_ignore") {
      softTokens.push(token);
    }
  }

  return { entries, byGroup, softTokens, strictTokens, unknownTokens };
}

export interface DescriptorComparisonSummary {
  matchedSoft: string[];
  matchedColors: string[];
  unmatchedTargetSoft: string[];
  unmatchedCandSoft: string[];
  unmatchedTargetHard: string[];
  unmatchedCandHard: string[];
  /** توصیف‌گرهای ظاهری/جنس/شکل/بازاریابی متفاوت دارند (عدم قطعیت، نه رد خودکار) */
  hasSoftDescriptorDifference: boolean;
  /** صرفاً توصیف‌گرهای نرم متفاوت یا غایب‌اند و هیچ واژهٔ سخت/سری ناهمخوان وجود ندارد */
  softDifferenceOnly: boolean;
  /** تضاد سخت در واریانت طبق سیاست رده (مثل رنگ سری هارد دیسک) */
  strictVariantMismatch: string[];
}

function stemDescriptor(word: string): string {
  return word.replace(/(?:های|ها|ان|ی|ه|ات)$/u, "");
}

function tokenMatchesSet(token: string, otherTokens: string[], otherNorm: string): boolean {
  const st = stemDescriptor(token);
  const otherStems = new Set(otherTokens.map(stemDescriptor));
  return otherStems.has(st) || otherNorm.includes(` ${token} `);
}

export function compareTitleDescriptors(
  targetTokens: string[],
  targetNorm: string,
  candTokens: string[],
  candNorm: string,
  productClass: string | null | undefined,
  config?: DescriptorPolicyConfig,
): DescriptorComparisonSummary {
  const tClass = analyzeTitleDescriptors(targetTokens, productClass, config);
  const cClass = analyzeTitleDescriptors(candTokens, productClass, config);

  const matchedSoft: string[] = [];
  const matchedColors: string[] = [];
  const unmatchedTargetSoft: string[] = [];
  const unmatchedCandSoft: string[] = [];
  const unmatchedTargetHard: string[] = [];
  const unmatchedCandHard: string[] = [];
  const strictVariantMismatch: string[] = [];

  for (const entry of tClass.entries) {
    const hit = tokenMatchesSet(entry.token, candTokens, ` ${candNorm} `);
    if (hit) {
      if (entry.group === "color") matchedColors.push(entry.token);
      if (entry.behavior === "review_uncertainty" || entry.behavior === "soft_ignore") matchedSoft.push(entry.token);
      continue;
    }
    if (entry.behavior === "strict_variant") {
      unmatchedTargetHard.push(entry.token);
      strictVariantMismatch.push(entry.token);
    } else if (entry.group === "unknown") {
      unmatchedTargetHard.push(entry.token);
    } else if (entry.behavior !== "soft_ignore") {
      unmatchedTargetSoft.push(`${entry.group}:${entry.token}`);
    }
  }

  for (const entry of cClass.entries) {
    const hit = tokenMatchesSet(entry.token, targetTokens, ` ${targetNorm} `);
    if (hit) continue;
    if (entry.behavior === "strict_variant") {
      unmatchedCandHard.push(entry.token);
      strictVariantMismatch.push(entry.token);
    } else if (entry.group === "unknown") {
      unmatchedCandHard.push(entry.token);
    } else if (entry.behavior !== "soft_ignore") {
      unmatchedCandSoft.push(`${entry.group}:${entry.token}`);
    }
  }

  const hasSoftDescriptorDifference = unmatchedTargetSoft.length > 0 || unmatchedCandSoft.length > 0;
  const softDifferenceOnly =
    hasSoftDescriptorDifference && unmatchedTargetHard.length === 0 && unmatchedCandHard.length === 0;

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
