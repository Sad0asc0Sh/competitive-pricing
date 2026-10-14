import { summarizeMarket } from "./aggregate";
import { computeConfidence } from "./confidence";
import { buildDiscount } from "./discount";
import { applyRecencyWeights, applyValidityFilters } from "./filters";
import { applyGuards, applyRounding } from "./guards";
import { removeOutliers } from "./outliers";
import { decideTargetPrice } from "./strategy";
import type { DecisionStepLog, PricingContext, PricingResult, SourceResult } from "./types";

const fa = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("fa-IR"));

/**
 * موتور قیمت‌گذاری — Pipeline خالص (بدون IO) و قابل تست:
 *
 *  ورودی: SourceResult (پیشنهادهای رقبا) + PricingContext (محصول + پروفایل)
 *  1. اعتبار لیستینگ (تعداد فروشنده)
 *  2. فیلترهای اعتبار داده (آگهی، ناموجود، قدیمی، لیست سیاه)
 *  3. حذف پرت (باند سخت + IQR/MAD)
 *  4. وزن‌دهی تازگی و تجمیع → قیمت مرجع بازار
 *  5. استراتژی رتبه اول / مرجع
 *  6. محافظ‌ها (کف سود، سقف تغییر، گرد کردن)
 *  7. ساخت قیمت اصلی + تخفیف نمایشی
 *  8. امتیاز اعتماد و تصمیم «اعمال خودکار / بازبینی»
 */
