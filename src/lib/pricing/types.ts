import type { ValidityParams } from "./validity"
import type { ConfidenceModel, ScenarioAnalysis, ScenarioOptions } from "./robustness";
/**
 * تایپ‌های مشترک موتور قیمت‌گذاری هوشمند (نسخه ۳.۶ — مجهز به ناظر بالاسر SubQ SystemOne،
 * کشف کف و سقف واقعی بازار، کالیبراسیون دقیق سقف به کف، مدیریت ۳ سیستم تخفیف sgeooole و اعمال روی رنج کارت‌ها)
 */

export interface SupplierQuote {
  id?: number | string;
  supplierName: string;
  supplierCity?: string | null;
  rawPrice: number | string;
  currency?: "toman" | "rial" | "auto";
  buyPriceToman?: number;
  shippingOverheadToman?: number;
  otherOverheadPct?: number;
  inStock?: boolean;
  stockQty?: number | null;
  priority?: number;
  guarantee?: string | null;
  updatedAt?: Date | string | null;
  note?: string | null;
}

export interface EvaluatedSupplierQuote extends SupplierQuote {
  buyPriceToman: number;
  overheadAmountToman: number;
  effectiveSupplyCost: number;
  isLocalCity: boolean;
  ageDays: number | null;
  included: boolean;
  excludeReason?: string;
  selectionScore: number;
}

export interface SupplyCostResolution {
  costSource: "supplier_list" | "manual_cost" | "market_consensus_safe_floor" | "none";
  effectiveCostPrice: number;
  baseBuyPrice: number;
  overheadAmount: number;
  selectedQuote: EvaluatedSupplierQuote | null;
  evaluatedQuotes: EvaluatedSupplierQuote[];
  validQuotesCount: number;
  lowestQuoteCost: number | null;
  highestQuoteCost: number | null;
  medianQuoteCost: number | null;
  hardFloorPrice: number;
  minMarginPctUsed: number;
  minProfitAmountUsed: number;
  usedFallbackCost: boolean;
  usedMarketConsensusFloor: boolean;
  safetyBufferAppliedPct: number;
  explanation: string;
  warnings: string[];
  /** سیاست M2 که در این رزولوشن استفاده شد */
  costPolicyUsed?: CostResolutionPolicy;
  /** هشدار «زیر هزینه‌ی موجودی» وقتی کف از قیمت جایگزین پایین‌تر می‌رود (Policy replacement_floor) */
  inventoryReplacementWarning?: string | null;
}

export interface RawOffer {
  shopName: string;
  shopId?: string;
  shopCity?: string | null;
  sellerType?: "online" | "in_person";
  shopScore?: number | null;
  shopVotes?: number;
  shopScorePercentile?: number | null;
  price: number;
  postageFee?: number | null;
  deliveredPrice?: number | null;
  freeShipping?: boolean | null;
  sameDayDelivery?: string | null;
  paymentOnDelivery?: boolean | null;
  guarantee?: string | null;
  priceUnreliable?: boolean;
  lastChangedAt?: Date | null;
  lastChangedText?: string | null;
  isAd?: boolean;
  inStock?: boolean;
  url?: string;
  mergedSellerCount?: number;
}

export interface MarketPriceTrend {
  direction: "falling" | "rising" | "stable" | "unknown";
  changePct30d: number;
  latestLowest: number | null;
  latestAverage: number | null;
  summaryText?: string;
}

