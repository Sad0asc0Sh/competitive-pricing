/**
 * تایپ‌های مشترک موتور قیمت‌گذاری هوشمند (نسخه ۳.۵ — مجهز به ناظر بالاسر SubQ SystemOne،
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
}

export type OutlierMethod = "iqr" | "mad" | "band";
export type AggregationMethod = "median" | "trimmed_mean" | "weighted_mean" | "modal_consensus";
export type SupplierSelectionMode = "priority_then_lowest" | "lowest_valid" | "conservative_high" | "weighted_priority";

export type SgeoooleCampaignType = "flash" | "featured" | "timed_sale" | "none";
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
    neverBelowManualCost: boolean;
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
    neverBelowManualCost: true,
    allowAutoApplyWithoutCost: true,
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
    undercutPct: 0.2,
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
  costPrice: number;
  supplierQuotes?: SupplierQuote[];
  minMarginPctOverride?: number | null;
  minProfitAmountOverride?: number | null;
  currentFinalPrice?: number | null;
  category?: string | null;
  cardIndex?: number;
  config: PricingProfileConfig;
  now?: Date;
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
    | "no_data";
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
  strategy: string;
  confidence: number;
  needsReview: boolean;
  rejectedBySupervisor?: boolean;
  reviewReasons: string[];
  steps: DecisionStepLog[];
}
