import { summarizeMarket } from "./aggregate";
import { computeConfidence } from "./confidence";
import { buildDiscount } from "./discount";
import { applyRecencyWeights, applyValidityFilters } from "./filters";
import { applyGuards } from "./guards";
import { evaluateTorobCandidate } from "./matcher";
import { removeOutliers } from "./outliers";
import { deriveSafeMarketConsensusSupply, resolveSupplyCost } from "./sourcing";
import { computeUndercutDelta, decideTargetPrice, evaluateCompetitivePosition } from "./strategy";
import { evaluateSystemOneSupervisorSync } from "./systemone-supervisor";
import type { DecisionStepLog, PricingContext, PricingResult, SourceResult } from "./types";

const fa = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("fa-IR"));

export function runPricingPipeline(source: SourceResult, ctx: PricingContext): PricingResult {
  const cfg = ctx.config;
  const now = ctx.now ?? new Date();
  const steps: DecisionStepLog[] = [];
  const reviewReasons: string[] = [];

  const log = (s: DecisionStepLog) => steps.push(s);

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

  if (source.productTitle && ctx.productName) {
    const idRej = cfg.supervisor?.gates?.identity_match?.rejectBelowPct ?? cfg.supervisor?.rejectBelowPct ?? 45;
    const idApp = cfg.supervisor?.gates?.identity_match?.approveAbovePct ?? cfg.supervisor?.approveAbovePct ?? 80;

    const identityCheck = evaluateTorobCandidate(
      {
        productName: ctx.productName,
        anchorPriceToman: supply.effectiveCostPrice > 0 ? supply.effectiveCostPrice : ctx.currentFinalPrice,
        rejectBelowPct: idRej,
        approveAbovePct: idApp,
      },
      {
        prk: source.prk ?? "manual",
        titleFa: source.productTitle,
        sellerCount: source.totalSellerCount,
        available: true,
      },
      cfg.filters.minSellerCount,
    );

    identityMatchScorePct = selfShopInListing ? Math.max(95, identityCheck.score) : identityCheck.score;

    if (identityCheck.verdict === "reject" && !selfShopInListing) {
      reviewReasons.push(`رد در گیت ورودی هویت کالا (${identityCheck.score}% < ${idRej}%): ${identityCheck.rejectReason}`);
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message: `رد شد (امتیاز ${identityCheck.score}% / noul=${identityCheck.noul.toFixed(2)} < ${idRej}%): «${source.productTitle}» در برابر «${ctx.productName}» — ${identityCheck.rejectReason}`,
        level: "error",
        data: { score: identityCheck.score, noul: identityCheck.noul, verdict: identityCheck.verdict },
      });
    } else if (identityCheck.verdict === "review" && !selfShopInListing) {
      reviewReasons.push(`امتیاز تطابق هویت کالا در بازه ریویو (${identityCheck.score}% بین ${idRej}% و ${idApp}%)`);
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message: `ارسال به بخش ریویو (امتیاز ${identityCheck.score}% / noul=${identityCheck.noul.toFixed(2)} در بازه ${idRej}%..${idApp}%): «${source.productTitle}»`,
        level: "warn",
        data: { score: identityCheck.score, noul: identityCheck.noul, verdict: identityCheck.verdict },
      });
    } else {
      log({
        step: "identity",
        title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
        message:
          `تایید خودکار ورودی با امتیاز ${identityMatchScorePct}% (noul=${(identityMatchScorePct / 100).toFixed(2)} ≥ ${idApp}%)` +
          (selfShopInListing ? " + تأیید متقاطع ۱۰۰٪ (حضور فروشگاه خودمان در همین لیستینگ ادغام‌شده ترب)" : "") +
          (identityCheck.notes.length ? ` · ${identityCheck.notes.join(" · ")}` : ""),
        level: "info",
        data: { score: identityMatchScorePct, noul: identityMatchScorePct / 100, verdict: "approve", selfShopInListing },
      });
    }
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
  const offers = applyValidityFilters(source.offers, cfg.filters, now, cfg.rank1);
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

  // ---------- 3) حذف هوشمند داده‌های پرت و فروشندگان غیربه‌روز
  const outlierReport = removeOutliers(offers, cfg.outliers, {
    isCostlessMode: isInitiallyCostless,
    now,
  });
  log({
    step: "outliers",
    title: "حذف فروشندگان پرت و غیربه‌روز",
    message:
      `${outlierReport.removed} پیشنهاد پرت حذف شد (${outlierReport.staleLowRemoved} ارزان‌فروش مشکوک به عدم آپدیت، ` +
      `${outlierReport.highOutlierRemoved} گران‌فروش پرت؛ بازه مجاز ${fa(outlierReport.lowerBound)} تا ${fa(outlierReport.upperBound)} تومان)`,
    data: { ...outlierReport },
  });

  // ---------- 4) وزن‌دهی و تجمیع اولیه + کشف کف امن در صورت نبودن لیست همکار
  applyRecencyWeights(offers, cfg.aggregation.recencyHalfLifeDays, now);
  let market = summarizeMarket(offers, cfg.aggregation, {
    defaultCity: cfg.rank1.defaultCity,
    hardFloorPrice: supply.hardFloorPrice,
    undercutAmount: cfg.rank1.undercutAmount,
    clusterMaxGapPct: cfg.rank1.clusterMaxGapPct,
    highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
    safePercentile: cfg.sourcing.costlessSafePercentile,
    upperPercentile: cfg.discount.marketUpperPercentile,
  });

  if (isInitiallyCostless) {
    supply = deriveSafeMarketConsensusSupply(supply, market, cfg, source.priceTrend);
    for (const w of supply.warnings) {
      reviewReasons.push(w);
    }
    log({
      step: "sourcing",
      title: "کشف هوشمند کف امن و قیمت معیار از ترب (بدون لیست خرید)",
      message: supply.explanation,
      level: supply.effectiveCostPrice > 0 && supply.warnings.length === 0 ? "info" : "warn",
      data: {
        costSource: supply.costSource,
        effectiveCostPrice: supply.effectiveCostPrice,
        hardFloorPrice: supply.hardFloorPrice,
        modalConsensus: market.modalConsensus,
        trimmedWeightedMean: market.trimmedWeightedMean,
        safePercentilePrice: market.safePercentilePrice,
      },
    });

    if (supply.hardFloorPrice > 0) {
      market = summarizeMarket(offers, cfg.aggregation, {
        defaultCity: cfg.rank1.defaultCity,
        hardFloorPrice: supply.hardFloorPrice,
        undercutAmount: cfg.rank1.undercutAmount,
        clusterMaxGapPct: cfg.rank1.clusterMaxGapPct,
        highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
        safePercentile: cfg.sourcing.costlessSafePercentile,
        upperPercentile: cfg.discount.marketUpperPercentile,
      });
    }
  }

  log({
    step: "aggregate",
    title: `تحلیل هسته بازار ترب و شهر ${cfg.rank1.defaultCity}`,
    message:
      market.count > 0
        ? `کل ترب (${market.count} معتبر): کف ${fa(market.lowest)} | میانه ${fa(market.median)} | هسته چگال (مد) ${fa(market.modalConsensus)} | مرجع ${fa(market.reference)} | پراکندگی ${(market.dispersion * 100).toFixed(1)}% — ` +
          `بازار ${cfg.rank1.defaultCity} (${market.localCity.count} فروشنده): کف ${fa(market.localCity.lowest)} | میانه ${fa(market.localCity.median)}`
        : "هیچ پیشنهاد معتبری باقی نماند",
    level: market.count > 0 ? "info" : "warn",
    data: {
      nationalCount: market.count,
      nationalLowest: market.lowest,
      nationalModalConsensus: market.modalConsensus,
      nationalTrimmedWeightedMean: market.trimmedWeightedMean,
      nationalReference: market.reference,
      localCityCount: market.localCity.count,
      localCityLowest: market.localCity.lowest,
      localCityMedian: market.localCity.median,
      clusterCount: market.clusters.length,
    },
  });

  if (market.count < cfg.guards.minValidOffers) {
    reviewReasons.push(`تعداد پیشنهاد معتبر (${market.count}) کمتر از حداقل ${cfg.guards.minValidOffers}`);
  }

  // ---------- 5) استراتژی چندسطحی هوشمند
  const strat = decideTargetPrice(market, cfg.rank1, supply);
  let strategy: string = strat.strategy;
  let competitionTier = strat.competitionTier;
  let target = strat.targetPrice;

  if (
    target != null &&
    !supply.usedMarketConsensusFloor &&
    source.priceTrend?.direction === "falling" &&
    supply.hardFloorPrice > 0 &&
    target > supply.hardFloorPrice
  ) {
    const undercut = computeUndercutDelta(target, cfg.rank1);
    const trendAdjusted = Math.max(supply.hardFloorPrice, target - undercut);
    if (trendAdjusted < target) {
      target = trendAdjusted;
      strat.explanation += ` (تعدیل نزولی هوشمند به دلیل روند کاهشی نمودار قیمت ترب: ${fa(target)} تومان)`;
    }
  }

  log({
    step: "strategy",
    title: "استراتژی رقابتی و کشف کف هدف فروش",
    message: strat.explanation,
    data: { target, strategy, competitionTier },
  });

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
        selfShopInListing,
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
        // فقط وقتی ناظر بالاسر فعال است و خودش رد کرده، «رد توسط ناظر» ثبت می‌شود؛
        // در غیر این صورت این مورد در دسته «ناموفق/بدون داده» می‌ماند و به‌عنوان رد ناظر نمایش داده نمی‌شود.
        rejectedBySupervisor: emptySupervisor.enabled && emptySupervisor.verdict === "reject",
        reviewReasons: [...reviewReasons, "نه داده بازار موجود است و نه قیمت خرید/تامین"],
        steps,
      };
    }
  }

  // ---------- 6) محافظ‌ها (تضمین مطلق خط قرمز قیمت خرید همکاران یا کف امن بازار)
  const guarded = applyGuards(
    target,
    {
      costPrice: supply.effectiveCostPrice,
      minMarginPct: supply.minMarginPctUsed,
      minProfitAmountToman: supply.minProfitAmountUsed,
      fixedCostToman: cfg.margin.fixedCostToman,
      hardFloorPriceOverride: supply.hardFloorPrice,
      currentPrice: ctx.currentFinalPrice,
    },
    cfg.guards,
    cfg.rounding,
  );
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

  // ---------- 7) ارزیابی جایگاه نهایی در کل ترب و در شهر مشهد
  const position = evaluateCompetitivePosition(finalPrice, market, supply, competitionTier);
  log({
    step: "position",
    title: `جایگاه رقابتی در ترب و ${cfg.rank1.defaultCity}`,
    message:
      `رتبه در ${cfg.rank1.defaultCity}: #${position.projectedLocalRank} (از ${position.totalLocalValidSellers || 1}) | ` +
      `رتبه در کل ترب: #${position.projectedNationalRank} (از ${position.totalNationalValidSellers || 1}) | ` +
      `حاشیه ایمنی/سود: ${fa(position.netProfitToman)} تومان (${position.netMarginPct}%)`,
    data: { ...position },
  });

  // ---------- 8) کشف اصولی «سقف واقعی بازار» (معیار تخفیف) و اعمال درصد تخفیف روی کف
  const disc = buildDiscount(finalPrice, offers, cfg.discount, cfg.rounding);
  const basePrice = disc.basePrice;
  log({
    step: "discount",
    title: "کشف سقف واقعی بازار (معیار تخفیف) و کالیبراسیون درصد تخفیف روی کف",
    message: disc.explanation,
    data: {
      basePrice,
      discountPct: disc.discountPct,
      monitoredMarketFloor: disc.floorCeiling.monitoredMarketFloor,
      monitoredMarketCeiling: disc.floorCeiling.monitoredMarketCeiling,
      exactFloorRestored: disc.floorCeiling.exactFloorRestored,
      excludedOutliersCount: disc.floorCeiling.excludedOutliersCount,
    },
  });

  // ---------- 9) ناظر بالاسر SubQ SystemOne (تصمیم‌گیری ۴ مقیاسی با قانون ۳ بازه‌ای 0..45..80..100%)
  const supervisor = evaluateSystemOneSupervisorSync({
    productName: ctx.productName,
    source,
    offers,
    supply,
    position,
    floorCeiling: disc.floorCeiling,
    identityMatchScorePct,
    selfShopInListing,
    finalPrice,
    basePrice,
    discountPct: disc.discountPct,
    dispersion: market.dispersion,
    config: cfg,
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

  // ---------- 10) امتیاز اعتماد آماری
  const conf = computeConfidence(
    market,
    { totalSellerCount: source.totalSellerCount, offersTotal: source.offers.length },
    cfg,
  );
  if (conf.score < cfg.guards.minConfidenceAutoApply) {
    reviewReasons.push(
      `اعتماد آماری ${conf.score} کمتر از حد اعمال خودکار ${cfg.guards.minConfidenceAutoApply}`,
    );
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
            supply.usedMarketConsensusFloor ? "بر اساس اجماع به‌روز بازار ترب (بدون ضرر)" : `سود خالص: ${fa(position.netProfitToman)} تومان`
          }`,
    level: rejectedBySupervisor ? "error" : needsReview ? "warn" : "info",
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
    strategy,
    confidence: conf.score,
    needsReview,
    rejectedBySupervisor,
    reviewReasons,
    steps,
  };
}