export interface SourceResult {
  source: string;
  productTitle?: string;
  /** عنوان انگلیسی/دوم کارت (name_en ترب) — برای استخراج کد مدل و برند در تطبیق هویت */
  productTitleEn?: string | null;
  prk?: string | null;
  detailsUrl?: string | null;
  offers: RawOffer[];
  totalSellerCount: number;
  inPersonSellerCount?: number;
  priceTrend?: MarketPriceTrend | null;
  fetchedAt: Date;
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface OfferEvaluation extends RawOffer {
  included: boolean;
  excludeReason?: string;
  weight: number;
  isLocalCity?: boolean;
  /** پیشنهاد «به‌روز» است (تاریخ آخرین تغییر در پنجره تازگی) — P1 طبقه‌بندی */
  fresh?: boolean;
  /** پیشنهاد «معتبر/قابل‌اتکا» است (فروشنده بالاتر از آستانه اطمینان و قیمت پایین‌تر از باند بالایی) */
  credible?: boolean;
  /** فروشنده با امتیاز اطمینان بالا (بالای آستانه highTrust) */
  highTrust?: boolean;
  /** برچسب طبقه‌بندی R0/R1: ok | confirmed_low | suspect_low | stale_low | high_outlier */
  cls?: OfferClass;
  /** (تخمین‌گر v2) احتمال قابل‌خرید بودن پیشنهاد با همان قیمت */
  pValid?: number;
  /** (تخمین‌گر v2) سن آخرین تغییر قیمت (روز)؛ null = نامعلوم */
  ageDays?: number | null;
}

export type OfferClass = "ok" | "confirmed_low" | "suspect_low" | "stale_low" | "high_outlier";

export type OutlierMethod = "iqr" | "mad" | "band";
export type AggregationMethod = "median" | "trimmed_mean" | "weighted_mean" | "modal_consensus";
export type SupplierSelectionMode = "priority_then_lowest" | "lowest_valid" | "conservative_high" | "weighted_priority";

export type SgeoooleCampaignType = "flash" | "featured" | "timed_sale" | "none";

/** سیاست تعیین قیمت خرید مؤثر در تقاطع قیمت انبار و لیست همکار (M2) */
export type CostResolutionPolicy =
  | "replacement_floor"
  | "max_inventory_replacement"
  | "legacy_never_below_manual";

export interface UndercutTier {
  /** سقف انکر (تومان)؛ null = بی‌نهایت (آخرین پله) */
  upTo: number | null;
  /** مبلغ undercut در این پله (تومان) — عدد صحیح مثبت */
  amount: number;
}

export type DiscountDecisionKind = "none" | "own_price_7d" | "market_p75" | "entry_min";

export interface DiscountContext {
  /** مرجع مقایسه برای محاسبه درصد تخفیف واقعی (own_price_7d بازار) */
  ownStableHigh7d: number | null;
  ownAvg7d: number | null;
  /** صفحه فروشگاه حاوی تخفیف فعال است؟ (محاسبه در runner) */
  activeSaleIds?: number[];
  lastPriceUpdateAt?: string | null;
}
export type SgeoooleBadgeTheme = "green-orange" | "gold-red" | "red-purple";
export type CeilingDiscoveryMode =
  | "market_percentile_ceiling"
  | "market_ceiling"
  | "highest_valid_seller"
  | "trimmed_upper_cluster"
  | "cluster_ceiling"
  | "market_upper"
  | "markup";

/**
 * تایپ‌های ناظر و تصمیم‌گیرنده بالاسر (`SubQ SystemOne Supervisor`)
 * منطبق با مستندات `POST https://api.subq.ai/v1/systemone` (`model: "subq-snap-preview"`, `type: "noul"`)
 */
export type SystemOneVerdict = "approve" | "review" | "reject";

export interface SystemOneQuestionSpec {
  type: "noul";
  instructions: string;
  criteria: {
    true: string;
    false: string;
  };
}

export interface SystemOneGateThresholdConfig {
  rejectBelowPct: number;
  approveAbovePct: number;
  weight: number;
}

export interface SystemOneSupervisorConfig {
  enabled: boolean;
  mode: "hybrid_subq_and_local" | "subq_api_only" | "local_instant_only";
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** آستانه سراسری رد کامل (پیش‌فرض ۴۵٪: زیر ۴۵٪ رد شود) */
  rejectBelowPct: number;
  /** آستانه سراسری تایید خودکار (پیش‌فرض ۸۰٪: بین ۴۵٪ تا ۸۰٪ ریویو، ۸۰٪ به بالا تایید و ادامه کار) */
  approveAbovePct: number;
  /** اگر true باشد، رد شدن هر یک از گیت‌های حیاتی کل تصمیم را متوقف می‌کند */
  strictGateVeto: boolean;
  /**
   * محرمانگی (۴.۲.۰): اگر true باشد، قیمت تمام‌شده و کف سود در درخواست API بیرونیِ SubQ ارسال می‌شود (رفتار ۴.۱.۲).
   * پیش‌فرض false: فقط نتیجهٔ «گارد سود» (PASSED/FAILED که محلی و قطعی محاسبه شده) ارسال می‌شود، نه خودِ اعداد.
   */
  shareCostWithApi?: boolean;
  gates: {
    identity_match: SystemOneGateThresholdConfig;
    market_data_integrity: SystemOneGateThresholdConfig;
    profit_and_rank_safety: SystemOneGateThresholdConfig;
    ceiling_discount_validity: SystemOneGateThresholdConfig;
  };
}

export interface SystemOneGateEvaluation {
  key: string;
  title: string;
  /** خروجی استاندارد SubQ noul در بازه 0.00 تا 1.00 */
  noul: number;
  /** معادل درصدی 0 تا 100 */
  scorePct: number;
  rejectBelowPct: number;
  approveAbovePct: number;
  verdict: SystemOneVerdict;
  weight: number;
  reason: string;
}

export interface SystemOneSupervisorReport {
  enabled: boolean;
  provider: "subq_systemone_api" | "systemone_local_instant";
  model: string;
  /** وضعیت اتصال واقعی به API ناظر: غیرفعال | بدون توکن | موفق | خطا */
  apiStatus?: "disabled" | "not_configured" | "ok" | "error";
  apiError?: string;
  overallNoul: number;
  overallScorePct: number;
  rejectBelowPct: number;
  approveAbovePct: number;
  verdict: SystemOneVerdict;
  gates: Record<string, SystemOneGateEvaluation>;
  requestPreview: {
    model: string;
    state: string;
    questions: Record<string, SystemOneQuestionSpec>;
  };
  summary: string;
}

export interface PricingProfileConfig {
  /** ---------- ۰) مدیریت لیست همکاران و تامین کالا + کشف هوشمند در نبود لیست ---------- */
  sourcing: {
    enabled: boolean;
    selectionMode: SupplierSelectionMode;
    maxQuoteAgeDays: number;
    preferLocalCitySuppliers: boolean;
    priorityTolerancePct: number;
    defaultOverheadPct: number;
    defaultNonLocalShippingToman: number;
    staleSafetyBufferPct: number;
    /** (M2 — منسوخ، به‌جای آن costPolicy) */ neverBelowManualCost: boolean;
    /** سیاست تقاطع قیمت انبار و لیست همکار: replacement_floor (کف از قیمت ریپلیس، هشدار در صورت عبور از آن) |
     *  max_inventory_replacement (کف از max انبار/ریپلیس) | legacy_never_below_manual (رفتار ۳.۶) */
    costPolicy: CostResolutionPolicy;
    allowAutoApplyWithoutCost: boolean;
    costlessSafePercentile: number;
    costlessSafetyMarginPct: number;
    impliedCostBackoffPct: number;
  };
  /** ---------- ۱) فیلترهای اعتبار داده رقبا در ترب ---------- */
  filters: {
    minSellerCount: number;
    maxOfferAgeDays: number;
    excludeAds: boolean;
    excludeOutOfStock: boolean;
    excludeUnreliablePrices: boolean;
    includeInPersonSellers: boolean;
    minShopScore: number;
    shopBlacklist: string[];
    ownShopNames: string[];
  };
  /** ---------- ۲) حذف داده‌های پرت و فروشندگان غیربه‌روز ---------- */
  outliers: {
    method: OutlierMethod;
    iqrK: number;
    madK: number;
    hardBandPct: number;
    lowerStaleBandPct: number;
    minSamples: number;
    /** حداکثر فاصله گروه خرید هم‌قیمت (٪ نسبت به مرجع) برای تشخیص «هسته تاییدشده» R0 */
    classifyClusterPct: number;
    /** باند بدگمانی پایین R1 (٪ زیر مرجع) برای غیرتاییدشده‌ها */
    suspectLowBandPct: number;
    /** آستانه تازگی «به‌روز» (روز) برای طبقه‌بندی R0/R1 */
    freshCutoffDays: number;
    /** حداقل تعداد اعضای گروه برای تشخیص cluster در R0 */
    minClusterMembers: number;
  };
  /** ---------- ۳) تجمیع و کشف قیمت معیار بازار ---------- */
  aggregation: {
    method: AggregationMethod;
    trimPct: number;
    recencyHalfLifeDays: number;
    modalClusterRadiusPct: number;
  };
  /** ---------- ۴) استراتژی هوشمند رتبه اول و قیمت‌گذار معیار بازار ---------- */
  rank1: {
    enabled: boolean;
    defaultCity: string;
    localCityAliases: string[];
    volumeMode: boolean;
    competeInDefaultCity: boolean;
    competeInReachableCluster: boolean;
    maxGapPct: number;
    clusterMaxGapPct: number;
    highTrustScoreThreshold: number;
    undercutAmount: number;
    undercutPct: number;
    /** پله‌های undercut بر اساس سطح انکر (تومان) — از کوچک به بزرگ؛ null=بی‌نهایت */
    undercutTiers: UndercutTier[];
    /** حداکثر فاصله مجاز از رهبر منفرد (٪) — فقط در حالت premium (پیش‌فرض: false) */
    leaderGapPct: number;
    /** حداقل حاشیه برای دنبال‌کردن رهبر/بدنه بازار در رقابت رهبر منفرد (٪) */
    leaderMinMarginPct: number;
    /**
     * حالت قدیمی «پلک بالای رهبر منفرد» (leader_sole_gap). پیش‌فرض false:
     * در بازار خلوت با رهبر منفرد، اگر حاشیه کافی باشد رتبه ۱ زیر رهبر می‌نشینیم،
     * وگرنه زیر بدنه بازار — هرگز بالاتر از رهبر.
     */
    leaderPremiumMode: boolean;
    localMonopolyDiscountFromRefPct: number;
    fallbackToReference: boolean;
  };
  /** ---------- ۵) حاشیه سود و خط قرمز فروش ---------- */
  margin: {
    minPct: number;
    targetPct: number;
    minProfitAmountToman: number;
    fixedCostToman: number;
    strictAboveCost: boolean;
  };
  /** ---------- ۶) محافظ‌ها ---------- */
  guards: {
    maxChangePctPerRun: number;
    minConfidenceAutoApply: number;
    minValidOffers: number;
    hysteresisPct: number;
    /** حداقل نسبت پیشنهادهای «به‌روز» (fresh) از کل معتبرها — رد آن → review نه reject */
    minFreshRatio: number;
    /**
     * ۴.۱.۲: حداقل حاشیه‌ی سود (٪) برای اعمال خودکار. ۰ = رفتار قبلی (هر قیمت بالای کف سود).
     * اگر مثبت باشد، تصمیم‌های با حاشیه‌ی کمتر از این عدد به‌جای applied به pending_review می‌روند.
     */
    profitApproveMarginPct: number;
  };
  /** ---------- ۷) کشف «سقف و کف اصولی بازار» و سیستم تخفیف سهگانه sgeooole ---------- */
  discount: {
    mode?: CeilingDiscoveryMode;
    basePriceMode: CeilingDiscoveryMode;
    marketUpperPercentile: number;
    maxCeilingAboveMedianPct: number;
    markupPct: number;
    minDiscountPct: number;
    maxDiscountPct: number;
    calibrateCeilingForExactFloor: boolean;
    /** مرجع مقایسه درصد تخفیف: پنجره ۷ روزی بالاترین قیمت اعمال‌شده خودی */
    ownPriceWindowDays: number;
    /** حداقل دوام قیمت خودی پیش از تبدیل به سقف مرجع */
    ownPriceMinHoldHours: number;
  };
  /** ---------- ۸) گرد کردن ---------- */
  rounding: {
    finalStep: number;
    baseStep: number;
    psychological: "none" | "x900" | "x000";
  };
  /** ---------- ۹) ناظر و تصمیم‌گیرنده بالاسر SubQ SystemOne (قانون ۳ بازه‌ای ۰..۴۵..۸۰..۱۰۰٪) ---------- */
  supervisor: SystemOneSupervisorConfig;
  /** ---------- ۱۰) هوش مصنوعی مکمل ---------- */
  ai: {
    enabled: boolean;
    reviewBelowConfidence: number;
  };
  /** ---------- ۱۱) مسیر بی‌هزینه (بدون لیست همکار و بدون قیمت خرید) — Provisional ---------- */
  costless: {
    /** صدک پول استخراج بازار برای قیمت provision یکی (مثلاً ۳۰) */
    provisionalPercentile: number;
    /** حداقل فروشندگان معتبر-به‌روز برای فعال بودن مسیر */
    minCredibleFresh: number;
    /** اجازه اعمال خودکار قیمت provision یک (پیش‌فرض false → همیشه review) */
    autoApply: boolean;
  };
  /** ---------- ۱۲) نسخه موتور (ذخیره در هر تصمیم) ---------- */
  engine: {
    version: string;
  };
  /**
   * ---------- ۱۳) تخمین‌گر نسخه ۲ ----------
   * هر زیرقابلیت پرچم جدا دارد تا اثرش در ablation سنجیده شود و در صورت لزوم جدا خاموش شود.
   * mode="legacy" همهٔ آن‌ها را نادیده می‌گیرد و رفتار ۴.۱.۲ را برمی‌گرداند.
   */
  estimator: {
    mode: "legacy" | "v2";
    /** اعتبار احتمالی هر پیشنهاد (سن × رانش بازار × عمق × شهرت × تأییدیه) به‌جای حذف سخت سنی و قاعدهٔ R1 */
    validityModel: boolean;
    /** حذف سخت «بیش از maxOfferAgeDays» برداشته می‌شود و سن به‌صورت نرم در مدل اعتبار وارد می‌شود */
    softStaleness: boolean;
    /** سقف مطلق سن (روز) حتی در حالت نرم؛ قیمت‌های قدیمی‌تر از آن رها شده‌اند */
    hardMaxOfferAgeDays: number;
    /** رفع باگ: guarantee="disabled" هم truthy بود و فروشنده را «اعتماد بالا» می‌کرد */
    guaranteeFix: boolean;
    /** هزینهٔ نسبیِ «غیررقابتی ماندن» به «بخشیدن سود» (۱ = قرینه؛ >۱ = رقابت مهم‌تر) */
    competitivenessCostRatio: number;
    /** پارامترهای مدل اعتبار (override جزئی) */
    validity: Partial<ValidityParams>;
    /** پیشنهاد زیر قیمت ما فقط وقتی «تعارض بازار/ریویو» می‌شود که احتمال اعتبارش معنادار باشد */
    marketConflictByProbability: boolean;
    /** حداقل احتمال اعتبار برای ثبت «تعارض بازار» (با marketConflictByProbability) */
    conflictMinProb: number;
    /** ملاحظهٔ برش خروجی ترب (offers_truncated) در قواعد محلی/اعتماد */
    truncationAware: boolean;
    /** اگر لنگر با احتمال بالا تأیید شده، قاعدهٔ حداکثر فاصلهٔ مرجع (maxGapPct) آن را کنار نزند */
    chaseConfirmedLow: boolean;
    /** اعتماد کالیبره‌شده = P(|خطا| ≤ ۲٪) به‌جای ترکیب ساده */
    calibratedConfidence: boolean;
    /** تحلیل سناریوهای تصمیم (پایداری قیمت نهایی نسبت به عدم‌قطعیتِ اعتبار پیشنهادها) */
    scenario: Partial<ScenarioOptions>;
    /** ضرایب مدل اعتمادِ کالیبره (برآوردشده با eval/market/fit-confidence.cjs) */
    confidenceModel: Partial<ConfidenceModel>;
    /** حداقل اعتمادِ کالیبره برای اعمال خودکار؛ کمتر از آن به بازبینی می‌رود */
    minCalibratedConfidence: number;
    /** «تعارض بازار» (پیشنهاد مشکوکِ زیر قیمت ما) حتی با اعتمادِ کالیبره هم ثبت شود؟ (پیش‌فرض: خیر؛ سناریوها آن را پوشش می‌دهند) */
    conflictGateWhenCalibrated: boolean;
    /** گیت «اعتبار داده بازار» ناظر SystemOne با احتمالِ کالیبرهٔ درستیِ قیمت جایگزین امتیاز ساده شود */
    supervisorMarketCalibrated: boolean;
  };
}

export const DEFAULT_PROFILE_CONFIG: PricingProfileConfig = {
  sourcing: {
    enabled: true,
    selectionMode: "priority_then_lowest",
    maxQuoteAgeDays: 5,
    preferLocalCitySuppliers: true,
    priorityTolerancePct: 1.5,
    defaultOverheadPct: 0.5,
    defaultNonLocalShippingToman: 0,
    staleSafetyBufferPct: 2.5,
    // M2: neverBelowManualCost فقط نام قدیمی «کف از هزینه‌ی انبار» است؛ منبع حقیقت
    // costPolicy است. پیش‌فرض ۴.۱.۲ محافظه‌کارانه است تا این دو فیلد متناقض نباشند:
    // max_inventory_replacement یعنی هیچ‌گاه زیر max(هزینه انبار، ریپلیس) فروش نکن.
    // اگر می‌خواهید برای رقابت، ریپلیس ارزان‌تر ملاک باشد، costPolicy را در تنظیمات
    // به replacement_floor تغییر دهید (و neverBelowManualCost را false کنید).
    neverBelowManualCost: true,
    costPolicy: "max_inventory_replacement",
    allowAutoApplyWithoutCost: false,
    costlessSafePercentile: 55,
    costlessSafetyMarginPct: 1.0,
    impliedCostBackoffPct: 6.0,
  },
  filters: {
    minSellerCount: 4,
    maxOfferAgeDays: 7,
    excludeAds: true,
    excludeOutOfStock: true,
    excludeUnreliablePrices: true,
    includeInPersonSellers: true,
    minShopScore: 0,
    shopBlacklist: [],
    ownShopNames: ["sgeooole", "ekgkala", "ای کا جی کالا", "ای‌کا‌جی کالا"],
  },
  outliers: {
    method: "iqr",
    iqrK: 1.5,
    madK: 2.5,
    hardBandPct: 25,
    lowerStaleBandPct: 16,
    minSamples: 4,
    classifyClusterPct: 3,
    suspectLowBandPct: 12,
    freshCutoffDays: 5,
    minClusterMembers: 2,
  },
  aggregation: {
    method: "modal_consensus",
    trimPct: 15,
    recencyHalfLifeDays: 3,
    modalClusterRadiusPct: 3.0,
  },
  rank1: {
    enabled: true,
    defaultCity: "مشهد",
    localCityAliases: ["مشهد", "mashhad", "مشهدمقدس", "خراسان رضوی - مشهد", "مشهد مقدس"],
    volumeMode: true,
    competeInDefaultCity: true,
    competeInReachableCluster: true,
    maxGapPct: 4,
    clusterMaxGapPct: 5,
    highTrustScoreThreshold: 4.5,
    undercutAmount: 1000,
    undercutPct: 0,
    undercutTiers: [
      { upTo: 2_000_000, amount: 1_000 },
      { upTo: 10_000_000, amount: 2_000 },
      { upTo: 30_000_000, amount: 5_000 },
      { upTo: null, amount: 10_000 },
    ],
    leaderGapPct: 4,
    leaderMinMarginPct: 5,
    leaderPremiumMode: false,
    localMonopolyDiscountFromRefPct: 1.0,
    fallbackToReference: true,
  },
  margin: {
    minPct: 3,
    targetPct: 12,
    minProfitAmountToman: 10000,
    fixedCostToman: 0,
    strictAboveCost: true,
  },
  guards: {
    maxChangePctPerRun: 20,
    minConfidenceAutoApply: 0.65,
    minValidOffers: 2,
    hysteresisPct: 0.15,
    minFreshRatio: 0.3,
    // ۰ = سازگاری کامل با ۴.۱.۱؛ برای محافظه‌کاری بیشتر مثلاً ۵ بگذارید.
    profitApproveMarginPct: 0,
  },
  discount: {
    mode: "market_percentile_ceiling",
    basePriceMode: "market_ceiling",
    marketUpperPercentile: 85,
    maxCeilingAboveMedianPct: 18,
    markupPct: 12,
    minDiscountPct: 5,
    maxDiscountPct: 35,
    calibrateCeilingForExactFloor: true,
    ownPriceWindowDays: 7,
    ownPriceMinHoldHours: 48,
  },
  rounding: {
    finalStep: 1000,
    baseStep: 1000,
    psychological: "x000",
  },
  supervisor: {
    enabled: true,
    mode: "hybrid_subq_and_local",
    baseUrl: "https://api.subq.ai/v1",
    model: "subq-snap-preview",
    rejectBelowPct: 45,
    approveAbovePct: 80,
    strictGateVeto: true,
    shareCostWithApi: false,
    gates: {
      identity_match: { rejectBelowPct: 45, approveAbovePct: 80, weight: 0.3 },
      market_data_integrity: { rejectBelowPct: 45, approveAbovePct: 80, weight: 0.25 },
      profit_and_rank_safety: { rejectBelowPct: 45, approveAbovePct: 80, weight: 0.3 },
      ceiling_discount_validity: { rejectBelowPct: 45, approveAbovePct: 80, weight: 0.15 },
    },
  },
  ai: {
    enabled: true,
    reviewBelowConfidence: 0.72,
  },
  costless: {
    provisionalPercentile: 30,
    minCredibleFresh: 3,
    autoApply: false,
  },
  engine: {
    version: "4.2.0",
  },
  estimator: {
    mode: "v2",
    validityModel: true,
    softStaleness: true,
    hardMaxOfferAgeDays: 90,
    guaranteeFix: true,
    competitivenessCostRatio: 0.75,
    validity: {},
    marketConflictByProbability: true,
    conflictMinProb: 0.1,
    truncationAware: true,
    chaseConfirmedLow: true,
    calibratedConfidence: true,
    scenario: {},
    confidenceModel: {},
    minCalibratedConfidence: 0.9,
    conflictGateWhenCalibrated: false,
    supervisorMarketCalibrated: true,
  },
};

export interface DecisionStepLog {
  step: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  level?: "info" | "warn" | "error";
}

export interface PricingContext {
  productId: number;
  productName: string;
  sku?: string | null;
  costPrice: number;
  supplierQuotes?: SupplierQuote[];
  minMarginPctOverride?: number | null;
  minProfitAmountOverride?: number | null;
  currentFinalPrice?: number | null;
  category?: string | null;
  cardIndex?: number;
  config: PricingProfileConfig;
  now?: Date;
  /** تاریخچه قیمت خودی محصولات (برای مرجع own_price_7d) — محاسبه در runner */
  discountContext?: DiscountContext;
}

export interface MarketFloorCeilingReport {
  rawLowestPrice?: number | null;
  rawHighestPrice?: number | null;
  monitoredSellersCount: number;
  excludedOutliersCount: number;
  monitoredMarketFloor: number | null;
  monitoredMarketMedian: number | null;
  monitoredMarketCeiling: number | null;
  calibratedCeilingPrice?: number;
  ceilingBasePrice: number;
  targetFloorPrice: number;
  discountPct?: number;
  appliedDiscountPct: number;
  discountAmountToman?: number;
  exactFloorRestored: number;
  ceilingMethodUsed?: string;
  discoveryModeUsed: string;
  explanation?: string;
}

export interface CompetitivePositionReport {
  projectedNationalRank: number | null;
  totalNationalValidSellers: number;
  projectedLocalRank: number | null;
  totalLocalValidSellers: number;
  localLowestPrice: number | null;
  localMedianPrice: number | null;
  firstReachableNationalPrice: number | null;
  firstReachableLocalPrice: number | null;
  modalConsensusPrice: number | null;
  netProfitToman: number;
  netMarginPct: number;
  competitionTier:
    | "national_rank1"
    | "local_city_rank1"
    | "local_cluster_rank1"
    | "national_cluster_rank1"
    | "high_trust_cluster_rank1"
    | "local_monopoly_leader"
    | "market_maker_consensus"
    | "volume_floor_min_margin"
    | "market_reference"
    | "cost_plus_target"
    | "no_data"
    | "leader_sole_gap"
    | "provisional_market_percentile";
  /** فاصله قیمت ما از رهبر منفرد بازار (٪) — null = بدون رهبر منفرد */
  leaderGapPct?: number | null;
  /** رتبه با احتساب فروشنده‌های مشکوک/کهنهٔ حذف‌شده (برای گزارش شفاف کنار رتبهٔ قابل‌اتکا) */
  rankIncludingSuspect: number | null;
  /** تعداد کل فروشنده‌های دارای قیمت، شامل مشکوک/کهنه (برای گزارش شفاف) */
  totalSellersIncludingSuspect: number;
}

export interface PricingResult {
  offers: OfferEvaluation[];
  offersTotal: number;
  offersUsed: number;
  lowestRaw: number | null;
  lowestValid: number | null;
  marketMedian: number | null;
  marketMean: number | null;
  modalConsensusPrice?: number | null;
  referencePrice: number | null;
  supply: SupplyCostResolution;
  position: CompetitivePositionReport;
  floorCeiling: MarketFloorCeilingReport;
  supervisor: SystemOneSupervisorReport;
  finalPrice: number | null;
  basePrice: number | null;
  discountPct: number | null;
  /** مرجع تخفیف تصمیم (own_price_7d / market_p75 / none) — P3 */
  discountReferenceKind?: DiscountDecisionKind;
  discountReferencePrice?: number | null;
  /** کالیبراسیون دقیق شد؟ (sgeooole: base×(1−pct) == final) */
  floorConfirmed?: boolean;
  strategy: string;
  confidence: number;
  needsReview: boolean;
  /** یک فروشنده suspect_low زیر قیمت پیشنهادی ما قرار گرفت → موضوع ریویو (market_conflict) */
  marketConflict?: boolean;
  /** قیمت از جنس Provisional است (مسیر بی‌هزینه یا انکر ضعیف) */
  isProvisional?: boolean;
  rejectedBySupervisor?: boolean;
  reviewReasons: string[];
  steps: DecisionStepLog[];
  /** تحلیل پایداری تصمیم نسبت به عدم‌قطعیتِ اعتبار پیشنهادها (فقط در تخمین‌گر v2) */
  decisionScenarios?: ScenarioAnalysis;
  /** اجزای اعتماد (برای شفافیت و واکاوی) */
  confidenceBreakdown?: Record<string, number>;
}
