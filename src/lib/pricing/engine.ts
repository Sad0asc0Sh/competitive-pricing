import { summarizeMarket } from "./aggregate";
import { computeConfidence } from "./confidence";
import { buildDiscount } from "./discount";
import { applyRecencyWeights, applyValidityFilters } from "./filters";
import { applyGuards } from "./guards";
import { evaluateTorobCandidate } from "./matcher";
import { removeOutliers } from "./outliers";
import { resolveSupplyCost } from "./sourcing";
import { decideTargetPrice, evaluateCompetitivePosition } from "./strategy";
import { ceilToStep, percentile } from "./stats";
import { assessValidity, type ValidityReport } from "./validity";
import { analyzeDecisionScenarios, calibratedConfidence, type ScenarioAnalysis } from "./robustness";
import { evaluateSystemOneSupervisorSync } from "./systemone-supervisor";
import type {
  CompetitivePositionReport,
  DecisionStepLog,
  OfferEvaluation,
  PricingContext,
  PricingResult,
  SourceResult,
} from "./types";

const fa = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("fa-IR"));

/** استراتژی‌هایی که قیمت را «زیر یک رقیب» می‌گذارند؛ گرد کردنشان همیشه به پایین است (هرگز بالای رقیب نشویم) */
const UNDERCUT_ANCHOR_STRATEGIES = new Set([
  "national_rank1_undercut",
  "rank1_undercut",
  "local_city_rank1_undercut",
  "local_cluster_rank1",
  "national_cluster_rank1",
  "high_trust_cluster_rank1",
  "match_lowest",
]);

