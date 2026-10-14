/**
 * تایپ‌های مشترک موتور قیمت‌گذاری
 * همه پارامترها قابل تنظیم از طریق پروفایل قیمت‌گذاری هستند (ماژولار).
 */

/** پیشنهاد نرمال‌شده یک فروشنده (خروجی همه آداپتورهای منبع) */
export interface RawOffer {
  shopName: string;
  shopId?: string;
  price: number; // تومان
  lastChangedAt?: Date | null;
  isAd?: boolean;
  inStock?: boolean;
  url?: string;
  /** تعداد فروشنده‌های ادغام‌شده در این لیستینگ (اگر منبع بدهد) */
  mergedSellerCount?: number;
}

/** نتیجه استعلام از یک منبع */
export interface SourceResult {
  source: string;
  productTitle?: string;
  offers: RawOffer[];
  /** تعداد کل فروشندگان محصول در منبع (برای تشخیص لیستینگ ادغام‌شده) */
  totalSellerCount: number;
  fetchedAt: Date;
  /** وضعیت سلامت واکشی */
  ok: boolean;
  error?: string;
  /** اطلاعات خام برای دیباگ */
  meta?: Record<string, unknown>;
}

export interface OfferEvaluation extends RawOffer {
  included: boolean;
  excludeReason?: string;
  weight: number;
}

export type OutlierMethod = "iqr" | "mad" | "band";
export type AggregationMethod = "median" | "trimmed_mean" | "weighted_mean";

export interface PricingProfileConfig {
  /** ---------- فیلترهای اعتبار داده ---------- */
  filters: {
    /** حداقل تعداد فروشنده تا لیستینگ «ادغام‌شده و معتبر» تلقی شود */
    minSellerCount: number;
    /** پیشنهادهای قدیمی‌تر از این تعداد روز (آخرین تغییر قیمت) حذف می‌شوند */
    maxOfferAgeDays: number;
    /** حذف آگهی‌های تبلیغاتی (پولی) */
    excludeAds: boolean;
    /** حذف ناموجودها */
    excludeOutOfStock: boolean;
    /** لیست سیاه فروشگاه‌ها (نام یا شناسه) */
    shopBlacklist: string[];
    /** نام فروشگاه خودمان در ترب (تا قیمت خودمان در محاسبه لحاظ نشود) */
    ownShopNames: string[];
  };
  /** ---------- حذف داده‌های پرت ---------- */
  outliers: {
    method: OutlierMethod;
    /** ضریب IQR (پیش‌فرض 1.5) */
    iqrK: number;
    /** ضریب MAD (پیش‌فرض 3) */
    madK: number;
    /** باند سخت: هر قیمتی بیش از این درصد دور از میانه حذف می‌شود */
    hardBandPct: number;
    /** حداقل تعداد نمونه برای اجرای حذف پرت آماری */
    minSamples: number;
  };
  /** ---------- تجمیع (قیمت مرجع بازار) ---------- */
  aggregation: {
    method: AggregationMethod;
    /** درصد برش از هر طرف در trimmed mean */
    trimPct: number;
    /** نیمه‌عمر وزن‌دهی بر اساس تازگی (روز) — هرچه قدیمی‌تر وزن کمتر */
    recencyHalfLifeDays: number;
  };
  /** ---------- استراتژی رتبه اول ---------- */
  rank1: {
    enabled: boolean;
    /** اگر پایین‌ترین قیمت معتبر حداکثر این درصد از مرجع کمتر بود، برای رتبه اول تلاش کن */
    maxGapPct: number;
    /** مقدار کاهش نسبت به پایین‌ترین قیمت معتبر (تومان) */
    undercutAmount: number;
    /** کاهش درصدی (هر کدام بزرگتر بود) */
    undercutPct: number;
    /** اگر اختلاف بیش از maxGapPct بود، به جای رقابت با کف، روی مرجع بمان */
    fallbackToReference: boolean;
  };
  /** ---------- حاشیه سود و محافظ‌ها ---------- */
  margin: {
    /** حداقل سود درصدی روی قیمت تمام‌شده */
    minPct: number;
    /** سود هدف (برای وقتی داده بازار نداریم) */
    targetPct: number;
  };
  guards: {
    /** حداکثر تغییر درصدی قیمت نسبت به قیمت فعلی در هر اجرا (خطای نزدیک صفر) */
    maxChangePctPerRun: number;
    /** حداقل اعتماد برای اعمال خودکار؛ پایین‌تر → نیاز به بازبینی */
    minConfidenceAutoApply: number;
    /** اگر تعداد پیشنهاد معتبر کمتر بود → بازبینی */
    minValidOffers: number;
  };
  /** ---------- سیستم تخفیف (قیمت اصلی + تخفیف نمایشی) ---------- */
  discount: {
    /** قیمت اصلی = بالاترین حالت منطقی بازار (صدک بالا) یا نهایی × (1+markup) */
    basePriceMode: "market_upper" | "markup";
    /** صدک بازار برای قیمت اصلی (مثلاً 75 یعنی صدک 75 قیمت‌های معتبر) */
    marketUpperPercentile: number;
    /** درصد افزایش برای حالت markup */
    markupPct: number;
    /** حداقل تخفیف نمایشی */
    minDiscountPct: number;
    /** حداکثر تخفیف نمایشی (بیش از این غیرواقعی به نظر می‌رسد) */
    maxDiscountPct: number;
  };
  rounding: {
    /** گرد کردن قیمت نهایی (تومان) */
    finalStep: number;
    /** گرد کردن قیمت اصلی */
    baseStep: number;
    /** قیمت روانی: پایان با 900 یا 000 */
    psychological: "none" | "x900" | "x000";
  };
  /** ---------- هوش مصنوعی ---------- */
  ai: {
    /** استفاده از AI برای تأیید تطابق محصول و بازبینی تصمیم */
    enabled: boolean;
    /** بازبینی تصمیم توسط AI فقط وقتی اعتماد کمتر از این باشد */
    reviewBelowConfidence: number;
  };
}