export function runPricingPipeline(source: SourceResult, ctx: PricingContext): PricingResult {
  const cfg = ctx.config;
  const now = ctx.now ?? new Date();
  const steps: DecisionStepLog[] = [];
  const reviewReasons: string[] = [];
  const minMarginPct = ctx.minMarginPctOverride ?? cfg.margin.minPct;

  const log = (s: DecisionStepLog) => steps.push(s);

  // ---------- 0) سلامت منبع
  log({
    step: "source",
    title: "استعلام منبع",
    message: source.ok
      ? `${source.offers.length} پیشنهاد از «${source.source}» دریافت شد (${source.totalSellerCount} فروشنده در لیستینگ)`
      : `خطا در استعلام: ${source.error ?? "نامشخص"}`,
    level: source.ok ? "info" : "error",
    data: { totalSellerCount: source.totalSellerCount, productTitle: source.productTitle },
  });

  // ---------- 1) اعتبار لیستینگ
  if (source.totalSellerCount < cfg.filters.minSellerCount) {
    reviewReasons.push(
      `تعداد فروشنده (${source.totalSellerCount}) کمتر از حداقل ${cfg.filters.minSellerCount} — احتمالاً لیستینگ ادغام‌نشده`,
    );
    log({
      step: "listing",
      title: "اعتبار لیستینگ",
      message: `تعداد فروشنده کم است (${source.totalSellerCount} < ${cfg.filters.minSellerCount}); این لیستینگ به‌عنوان معیار قابل اعتماد نیست`,
      level: "warn",
    });
  } else {
    log({
      step: "listing",
      title: "اعتبار لیستینگ",
      message: `لیستینگ ادغام‌شده با ${source.totalSellerCount} فروشنده — معتبر`,
    });
  }

  // ---------- 2) فیلترهای اعتبار
  const offers = applyValidityFilters(source.offers, cfg.filters, now);
  const excludedByFilter = offers.filter((o) => !o.included);
  const reasonCounts: Record<string, number> = {};
  for (const o of excludedByFilter) reasonCounts[o.excludeReason ?? "?"] = (reasonCounts[o.excludeReason ?? "?"] ?? 0) + 1;
  log({
    step: "filters",
    title: "فیلتر اعتبار داده",
    message: `${excludedByFilter.length} پیشنهاد حذف شد (${Object.entries(reasonCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join("، ") || "هیچ"})؛ ${offers.length - excludedByFilter.length} پیشنهاد باقی ماند`,
    data: reasonCounts,
  });

  const lowestRaw = source.offers.length ? Math.min(...source.offers.filter((o) => o.price > 0).map((o) => o.price)) : null;

  // ---------- 3) حذف پرت
  const outlierReport = removeOutliers(offers, cfg.outliers);
  log({
    step: "outliers",
    title: "حذف داده‌های پرت",
    message: `${outlierReport.removed} پیشنهاد به‌عنوان پرت حذف شد (روش ${outlierReport.method}; بازه مجاز ${fa(outlierReport.lowerBound)} تا ${fa(outlierReport.upperBound)})`,
    data: { ...outlierReport },
  });

  // ---------- 4) وزن‌دهی و تجمیع
  applyRecencyWeights(offers, cfg.aggregation.recencyHalfLifeDays, now);
  const market = summarizeMarket(offers, cfg.aggregation);
  log({
    step: "aggregate",
    title: "قیمت مرجع بازار",
    message:
      market.count > 0
        ? `از ${market.count} پیشنهاد معتبر: کف ${fa(market.lowest)} | میانه ${fa(market.median)} | میانگین ${fa(market.mean)} | مرجع (${cfg.aggregation.method}) ${fa(market.reference)} | پراکندگی ${(market.dispersion * 100).toFixed(1)}%`
        : "هیچ پیشنهاد معتبری باقی نماند",
    level: market.count > 0 ? "info" : "warn",
    data: { ...market },
  });

  if (market.count < cfg.guards.minValidOffers) {
    reviewReasons.push(`تعداد پیشنهاد معتبر (${market.count}) کمتر از حداقل ${cfg.guards.minValidOffers}`);
  }

  // ---------- 5) استراتژی
  const strat = decideTargetPrice(market, cfg.rank1);
  let strategy: string = strat.strategy;
  let target = strat.targetPrice;
  log({ step: "strategy", title: "استراتژی قیمت هدف", message: strat.explanation, data: { target } });

  if (target == null) {
    // fallback: cost-plus
    if (ctx.costPrice > 0) {
      target = ctx.costPrice * (1 + cfg.margin.targetPct / 100);
      strategy = "cost_plus";
      reviewReasons.push("بدون داده بازار؛ قیمت بر اساس تمام‌شده + سود هدف تعیین شد");
      log({
        step: "fallback",
        title: "قیمت جایگزین",
        message: `قیمت = تمام‌شده × (1 + ${cfg.margin.targetPct}%) = ${fa(target)}`,
        level: "warn",
      });
    } else {
      return {
        offers,
        offersTotal: source.offers.length,
        offersUsed: market.count,
        lowestRaw,
        lowestValid: market.lowest,
        marketMedian: market.median,
        marketMean: market.mean,
        referencePrice: market.reference,
        finalPrice: null,
        basePrice: null,
        discountPct: null,
        strategy: "no_data",
        confidence: 0,
        needsReview: true,
        reviewReasons: [...reviewReasons, "نه داده بازار موجود است نه قیمت تمام‌شده"],
        steps,
      };
    }
  }

  // ---------- 6) محافظ‌ها
  const guarded = applyGuards(
    target,
    { costPrice: ctx.costPrice, minMarginPct, currentPrice: ctx.currentFinalPrice },
    cfg.guards,
    cfg.rounding,
  );
  reviewReasons.push(...guarded.reviewReasons);
  log({
    step: "guards",
    title: "محافظ‌ها",
    message: guarded.notes.length ? guarded.notes.join(" | ") : `بدون تخلف؛ قیمت نهایی گرد شد: ${fa(guarded.price)}`,
    level: guarded.notes.length ? "warn" : "info",
    data: { finalPrice: guarded.price },
  });
  const finalPrice = guarded.price;

  // ---------- 7) قیمت اصلی + تخفیف
  const disc = buildDiscount(finalPrice, offers, cfg.discount, cfg.rounding);
  const basePrice = applyRounding(disc.basePrice, cfg.rounding.baseStep, "none");
  log({ step: "discount", title: "قیمت اصلی و تخفیف", message: disc.explanation, data: { basePrice, discountPct: disc.discountPct } });

  // ---------- 8) اعتماد
  const conf = computeConfidence(market, { totalSellerCount: source.totalSellerCount, offersTotal: source.offers.length }, cfg);
  if (conf.score < cfg.guards.minConfidenceAutoApply) {
    reviewReasons.push(`اعتماد ${conf.score} کمتر از حد اعمال خودکار ${cfg.guards.minConfidenceAutoApply}`);
  }
  log({
    step: "confidence",
    title: "امتیاز اعتماد",
    message: `اعتماد ${Math.round(conf.score * 100)}% (فروشنده ${conf.breakdown.sellerScore}, معتبر ${conf.breakdown.validScore}, پراکندگی ${conf.breakdown.dispersionScore}, نگهداشت ${conf.breakdown.keepScore})`,
    data: conf.breakdown,
    level: conf.score < cfg.guards.minConfidenceAutoApply ? "warn" : "info",
  });

  const needsReview = reviewReasons.length > 0 || !source.ok;
  log({
    step: "decision",
    title: "نتیجه",
    message: needsReview
      ? `نیاز به بازبینی: ${reviewReasons.join("؛ ")}`
      : `اعمال خودکار: قیمت اصلی ${fa(basePrice)} → قیمت نهایی ${fa(finalPrice)} (${disc.discountPct}% تخفیف)`,
    level: needsReview ? "warn" : "info",
  });

  return {
    offers,
    offersTotal: source.offers.length,
    offersUsed: market.count,
    lowestRaw,
    lowestValid: market.lowest,
    marketMedian: market.median != null ? Math.round(market.median) : null,
    marketMean: market.mean != null ? Math.round(market.mean) : null,
    referencePrice: market.reference != null ? Math.round(market.reference) : null,
    finalPrice,
    basePrice,
    discountPct: disc.discountPct,
    strategy,
    confidence: conf.score,
    needsReview,
    reviewReasons,
    steps,
  };
}