export function runPricingPipeline(source: SourceResult, ctx: PricingContext): PricingResult {
  const cfg = ctx.config;
  const now = ctx.now ?? new Date();
  const steps: DecisionStepLog[] = [];
  const reviewReasons: string[] = [];

  const log = (s: DecisionStepLog) => steps.push(s);

  // تخمین‌گر نسخه ۲ (هر پرچم جداگانه قابل‌خاموش‌کردن است؛ mode="legacy" رفتار ۴.۱.۲ را برمی‌گرداند)
  const est = cfg.estimator;
  const v2 = est?.mode === "v2";
  const useValidity = v2 && est.validityModel;
  const softStaleness = useValidity && est.softStaleness;
  const guaranteeStrict = v2 && est.guaranteeFix;

  let strategy: string = "";
  let competitionTier: CompetitivePositionReport["competitionTier"] = "no_data";
  let target: number | null = null;
  let strategyExplanation = "";

  // ---------- 0) بررسی اولیه قیمت خرید و تامین از لیست همکاران
  let supply = resolveSupplyCost({
    supplierQuotes: ctx.supplierQuotes,
    manualCostPrice: ctx.costPrice,
    minMarginPctOverride: ctx.minMarginPctOverride,
    minProfitAmountOverride: ctx.minProfitAmountOverride,
    config: cfg,
    now,
  });

  const isInitiallyCostless = supply.effectiveCostPrice <= 0;

  if (!isInitiallyCostless) {
    for (const w of supply.warnings) {
      // M2: هشدار «زیر هزینه‌ی موجودی» مسیر ریویو نیست؛ فقط در گزارش شفاف‌سازی می‌شود (T2)
      if (supply.costPolicyUsed === "replacement_floor" && w === supply.inventoryReplacementWarning) {
        continue;
      }
      reviewReasons.push(w);
    }
    log({
      step: "sourcing",
      title: "اولویت اول: قیمت خرید همکاران و خط قرمز فروش",
      message: `${supply.explanation} | خط قرمز قطعی فروش (با حداقل سود ${supply.minMarginPctUsed}%): ${fa(supply.hardFloorPrice)} تومان`,
      level: supply.warnings.length === 0 ? "info" : "warn",
      data: {
        costSource: supply.costSource,
        effectiveCostPrice: supply.effectiveCostPrice,
        baseBuyPrice: supply.baseBuyPrice,
        overheadAmount: supply.overheadAmount,
        hardFloorPrice: supply.hardFloorPrice,
        validQuotesCount: supply.validQuotesCount,
        selectedSupplier: supply.selectedQuote?.supplierName ?? null,
        costPolicy: supply.costPolicyUsed,
        inventoryReplacementWarning: supply.inventoryReplacementWarning,
      },
    });
  }

  // ---------- 1) سلامت منبع، تطبیق هویت ۷ لایه محصول و اعتبار لیستینگ
  log({
    step: "source",
    title: "استعلام منبع (ترب)",
    message: source.ok
      ? `${source.offers.length} پیشنهاد از «${source.source}» دریافت شد (${source.totalSellerCount} فروشنده در لیستینگ)`
      : `خطا در استعلام: ${source.error ?? "نامشخص"}`,
    level: source.ok ? "info" : "error",
    data: { totalSellerCount: source.totalSellerCount, productTitle: source.productTitle, prk: source.prk },
  });

  const ownLower = cfg.filters.ownShopNames.map((n) => n.toLowerCase());
  const selfShopInListing = source.offers.some((o) =>
    ownLower.some((own) => own && o.shopName.toLowerCase().includes(own)),
  );
  let identityMatchScorePct = 92;
  // آیا حضور فروشگاه خودمان به‌عنوان «تأیید متقاطع هویت» پذیرفته می‌شود؟ (پیش‌فرض بله؛ تضاد هویتی آن را باطل می‌کند)
  let selfConfirmsIdentity = selfShopInListing;

  if (source.productTitle && ctx.productName) {
    const idRej = cfg.supervisor?.gates?.identity_match?.rejectBelowPct ?? cfg.supervisor?.rejectBelowPct ?? 45;
    const idApp = cfg.supervisor?.gates?.identity_match?.approveAbovePct ?? cfg.supervisor?.approveAbovePct ?? 80;

    // قیمت نمایندهٔ کارت (میانهٔ قیمت‌های مثبت) برای قید نسبت قیمتی «لوازم جانبی/پک/مدل بالاتر» در تطبیق‌دهنده
    const cardPrices = source.offers.map((o) => o.price).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
    const cardRepresentativePrice = cardPrices.length ? cardPrices[Math.floor((cardPrices.length - 1) / 2)] : null;

    const identityCheck = evaluateTorobCandidate(
      {
        productName: ctx.productName,
        sku: ctx.sku,
        anchorPriceToman: supply.effectiveCostPrice > 0 ? supply.effectiveCostPrice : ctx.currentFinalPrice,
        rejectBelowPct: idRej,
        approveAbovePct: idApp,
      },
      {
        prk: source.prk ?? "manual",
        titleFa: source.productTitle,
        titleEn: source.productTitleEn ?? null,
        priceToman: cardRepresentativePrice,
        sellerCount: source.totalSellerCount,
        available: true,
      },
      cfg.filters.minSellerCount,
    );

    // حضور فروشگاه خودمان در لیستینگ «ابهام» را برطرف می‌کند (review → approve) ولی هرگز «رد قطعیِ هویتی»
    // (کد مدل متفاوت، لوازم جانبی، پک، دست‌دوم، تضاد مشخصات) را نمی‌پوشاند: در آن حالت یا ترب کارت را اشتباه
    // ادغام کرده یا عنوان محصول ما نادرست است، و هر دو نیازمند بازبینی انسانی‌اند (اندازه‌گیری: eval/market، سناریوی wrongself).
    // رابطهٔ «نسخهٔ متفاوت» (پسوند اضافه/کم، هم‌خانواده) یعنی شواهدِ محصول دیگر؛ نه فقط کمبود اطلاعات
    const variantRelations = new Set(["ext_seg", "ext_chars", "sibling"]);
    const hardIdentityReject = identityCheck.verdict === "reject";
    const variantConflict = Boolean(identityCheck.codeRelation && variantRelations.has(identityCheck.codeRelation));
    const selfConfirms = selfShopInListing && !hardIdentityReject && !variantConflict;
    selfConfirmsIdentity = selfConfirms;
    identityMatchScorePct = selfConfirms ? Math.max(95, identityCheck.score) : identityCheck.score;

    if (hardIdentityReject) {
      reviewReasons.push(
        selfShopInListing
          ? `رد در گیت ورودی هویت کالا (${identityCheck.score}% < ${idRej}%) با وجود حضور فروشگاه خودمان در لیستینگ — ترب کارت را احتمالاً اشتباه ادغام کرده یا عنوان محصول ما نادرست است: ${identityCheck.rejectReason}`
          : `رد در گیت ورودی هویت کالا (${identityCheck.score}% < ${idRej}%): ${identityCheck.rejectReason}`,
      );
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message: `رد شد (امتیاز ${identityCheck.score}% / noul=${identityCheck.noul.toFixed(2)} < ${idRej}%): «${source.productTitle}» در برابر «${ctx.productName}» — ${identityCheck.rejectReason}${selfShopInListing ? " — حضور فروشگاه خودمان در لیستینگ، رد هویتی را نمی‌پوشاند" : ""}`,
        level: "error",
        data: { score: identityCheck.score, noul: identityCheck.noul, verdict: identityCheck.verdict, selfShopInListing, codeRelation: identityCheck.codeRelation ?? null },
      });
    } else if (identityCheck.verdict === "review" && !selfConfirms) {
      reviewReasons.push(
        `امتیاز تطابق هویت کالا در بازه ریویو (${identityCheck.score}% بین ${idRej}% و ${idApp}%)` +
          (identityCheck.blockers?.length ? ` — ${identityCheck.blockers[0]}` : ""),
      );
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message: `ارسال به بخش ریویو (امتیاز ${identityCheck.score}% / noul=${identityCheck.noul.toFixed(2)} در بازه ${idRej}%..${idApp}%): «${source.productTitle}»${identityCheck.blockers?.length ? ` — ${identityCheck.blockers.join(" · ")}` : ""}`,
        level: "warn",
        data: { score: identityCheck.score, noul: identityCheck.noul, verdict: identityCheck.verdict, codeRelation: identityCheck.codeRelation ?? null, blockers: identityCheck.blockers ?? [] },
      });
    } else {
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message:
          `تایید خودکار ورودی با امتیاز ${identityMatchScorePct}% (noul=${(identityMatchScorePct / 100).toFixed(2)} ≥ ${idApp}%)` +
          (selfConfirms ? " + تأیید متقاطع (حضور فروشگاه خودمان در همین لیستینگ ادغام‌شده ترب)" : "") +
          (identityCheck.notes.length ? ` · ${identityCheck.notes.join(" · ")}` : ""),
        level: "info",
        data: { score: identityMatchScorePct, noul: identityMatchScorePct / 100, verdict: "approve", selfShopInListing, codeRelation: identityCheck.codeRelation ?? null },
      });
    }
  }

  // P0-7: اگر عنوان کارت ترب غایب بود (fail-closed) تطابق هویت هرگز بالای ۷۰٪ نمی‌رود
  if (!source.productTitle) {
    identityMatchScorePct = Math.min(identityMatchScorePct, 70);
    if (!selfShopInListing) {
      reviewReasons.push("عنوان کارت ترب دریافت نشد — تطابق هویت نیاز به بازبینی در صف (قفل PRK تنها با تایید هویت باز می‌شود)");
    }
    log({
      step: "identity",
      title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
      message:
        `عنوان کارت ترب غایب بود → سقف تطابق هویت ${identityMatchScorePct}% (fail-closed ≤ ۷۰%)` +
        (selfShopInListing ? " — با اعتبار حضور فروشگاه خودمان در لیستینگ، مسیر ریویو رد شد" : " — ارسال به ریویو برای تطابق دستی مدیر"),
      level: "warn",
      data: { score: identityMatchScorePct, titleMissing: true, selfShopInListing },
    });
  }

  if (source.totalSellerCount < cfg.filters.minSellerCount) {
    reviewReasons.push(
      `تعداد فروشنده (${source.totalSellerCount}) کمتر از حداقل ${cfg.filters.minSellerCount} — احتمالاً لیستینگ ادغام‌نشده`,
    );
    log({
      step: "listing",
      title: "اعتبار لیستینگ",
      message: `تعداد فروشنده کم است (${source.totalSellerCount} < ${cfg.filters.minSellerCount}); این لیستینگ به‌عنوان معیار مستقل نیاز به دقت دارد`,
      level: "warn",
    });
  } else {
    log({
      step: "listing",
      title: "اعتبار لیستینگ",
      message: `لیستینگ ادغام‌شده با ${source.totalSellerCount} فروشنده — معتبر`,
    });
  }

  // ---------- 2) فیلترهای اعتبار داده + تفکیک شهر پیش‌فرض (مشهد)
  const offers = applyValidityFilters(
    source.offers,
    cfg.filters,
    now,
    cfg.rank1,
    softStaleness ? { softStaleness: true, hardMaxAgeDays: est.hardMaxOfferAgeDays } : undefined,
  );
  const excludedByFilter = offers.filter((o) => !o.included);
  const localValidBeforeOutlier = offers.filter((o) => o.included && o.isLocalCity).length;
  const reasonCounts: Record<string, number> = {};
  for (const o of excludedByFilter) {
    reasonCounts[o.excludeReason ?? "?"] = (reasonCounts[o.excludeReason ?? "?"] ?? 0) + 1;
  }

  log({
    step: "filters",
    title: "فیلتر اعتبار داده و تفکیک جغرافیایی",
    message:
      `${excludedByFilter.length} پیشنهاد نامعتبر حذف شد (${
        Object.entries(reasonCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join("، ") || "هیچ"
      })؛ ` +
      `${offers.length - excludedByFilter.length} پیشنهاد معتبر باقی ماند (${localValidBeforeOutlier} فروشنده در ${cfg.rank1.defaultCity})`,
    data: { ...reasonCounts, localValidBeforeOutlier },
  });

  const positiveRawPrices = source.offers
    .map((o) => o.price)
    .filter((p) => Number.isFinite(p) && p > 0);
  const lowestRaw = positiveRawPrices.length ? Math.min(...positiveRawPrices) : null;

  // ---------- 3) طبقه‌بندی هوشمند داده‌های پرت و فروشندگان غیربه‌روز
  //  legacy: R0/R1 (نسخه ۴.۱) | v2: مدل احتمالیِ اعتبار برای سمت پایین + باند/IQR فقط برای سمت بالا
  let validity: ValidityReport | null = null;
  if (useValidity) {
    validity = assessValidity(offers, now, {
      params: est.validity,
      freshCutoffDays: cfg.outliers.freshCutoffDays,
      highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
      competitivenessCostRatio: est.competitivenessCostRatio,
    });
    for (const [o, v] of validity.perOffer) {
      o.pValid = Math.round(v.p * 1000) / 1000;
      o.ageDays = v.ageDays != null ? Math.round(v.ageDays * 100) / 100 : null;
    }
  }
  const outlierReport = removeOutliers(offers, cfg.outliers, {
    isCostlessMode: isInitiallyCostless,
    now,
    highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
    highSideOnly: useValidity,
  });
  // پیشنهادهایی که مدل اعتبار نگه داشت ولی پرتِ سمت بالا شدند؛ در هیچ فرضِ سناریویی وارد بازار نمی‌شوند
  const validityExcluded = new Set<OfferEvaluation>(validity?.excludedOffers ?? []);
  const highOutlierSet = new Set<OfferEvaluation>();
  if (validity) for (const o of validity.perOffer.keys()) if (!o.included && !validityExcluded.has(o)) highOutlierSet.add(o);
  if (validity) {
    for (const x of validity.excludedLows) {
      outlierReport.suspectLows.push({ price: x.price, shopName: x.shopName, cls: x.cls });
      outlierReport.removed++;
      if (x.cls === "stale_low") outlierReport.staleLowRemoved++;
    }
    log({
      step: "validity",
      title: "مدل احتمالیِ اعتبار پیشنهادها (v2)",
      message:
        `بدنهٔ بازار ${fa(validity.ref)} | پراکندگی σ=${(validity.sigma * 100).toFixed(1)}% | رانش روزانهٔ تخمینی ${(validity.driftPerDay * 100).toFixed(2)}%±${(validity.driftSe * 100).toFixed(2)} | ` +
        `لنگر ${fa(validity.anchorPrice)} (احتمال درستی لنگر ${(validity.pAnchorOk * 100).toFixed(0)}%) | ${validity.excludedLows.length} پیشنهاد پایین‌تر از لنگر کنار گذاشته شد`,
      level: validity.anchorPrice == null ? "warn" : "info",
      data: {
        ref: validity.ref,
        sigma: validity.sigma,
        driftPerDay: validity.driftPerDay,
        driftSe: validity.driftSe,
        anchorPrice: validity.anchorPrice,
        pAnchorOk: validity.pAnchorOk,
        pNoneValid: validity.pNoneValid,
        excludedLows: validity.excludedLows.slice(0, 8),
      },
    });
  }
  log({
    step: "outliers",
    title: useValidity ? "پرت‌های سمت بالا و جمع‌بندی حذف‌ها (v2)" : "طبقه‌بندی فروشندگان پرت و غیربه‌روز (R0/R1)",
    message:
      `${outlierReport.removed} پیشنهاد مشکوک حذف شد (${outlierReport.staleLowRemoved} قیمت کهنه/مشکوک پایین، ` +
      `${outlierReport.highOutlierRemoved} گران‌فروش پرت؛ باند ${fa(outlierReport.lowerBound)} تا ${fa(outlierReport.upperBound)} تومان) ` +
      `| مرجع طبقه‌بندی ${fa(outlierReport.stableRefPrice)}؛ ${outlierReport.suspectLows.length} فروشنده‌ی مشکوک برای مغز بازار ثبت شد`,
    data: { ...outlierReport },
  });

  // ---------- 4) وزن‌دهی و تجمیع (نسخه ۴.۱: suspectLows + ceiling مستقیماً وارد بازار می‌شوند)
  const weighOffers = (arr: OfferEvaluation[]) => {
    applyRecencyWeights(arr, cfg.aggregation.recencyHalfLifeDays, now);
    if (useValidity) {
      // وزن هر پیشنهاد در آمار بازار = تازگی × شهرت × احتمال اعتبار
      for (const o of arr) if (o.included && o.pValid != null) o.weight = Math.max(0.02, Math.round(o.weight * o.pValid * 1000) / 1000);
    }
  };
  weighOffers(offers);
  const marketOpts = {
    guaranteeStrict,
    defaultCity: cfg.rank1.defaultCity,
    hardFloorPrice: supply.hardFloorPrice,
    undercutAmount: cfg.rank1.undercutAmount,
    clusterMaxGapPct: cfg.rank1.clusterMaxGapPct,
    highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
    safePercentile: cfg.sourcing.costlessSafePercentile,
    upperPercentile: cfg.discount.marketUpperPercentile,
    suspectLows: outlierReport.suspectLows,
    maxCeilingAboveMedianPct: cfg.discount.maxCeilingAboveMedianPct,
    ceilingPercentile: cfg.discount.marketUpperPercentile,
  };
  let market = summarizeMarket(offers, cfg.aggregation, marketOpts);
  const offersTruncated = source.meta?.offersTruncated === true;
  const strategyOpts = {
    skipGapRule: useValidity && est.chaseConfirmedLow,
    truncated: v2 && est.truncationAware && offersTruncated,
  };

  let isProvisional = false;
  if (isInitiallyCostless) {
    // مسیر Provisional (نسخه ۴.۱): اجماع ترب دیگر تبدیل به کف خودکار نمی‌شود؛
    // قیمت پیشنهادی = صدک پایین پول «به‌روز + معتبر» و همیشه مسیر ریویو/تایید انسان است.
    const credibleFresh = offers.filter((o) => o.included && o.fresh && o.credible && o.price > 0);
    if (credibleFresh.length >= cfg.costless.minCredibleFresh && market.reference != null) {
      const poolPrices = credibleFresh.map((o) => o.price);
      const provisional = ceilToStep(
        percentile(poolPrices, cfg.costless.provisionalPercentile),
        Math.max(1, cfg.rounding.finalStep),
      );
      strategy = "provisional_market_percentile";
      competitionTier = "provisional_market_percentile";
      target = provisional;
      isProvisional = true;
      reviewReasons.push(
        `بدون قیمت خرید و لیست همکار — قیمت Provisional (${fa(provisional)} = صدک ${cfg.costless.provisionalPercentile} از ${poolPrices.length} فروشنده به‌روز و معتبر)` +
          (cfg.costless.autoApply ? "" : " — با تایید مدیر وارد کمپین/تایید انبار می‌شود"),
      );
      log({
        step: "provisional",
        title: "مسیر بی‌هزینه Provisional (بدون تحمیلی از اجماع ترب)",
        message:
          `قیمت Provisional = صدهم ${cfg.costless.provisionalPercentile} پول به‌روز و معتبر (${poolPrices.length} عضو): ${fa(provisional)} تومان؛` +
          ` ارزان‌ترین ${fa(Math.min(...poolPrices))} و گران‌ترین ${fa(Math.max(...poolPrices))} — هیچ ادعای سود قطعی دارد نیست (review)`,
        level: "warn",
        data: { provisional, poolSize: poolPrices.length, desiredMinProfit: supply.hardFloorPrice },
      });
    } else {
      // داده کافی نیست → تصمیم واقعی تنها با استعلام مجدد/انبار ممکن است (no_data)
      target = null;
      log({
        step: "provisional",
        title: "مسیر بی‌هزینه Provisional غیرفعال",
        message: `فقط ${credibleFresh.length} فروشنده به‌روز و معتبر (حداقل لازم: ${cfg.costless.minCredibleFresh}) — بدون پیشنهاد Provisional`,
        level: "warn",
      });
    }
  }

  log({
    step: "aggregate",
    title: `تحلیل هسته بازار ترب و شهر ${cfg.rank1.defaultCity}`,
    message:
      market.count > 0
        ? `کل ترب (${market.count} معتبر): کف ${fa(market.lowest)} | میانه ${fa(market.median)} | هسته چگال (مد) ${fa(market.modalConsensus)} | مرجع ${fa(market.reference)} | سقف واقعی ${fa(market.ceiling)} | پراکندگی ${(market.dispersion * 100).toFixed(1)}% — ` +
          `بازار ${cfg.rank1.defaultCity} (${market.localCity.count} فروشنده): کف ${fa(market.localCity.lowest)} | میانه ${fa(market.localCity.median)}`
        : "هیچ پیشنهاد معتبری باقی نماند",
    level: market.count > 0 ? "info" : "warn",
    data: {
      nationalCount: market.count,
      nationalLowest: market.lowest,
      nationalModalConsensus: market.modalConsensus,
      nationalTrimmedWeightedMean: market.trimmedWeightedMean,
      nationalReference: market.reference,
      monitoredCeiling: market.ceiling,
      localCityCount: market.localCity.count,
      localCityLowest: market.localCity.lowest,
      localCityMedian: market.localCity.median,
      clusterCount: market.clusters.length,
      suspectLows: market.suspectLows,
    },
  });

  if (market.count < cfg.guards.minValidOffers) {
    reviewReasons.push(`تعداد پیشنهاد معتبر (${market.count}) کمتر از حداقل ${cfg.guards.minValidOffers}`);
  }

  // Veto «تازگی» (نسخه ۴.۱): نسبت پیشنهادهای به‌روز — رد آن همیشه review است (نه reject)
  if (market.count > 0) {
    const freshCount = offers.filter((o) => o.included && o.fresh).length;
    const freshRatio = freshCount / market.count;
    if (freshRatio < Math.max(0, cfg.guards.minFreshRatio)) {
      reviewReasons.push(
        `نسبت پیشنهادهای به‌روز (${(freshRatio * 100).toFixed(0)}%) زیر حداقل ${Math.round(cfg.guards.minFreshRatio * 100)}% — اطمینان بازار پایین است`,
      );
    }
  }


  // ---------- 5) استراتژی چندسطحی هوشمند (نسخه ۴.۱ — ladder یکپارچه)
  if (!isProvisional) {
    const strat = decideTargetPrice(market, cfg.rank1, supply, strategyOpts);
    strategy = strat.strategy;
    competitionTier = strat.competitionTier;
    target = strat.targetPrice;
    strategyExplanation = strat.explanation;
    log({
      step: "strategy",
      title: "استراتژی رقابتی و کشف کف هدف فروش",
      message: strat.explanation,
      data: { target, strategy, competitionTier },
    });
  }

  if (isProvisional) {
    strategyExplanation = `استراتژی Provisional (صدک ${cfg.costless.provisionalPercentile} از پول به‌روز و معتبر)`;
    log({
      step: "strategy",
      title: "استراتژی رقابتی و کشف کف هدف فروش",
      message: strategyExplanation,
      data: { target, strategy, competitionTier },
    });
  }

  if (target == null) {
    if (supply.effectiveCostPrice > 0) {
      const targetMargin = Math.max(supply.minMarginPctUsed, cfg.margin.targetPct);
      target = Math.max(
        supply.hardFloorPrice,
        supply.effectiveCostPrice * (1 + targetMargin / 100),
      );
      strategy = "cost_plus";
      competitionTier = "cost_plus_target";
      reviewReasons.push("بدون داده بازار؛ قیمت بر اساس تمام‌شده لیست همکاران + سود هدف تعیین شد");
      log({
        step: "fallback",
        title: "قیمت جایگزین (مبتنی بر قیمت خرید همکاران)",
        message: `قیمت = تمام‌شده تامین (${fa(supply.effectiveCostPrice)}) × (1 + ${targetMargin}%) = ${fa(target)} تومان`,
        level: "warn",
      });
    } else {
      const emptyPosition = evaluateCompetitivePosition(0, market, supply, "no_data");
      const emptyFloorCeiling = {
        monitoredSellersCount: 0,
        excludedOutliersCount: offers.length,
        monitoredMarketFloor: null,
        monitoredMarketMedian: null,
        monitoredMarketCeiling: null,
        targetFloorPrice: 0,
        ceilingBasePrice: 0,
        appliedDiscountPct: 0,
        exactFloorRestored: 0,
        discoveryModeUsed: cfg.discount.mode ?? cfg.discount.basePriceMode,
        explanation: "بدون داده کافی برای کشف کف و سقف بازار",
      };
      const emptySupervisor = evaluateSystemOneSupervisorSync({
        productName: ctx.productName,
        source,
        offers,
        supply,
        position: emptyPosition,
        floorCeiling: emptyFloorCeiling,
        identityMatchScorePct,
        selfShopInListing: selfConfirmsIdentity,
        finalPrice: null,
        basePrice: null,
        discountPct: null,
        dispersion: market.dispersion,
        config: cfg,
      });
      return {
        offers,
        offersTotal: source.offers.length,
        offersUsed: market.count,
        lowestRaw,
        lowestValid: market.lowest,
        marketMedian: market.median,
        marketMean: market.mean,
        modalConsensusPrice: market.modalConsensus,
        referencePrice: market.reference,
        supply,
        position: emptyPosition,
        floorCeiling: emptyFloorCeiling,
        supervisor: emptySupervisor,
        finalPrice: null,
        basePrice: null,
        discountPct: null,
        strategy: "no_data",
        confidence: 0,
        needsReview: true,
        rejectedBySupervisor: emptySupervisor.enabled && emptySupervisor.verdict === "reject",
        reviewReasons: [...reviewReasons, "نه داده بازار موجود است و نه قیمت خرید/تامین"],
        steps,
      };
    }
  }

  // ---------- 6) محافظ‌ها (تضمین مطلق خط قرمز قیمت خرید همکاران یا کف امن بازار)
  // جهت گرد کردن (نسخه ۴.۱): انکرهای undercut → همیشه به پایین (هرگز بالای رقیب نشویم)؛
  // بقیه (کف/Provisional) → رفتار قبلی با سقف‌گیری به بالا هنگام زیر-کف.
  const guardCtx = {
    costPrice: supply.effectiveCostPrice,
    minMarginPct: supply.minMarginPctUsed,
    minProfitAmountToman: supply.minProfitAmountUsed,
    fixedCostToman: cfg.margin.fixedCostToman,
    hardFloorPriceOverride: supply.hardFloorPrice,
    currentPrice: ctx.currentFinalPrice,
  };
  const guarded = applyGuards(target, guardCtx, cfg.guards, cfg.rounding, {
    direction: UNDERCUT_ANCHOR_STRATEGIES.has(strategy) ? "floor" : "nearest",
  });
  reviewReasons.push(...guarded.reviewReasons);

  log({
    step: "guards",
    title: "محافظ‌های سود و گرد کردن کف هدف فروش",
    message: guarded.notes.length
      ? `${guarded.notes.join(" | ")} → کف هدف قطعی فروش: ${fa(guarded.price)} تومان`
      : `تأیید خط قرمز عدم ضرر؛ کف هدف قطعی فروش گرد شد: ${fa(guarded.price)} تومان`,
    level: guarded.reviewReasons.length ? "warn" : "info",
    data: {
      finalPrice: guarded.price,
      hardFloorPrice: supply.hardFloorPrice,
      effectiveCostPrice: supply.effectiveCostPrice,
      floorEnforced: guarded.floorEnforced,
    },
  });

  const finalPrice = guarded.price;

  // ---------- 6.۰) تحلیل پایداریِ تصمیم (v2): اگر «ارزان‌ترین پیشنهاد معتبر» چیز دیگری باشد، قیمت چه می‌شد؟
  let scenarioAnalysis: ScenarioAnalysis | null = null;
  if (
    useValidity &&
    est.calibratedConfidence &&
    validity &&
    validity.sortedOffers.length > 0 &&
    validity.anchorPrice != null &&
    !isProvisional &&
    finalPrice > 0
  ) {
    const decideWith = (included: Set<OfferEvaluation>): { finalPrice: number | null; strategy: string } => {
      const clones = offers.map((o): OfferEvaluation => {
        if (!validity!.perOffer.has(o)) return { ...o };
        const inc = included.has(o);
        return { ...o, included: inc, cls: inc ? "ok" : o.cls, weight: 0 };
      });
      weighOffers(clones);
      const m = summarizeMarket(clones, cfg.aggregation, marketOpts);
      const st = decideTargetPrice(m, cfg.rank1, supply, strategyOpts);
      if (st.targetPrice == null) return { finalPrice: null, strategy: st.strategy };
      const g = applyGuards(st.targetPrice, guardCtx, cfg.guards, cfg.rounding, {
        direction: UNDERCUT_ANCHOR_STRATEGIES.has(st.strategy) ? "floor" : "nearest",
      });
      return { finalPrice: g.price, strategy: st.strategy };
    };
    scenarioAnalysis = analyzeDecisionScenarios(validity, finalPrice, (o) => !highOutlierSet.has(o), decideWith, {
      minIncludeProb: est.validity?.minIncludeProb ?? 0.15,
      ...(est.scenario ?? {}),
    });
    log({
      step: "robustness",
      title: "پایداری تصمیم نسبت به عدم‌قطعیتِ اعتبار پیشنهادها (v2)",
      message:
        `${scenarioAnalysis.scenarios.length} فرضِ محتمل برای «ارزان‌ترین پیشنهاد معتبر» اجرا شد؛ ` +
        `احتمال اینکه قیمت ${fa(finalPrice)} درست باشد (±${est.scenario?.tolerancePct ?? 2}٪): ${(scenarioAnalysis.pRight * 100).toFixed(0)}٪` +
        (scenarioAnalysis.alternative
          ? ` | محتمل‌ترین جایگزین: ${fa(scenarioAnalysis.alternative.finalPrice)} (احتمال ${(scenarioAnalysis.alternative.p * 100).toFixed(0)}٪، اگر ارزان‌ترین معتبر «${scenarioAnalysis.alternative.shopName}» با ${fa(scenarioAnalysis.alternative.lowestPrice)} باشد)`
          : ""),
      level: scenarioAnalysis.pRight >= 0.8 ? "info" : "warn",
      data: { ...scenarioAnalysis },
    });
  }

  // ---------- 6.۱) Vetoes باینری بازار (نسخه ۴.۱): تعارض ارزان‌فروش مشکوک و فروش عمیق زیر مرجع
  // legacy: فقط suspect_low | v2: هر پیشنهاد پایین‌ِ کنارگذاشته‌شده که احتمال اعتبارش معنادار است (≥ conflictMinProb)؛ آشغالِ قطعی ریویو نمی‌سازد
  const conflictOffers = offers.filter((o) =>
    est?.marketConflictByProbability && v2
      ? (o.cls === "suspect_low" || o.cls === "stale_low") && o.price < finalPrice && (o.pValid ?? 0) >= (est.conflictMinProb ?? 0.1)
      : o.cls === "suspect_low" && o.price < finalPrice,
  );
  const marketConflict = conflictOffers.length > 0 && (!scenarioAnalysis || est.conflictGateWhenCalibrated);
  if (marketConflict) {
    const summaryList = conflictOffers
      .slice(0, 3)
      .map((o) => `${o.shopName} (${o.price.toLocaleString("fa-IR")})`)
      .join("، ");
    reviewReasons.push(
      `تعارض بازار: ${conflictOffers.length} فروشنده‌ی «مشکوک پایین» زیر قیمت پیشنهادی ما قرار گرفت (${summaryList}) — بی‌دلیل نیست، نیازمند بازبینی`,
    );
    log({
      step: "market_conflict",
      title: "Veto تعارض بازار (suspect_low زیر قیمت ما)",
      message: `${conflictOffers.length} فروشنده مشکوک: ${summaryList}`,
      level: "warn",
      data: { count: conflictOffers.length, suspects: conflictOffers.map((o) => ({ shop: o.shopName, price: o.price, cls: o.cls })) },
    });
  }

  if (
    market.reference != null &&
    supply.effectiveCostPrice > 0 &&
    finalPrice < market.reference * 0.7
  ) {
    reviewReasons.push(
      `فروش عمیق زیر مرجع بازار (بیش از ۳۰٪ زیر مرجع ${fa(market.reference)}) — deep_floor، نیازمند بازبینی کف تامین`,
    );
  }

  // ---------- 7) ارزیابی جایگاه نهایی در کل ترب و در شهر مشهد
  const position = evaluateCompetitivePosition(finalPrice, market, supply, competitionTier);
  log({
    step: "position",
    title: `جایگاه رقابتی در ترب و ${cfg.rank1.defaultCity}`,
    message:
      `رتبه در ${cfg.rank1.defaultCity}: #${position.projectedLocalRank} (از ${position.totalLocalValidSellers || 1}) | ` +
      `رتبه در کل ترب: #${position.projectedNationalRank} (از ${position.totalNationalValidSellers || 1}) | ` +
      `رتبه با احتساب فروشنده‌های مشکوک/کهنه: #${position.rankIncludingSuspect ?? "-"} (از ${position.totalSellersIncludingSuspect || 1}) | ` +
      `حاشیه ایمنی/سود: ${fa(position.netProfitToman)} تومان (${position.netMarginPct}%)`,
    data: { ...position },
  });

  // ---------- 8) سقف معیار با مرجع بیرونی (own_price_7d / market_p75) و کالیبراسیون دقیق (نسخه ۴.۱)
  const disc = buildDiscount(finalPrice, offers, cfg.discount, cfg.rounding, {
    ownStableHigh7d: ctx.discountContext?.ownStableHigh7d ?? null,
    ownAvg7d: ctx.discountContext?.ownAvg7d ?? null,
    hasOwnPriceHistory: Boolean(
      ctx.discountContext?.ownStableHigh7d && ctx.discountContext.ownStableHigh7d > 0,
    ),
    ceilingOverride: market.ceiling,
  });
  const basePrice = disc.basePrice;
  if (disc.referenceKind === "none" && disc.discountPct === 0 && market.reference != null && finalPrice < market.reference) {
    reviewReasons.push(
      `مرجع معتبر تخفیف (own_price_7d / market_p75) یافت نشد؛ کف ما زیر مرجع است → گیت تخفیف نیاز به بازبینی تاریخ قیمت خودی`,
    );
  }
  log({
    step: "discount",
    title: "کشف سقف معیار با مرجع بیرونی و کالیبراسیون درصد تخفیف روی کف",
    message: disc.explanation,
    data: {
      basePrice,
      discountPct: disc.discountPct,
      referenceKind: disc.referenceKind,
      referencePrice: disc.referencePrice,
      floorConfirmed: disc.floorConfirmed,
      monitoredMarketFloor: disc.floorCeiling.monitoredMarketFloor,
      monitoredMarketCeiling: disc.floorCeiling.monitoredMarketCeiling,
      exactFloorRestored: disc.floorCeiling.exactFloorRestored,
      excludedOutliersCount: disc.floorCeiling.excludedOutliersCount,
    },
  });

  // ---------- 8.۵) امتیاز اعتماد (v2: کالیبره از تحلیل سناریوها | legacy: ترکیب ساده)
  const conf = computeConfidence(
    market,
    { totalSellerCount: source.totalSellerCount, offersTotal: source.offers.length },
    cfg,
  );
  let confidenceScore = conf.score;
  let confidenceBreakdown: Record<string, number> = { ...conf.breakdown };
  if (scenarioAnalysis) {
    // اعتمادِ کالیبره: ترکیب لوجیستیک پایداری سناریوها و کفایت داده؛ جایگزین آستانهٔ قدیمیِ «امتیاز ساده»
    confidenceScore = calibratedConfidence(est.confidenceModel, {
      pRight: scenarioAnalysis.pRight,
      heuristic: conf.score,
      pNoneValid: scenarioAnalysis.pNoneValid,
      floorBound: guarded.floorEnforced,
    });
    confidenceBreakdown = {
      ...conf.breakdown,
      heuristic: conf.score,
      pRight: Math.round(scenarioAnalysis.pRight * 1000) / 1000,
      pTooHigh: Math.round(scenarioAnalysis.pTooHigh * 1000) / 1000,
      pTooLow: Math.round(scenarioAnalysis.pTooLow * 1000) / 1000,
      calibrated: confidenceScore,
    };
    if (confidenceScore < est.minCalibratedConfidence) {
      const alt = scenarioAnalysis.alternative;
      reviewReasons.push(
        `اعتماد کالیبره ${(confidenceScore * 100).toFixed(0)}٪ کمتر از حد اعمال خودکار ${(est.minCalibratedConfidence * 100).toFixed(0)}٪` +
          (alt
            ? ` — اگر ارزان‌ترین پیشنهاد معتبر «${alt.shopName}» با ${fa(alt.lowestPrice)} باشد قیمت ${fa(alt.finalPrice)} می‌شود (احتمال ${(alt.p * 100).toFixed(0)}٪)`
            : ""),
      );
    }
  } else if (conf.score < cfg.guards.minConfidenceAutoApply) {
    reviewReasons.push(
      `اعتماد آماری ${conf.score} کمتر از حد اعمال خودکار ${cfg.guards.minConfidenceAutoApply}`,
    );
  }
  if (v2 && est.truncationAware && offersTruncated && market.count < Math.max(3, cfg.guards.minValidOffers)) {
    reviewReasons.push(
      `خروجی ترب بریده شده (offers_truncated) و فقط ${market.count} پیشنهاد معتبر دیده شد — ممکن است ارزان‌ترین معتبرها دیده نشده باشند`,
    );
  }

  // ---------- 9) ناظر بالاسر SubQ SystemOne (تصمیم‌گیری ۴ مقیاسی با قانون ۳ بازه‌ای 0..45..80..100%)
  const supervisor = evaluateSystemOneSupervisorSync({
    productName: ctx.productName,
    source,
    offers,
    supply,
    position,
    floorCeiling: disc.floorCeiling,
    identityMatchScorePct,
    selfShopInListing: selfConfirmsIdentity,
    finalPrice,
    basePrice,
    discountPct: disc.discountPct,
    dispersion: market.dispersion,
    config: cfg,
    marketScoreOverridePct: v2 && est.supervisorMarketCalibrated && scenarioAnalysis ? Math.round(confidenceScore * 100) : null,
  });

  let rejectedBySupervisor = false;
  if (supervisor.enabled) {
    if (supervisor.verdict === "reject") {
      rejectedBySupervisor = true;
      reviewReasons.push(
        `رد توسط ناظر بالاسر SystemOne (امتیاز ${supervisor.overallScorePct}% < ${supervisor.rejectBelowPct}%)`,
      );
    } else if (supervisor.verdict === "review") {
      reviewReasons.push(
        `ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${supervisor.overallScorePct}% بین ${supervisor.rejectBelowPct}% و ${supervisor.approveAbovePct}%)`,
      );
    }

    log({
      step: "supervisor",
      title: "ناظر و تصمیم‌گیرنده بالاسر (SubQ SystemOne — ۴ مقیاس)",
      message:
        `${supervisor.summary} | ` +
        Object.values(supervisor.gates)
          .map((g) => `${g.key}: ${g.scorePct}% (noul=${g.noul.toFixed(2)} → ${g.verdict})`)
          .join(" · "),
      level:
        supervisor.verdict === "reject"
          ? "error"
          : supervisor.verdict === "review"
            ? "warn"
            : "info",
      data: {
        overallScorePct: supervisor.overallScorePct,
        overallNoul: supervisor.overallNoul,
        verdict: supervisor.verdict,
        gates: supervisor.gates,
      },
    });
  }

  const needsReview =
    reviewReasons.length > 0 ||
    !source.ok ||
    supply.effectiveCostPrice <= 0 ||
    rejectedBySupervisor ||
    (supervisor.enabled && supervisor.verdict !== "approve");

  log({
    step: "decision",
    title: "نتیجه نهایی",
    message: rejectedBySupervisor
      ? `⛔ رد کامل توسط ناظر SystemOne (${supervisor.overallScorePct}% < ${supervisor.rejectBelowPct}%): داده یا قیمت شرایط ایمنی را ندارد و متوقف شد`
      : needsReview
        ? `⏳ ارسال به بخش ریویو (بازبینی): ${reviewReasons.join("؛ ")} (پیشنهاد: سقف ${fa(basePrice)} با ${disc.discountPct}% تخفیف → کف ${fa(finalPrice)} تومان)`
        : `✅ تایید ناظر SystemOne (${supervisor.overallScorePct}% ≥ ${supervisor.approveAbovePct}%) و اعمال خودکار: سقف معیار ${fa(basePrice)} با ${disc.discountPct}% تخفیف → کف قطعی ${fa(finalPrice)} تومان | ${
            isProvisional ? "قیمت Provisional بدون قیمت خرید تاییدنشده است" : `سود خالص: ${fa(position.netProfitToman)} تومان`
          }`,
    level: rejectedBySupervisor ? "error" : needsReview ? "warn" : "info",
    // ویژگی‌های کالیبراسیون (۴.۲.۰): برای بازتنظیم مدل اعتماد با برچسب واقعی (حالت سایه/ممیزی) در steps ذخیره می‌شوند
    // (scripts/export-calibration-data.cjs ← eval/market/fit-confidence.cjs --data). همگی عدد/بولی‌اند؛ هیچ قیمت خرید/کفی نیست.
    data: {
      needsReview,
      rejectedBySupervisor,
      confidence: confidenceScore,
      confidenceBreakdown,
      pNoneValid: scenarioAnalysis ? Math.round(scenarioAnalysis.pNoneValid * 1000) / 1000 : null,
      floorBound: guarded.floorEnforced,
      engineVersion: cfg.engine?.version ?? null,
    },
  });

  return {
    offers,
    offersTotal: source.offers.length,
    offersUsed: market.count,
    lowestRaw,
    lowestValid: market.lowest,
    marketMedian: market.median != null ? Math.round(market.median) : null,
    marketMean: market.mean != null ? Math.round(market.mean) : null,
    modalConsensusPrice: market.modalConsensus != null ? Math.round(market.modalConsensus) : null,
    referencePrice: market.reference != null ? Math.round(market.reference) : null,
    supply,
    position,
    floorCeiling: disc.floorCeiling,
    supervisor,
    finalPrice,
    basePrice,
    discountPct: disc.discountPct,
    discountReferenceKind: disc.referenceKind,
    discountReferencePrice: disc.referencePrice,
    floorConfirmed: disc.floorConfirmed,
    strategy,
    confidence: confidenceScore,
    needsReview,
    marketConflict,
    isProvisional,
    rejectedBySupervisor,
    reviewReasons,
    steps,
    decisionScenarios: scenarioAnalysis ?? undefined,
    confidenceBreakdown,
  };
}