export const DEFAULT_PROFILE_CONFIG: PricingProfileConfig = {
  filters: {
    minSellerCount: 5,
    maxOfferAgeDays: 7,
    excludeAds: true,
    excludeOutOfStock: true,
    shopBlacklist: [],
    ownShopNames: [],
  },
  outliers: {
    method: "iqr",
    iqrK: 1.5,
    madK: 3,
    hardBandPct: 25,
    minSamples: 4,
  },
  aggregation: {
    method: "weighted_mean",
    trimPct: 10,
    recencyHalfLifeDays: 3,
  },
  rank1: {
    enabled: true,
    maxGapPct: 3,
    undercutAmount: 1000,
    undercutPct: 0.3,
    fallbackToReference: true,
  },
  margin: {
    minPct: 5,
    targetPct: 15,
  },
  guards: {
    maxChangePctPerRun: 15,
    minConfidenceAutoApply: 0.7,
    minValidOffers: 3,
  },
  discount: {
    basePriceMode: "market_upper",
    marketUpperPercentile: 80,
    markupPct: 12,
    minDiscountPct: 4,
    maxDiscountPct: 35,
  },
  rounding: {
    finalStep: 1000,
    baseStep: 1000,
    psychological: "x000",
  },
  ai: {
    enabled: true,
    reviewBelowConfidence: 0.75,
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
  minMarginPctOverride?: number | null;
  currentFinalPrice?: number | null;
  category?: string | null;
  config: PricingProfileConfig;
  now?: Date;
}

export interface PricingResult {
  offers: OfferEvaluation[];
  offersTotal: number;
  offersUsed: number;
  lowestRaw: number | null;
  lowestValid: number | null;
  marketMedian: number | null;
  marketMean: number | null;
  referencePrice: number | null;
  finalPrice: number | null;
  basePrice: number | null;
  discountPct: number | null;
  strategy: string;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  steps: DecisionStepLog[];
}
