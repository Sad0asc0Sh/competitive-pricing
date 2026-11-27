"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPricingPipeline = runPricingPipeline;
const listing_1 = require("./listing");
const aggregate_1 = require("./aggregate");
const confidence_1 = require("./confidence");
const discount_1 = require("./discount");
const filters_1 = require("./filters");
const guards_1 = require("./guards");
const matcher_1 = require("./matcher");
const own_shop_1 = require("./own-shop");
const liquidation_1 = require("./liquidation");
const outliers_1 = require("./outliers");
const sourcing_1 = require("./sourcing");
const strategy_1 = require("./strategy");
const stats_1 = require("./stats");
const validity_1 = require("./validity");
const robustness_1 = require("./robustness");
const systemone_supervisor_1 = require("./systemone-supervisor");
const fa = (n) => (n == null ? "-" : Math.round(n).toLocaleString("fa-IR"));
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
function runPricingPipeline(source, ctx) {
    const cfg = ctx.config;
    const ownShopMatcher = (0, own_shop_1.makeOwnShopMatcher)(cfg.filters.ownShopNames, cfg.filters.ownShopIds);
    const now = ctx.now ?? new Date();
    const steps = [];
    const reviewReasons = [];
    const log = (s) => steps.push(s);
    // تخمین‌گر نسخه ۲ (هر پرچم جداگانه قابل‌خاموش‌کردن است؛ mode="legacy" رفتار ۴.۱.۲ را برمی‌گرداند)
    const est = cfg.estimator;
    const v2 = est?.mode === "v2";
    const useValidity = v2 && est.validityModel;
    const softStaleness = useValidity && est.softStaleness;
    const guaranteeStrict = v2 && est.guaranteeFix;
    let strategy = "";
    let competitionTier = "no_data";
    let target = null;
    let strategyExplanation = "";
    // ---------- 0) بررسی اولیه قیمت خرید و تامین از لیست همکاران
    let supply = (0, sourcing_1.resolveSupplyCost)({
        supplierQuotes: ctx.supplierQuotes,
        manualCostPrice: ctx.costPrice,
        inventoryCost: ctx.inventoryCost,
        replacementCost: ctx.replacementCost,
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
    const isSourceChallenged = Boolean(source.isChallenged ||
        source.sourceStatus === "challenged" ||
        source.meta?.isChallenged ||
        source.meta?.challenged);
    const isSourceDegraded = Boolean(source.degraded ||
        source.sourceStatus === "degraded" ||
        source.sourceStatus === "error" ||
        source.meta?.degraded);
    if (isSourceChallenged) {
        reviewReasons.push("چالش امنیتی/مسدودیت در استعلام منبع (challenged) — نیازمند بازبینی دستی");
    }
    if (isSourceDegraded) {
        reviewReasons.push("داده منبع در وضعیت تنزل‌یافته یا ناقص (degraded) دریافت شد — نیازمند بازبینی دستی");
    }
    if (Array.isArray(source.errors) && source.errors.length > 0) {
        for (const errMsg of source.errors) {
            if (typeof errMsg === "string" && errMsg.trim()) {
                reviewReasons.push(`خطای منبع: ${errMsg.trim()}`);
            }
        }
    }
    log({
        step: "source",
        title: "استعلام منبع (ترب)",
        message: source.ok
            ? `${source.offers.length} پیشنهاد از «${source.source}» دریافت شد (${source.totalSellerCount} فروشنده در لیستینگ)`
            : `خطا در استعلام: ${source.error ?? "نامشخص"}`,
        level: source.ok && !isSourceChallenged && !isSourceDegraded ? "info" : "error",
        data: {
            totalSellerCount: source.totalSellerCount,
            productTitle: source.productTitle,
            productTitleEn: source.productTitleEn,
            prk: source.prk,
            via: source.meta?.via,
            panels: source.ok && source.source === "torob" && source.prk
                ? source.meta?.panels ?? [(0, listing_1.listingPanel)(source.prk, source.offers, source.totalSellerCount)]
                : [],
            sourceStatus: source.sourceStatus ?? (source.ok ? "ok" : "error"),
            isChallenged: isSourceChallenged,
            degraded: isSourceDegraded,
        },
    });
    // ۴.۲.۱: همان تشخیص‌دهندهٔ فیلتر (کلید فشرده) — قبلاً اینجا مقایسهٔ خام و در فیلتر مقایسهٔ نرمال‌شده بود و ناهم‌خوان بودند
    const identityAssessed = source.torob?.offerIdentityEvaluated === true;
    const identityConfirmed = source.offers.filter((offer) => offer.torobIdentity
        ? offer.torobIdentity.status === "MATCH_CONFIRMED" : !identityAssessed);
    const externalIdentityConfirmed = identityConfirmed.filter((o) => !ownShopMatcher({ shopName: o.shopName, shopId: o.shopId }));
    const confirmedSet = new Set(identityConfirmed);
    const marketSource = identityAssessed
        ? {
            ...source,
            offers: externalIdentityConfirmed,
            totalSellerCount: (0, listing_1.distinctSellerCount)(externalIdentityConfirmed),
        }
        : source;
    const selfShopInListing = identityConfirmed.some((o) => ownShopMatcher({ shopName: o.shopName, shopId: o.shopId }));
    let identityMatchScorePct = 92;
    // آیا حضور فروشگاه خودمان به‌عنوان «تأیید متقاطع هویت» پذیرفته می‌شود؟ (پیش‌فرض بله؛ تضاد هویتی آن را باطل می‌کند)
    let selfConfirmsIdentity = selfShopInListing;
    if (source.torob) {
        identityMatchScorePct = source.torob.identityScore ?? 0;
        selfConfirmsIdentity = false;
        log({
            step: "identity",
            title: "گیت تطابق هویت کارت ترب",
            message: source.torob.reason,
            level: source.torob.status === "MATCH_CONFIRMED" ? "info" : source.torob.status === "IDENTITY_MISMATCH" ? "error" : "warn",
            data: {
                status: source.torob.identityStatus ?? source.torob.status,
                score: source.torob.identityScore ?? null,
                titleState: source.torob.selected?.titleState,
                titleOrigin: source.torob.titleOrigin,
                adminConfirmed: source.torob.adminConfirmed,
            },
        });
    }
    else if ((source.productTitle || source.productTitleEn) && ctx.productName) {
        const idRej = cfg.supervisor?.gates?.identity_match?.rejectBelowPct ?? cfg.supervisor?.rejectBelowPct ?? 45;
        const idApp = cfg.supervisor?.gates?.identity_match?.approveAbovePct ?? cfg.supervisor?.approveAbovePct ?? 80;
        // قیمت نمایندهٔ کارت (میانهٔ قیمت‌های مثبت) برای قید نسبت قیمتی «لوازم جانبی/پک/مدل بالاتر» در تطبیق‌دهنده
        const cardPrices = source.offers.map((o) => o.price).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
        const cardRepresentativePrice = cardPrices.length ? cardPrices[Math.floor((cardPrices.length - 1) / 2)] : null;
        const identityCheck = (0, matcher_1.evaluateTorobCandidate)({
            productName: ctx.productName,
            sku: ctx.sku,
            anchorPriceToman: supply.effectiveCostPrice > 0 ? supply.effectiveCostPrice : ctx.currentFinalPrice,
            rejectBelowPct: idRej,
            approveAbovePct: idApp,
        }, {
            prk: source.prk ?? "manual",
            titleFa: source.productTitle ?? "",
            titleEn: source.productTitleEn ?? null,
            priceToman: cardRepresentativePrice,
            sellerCount: source.totalSellerCount,
            available: true,
        }, cfg.filters.minSellerCount);
        // حضور فروشگاه خودمان در لیستینگ «ابهام» را برطرف می‌کند (review → approve) ولی هرگز «رد قطعیِ هویتی»
        // (کد مدل متفاوت، لوازم جانبی، پک، دست‌دوم، تضاد مشخصات) را نمی‌پوشاند: در آن حالت یا ترب کارت را اشتباه
        // ادغام کرده یا عنوان محصول ما نادرست است، و هر دو نیازمند بازبینی انسانی‌اند (اندازه‌گیری: eval/market، سناریوی wrongself).
        // رابطهٔ «نسخهٔ متفاوت» (پسوند اضافه/کم، هم‌خانواده) یعنی شواهدِ محصول دیگر؛ نه فقط کمبود اطلاعات
        const variantRelations = new Set(["ext_seg", "ext_chars", "sibling"]);
        const aiIdCheck = source.meta?.aiIdentityCheck ?? undefined;
        if (aiIdCheck) {
            log({
                step: "ai_identity",
                title: "تطبیق پنل‌های ادغام ترب با هوش مصنوعی",
                message: aiIdCheck.verdict === "match"
                    ? `تایید پنل ادغام (${aiIdCheck.matchedPrks.length || 1} پنل مرتبط): ${aiIdCheck.reasoning}`
                    : aiIdCheck.verdict === "no_match"
                        ? `عدم تطابق پنل ترب با محصول سایت: ${aiIdCheck.reasoning}`
                        : `نتیجهٔ مبهم در بررسی پنل ترب: ${aiIdCheck.reasoning}`,
                level: aiIdCheck.verdict === "no_match" ? "error" : aiIdCheck.verdict === "uncertain" ? "warn" : "info",
                data: { ...aiIdCheck, mergedPanelPrks: source.meta?.mergedPanelPrks ?? null },
            });
        }
        const hardIdentityReject = aiIdCheck?.verdict === "no_match" ||
            (identityCheck.verdict === "reject" && !ctx.torobUrlManual);
        const manualLinkOverrodeReject = Boolean(ctx.torobUrlManual) &&
            identityCheck.verdict === "reject" &&
            aiIdCheck?.verdict !== "no_match";
        const variantConflict = Boolean(identityCheck.codeRelation && variantRelations.has(identityCheck.codeRelation));
        const aiConfirmsAmbiguous = aiIdCheck?.verdict === "match" && identityCheck.verdict === "review" && !variantConflict;
        const selfConfirms = selfShopInListing && !hardIdentityReject && !variantConflict && !manualLinkOverrodeReject;
        selfConfirmsIdentity = selfConfirms;
        identityMatchScorePct =
            aiIdCheck?.verdict === "no_match"
                ? Math.min(identityCheck.score, 25)
                : manualLinkOverrodeReject
                    ? Math.max(identityCheck.score, idRej + 5)
                    : selfConfirms
                        ? Math.max(95, identityCheck.score)
                        : aiConfirmsAmbiguous
                            ? Math.max(88, identityCheck.score)
                            : identityCheck.score;
        if (hardIdentityReject) {
            const rejWhy = aiIdCheck?.verdict === "no_match"
                ? `رد پنل توسط هوش مصنوعی: ${aiIdCheck.reasoning}`
                : identityCheck.rejectReason;
            reviewReasons.push(selfShopInListing
                ? `رد در گیت ورودی هویت کالا (${identityMatchScorePct}% < ${idRej}%) با وجود حضور فروشگاه خودمان در لیستینگ — ترب کارت را احتمالاً اشتباه ادغام کرده یا عنوان محصول ما نادرست است: ${rejWhy}`
                : `رد در گیت ورودی هویت کالا (${identityMatchScorePct}% < ${idRej}%): ${rejWhy}`);
            log({
                step: "identity",
                title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
                message: `رد شد (امتیاز ${identityMatchScorePct}% / noul=${(identityMatchScorePct / 100).toFixed(2)} < ${idRej}%): «${source.productTitle}» در برابر «${ctx.productName}» — ${rejWhy}${selfShopInListing ? " — حضور فروشگاه خودمان در لیستینگ، رد هویتی را نمی‌پوشاند" : ""}`,
                level: "error",
                data: { score: identityMatchScorePct, noul: identityMatchScorePct / 100, verdict: "reject", selfShopInListing, codeRelation: identityCheck.codeRelation ?? null },
            });
        }
        else if (manualLinkOverrodeReject) {
            reviewReasons.push(`هشدار اختلاف عنوان/قیمت با لینک دستی ترب (${identityCheck.score}% — ${identityCheck.rejectReason ?? "اختلاف مشخصات"}): چون لینک ترب توسط شما ثبت شده، کارت در پنل قیمت‌گذاری برای بررسی باز ماند`);
            log({
                step: "identity",
                title: "گیت ۱ (ورودی): هشدار تطابق روی لینک دستی ترب",
                message: `امتیاز تطابق خودکار ${identityCheck.score}% بود (${identityCheck.rejectReason ?? "اختلاف عنوان/مشخصات"})؛ به‌دلیل ثبت دستی لینک ترب، به‌جای رد کامل با امتیاز ${identityMatchScorePct}% به پنل قیمت‌گذاری هدایت شد`,
                level: "warn",
                data: { score: identityMatchScorePct, rawScore: identityCheck.score, verdict: "review", manualLinkOverride: true, codeRelation: identityCheck.codeRelation ?? null },
            });
        }
        else if (identityCheck.verdict === "review" && !selfConfirms && !aiConfirmsAmbiguous) {
            reviewReasons.push(`امتیاز تطابق هویت کالا در بازه ریویو (${identityCheck.score}% بین ${idRej}% و ${idApp}%)` +
                (identityCheck.blockers?.length ? ` — ${identityCheck.blockers[0]}` : ""));
            log({
                step: "identity",
                title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
                message: `ارسال به بخش ریویو (امتیاز ${identityCheck.score}% / noul=${identityCheck.noul.toFixed(2)} در بازه ${idRej}%..${idApp}%): «${source.productTitle}»${identityCheck.blockers?.length ? ` — ${identityCheck.blockers.join(" · ")}` : ""}`,
                level: "warn",
                data: { score: identityCheck.score, noul: identityCheck.noul, verdict: identityCheck.verdict, codeRelation: identityCheck.codeRelation ?? null, blockers: identityCheck.blockers ?? [] },
            });
        }
        else {
            log({
                step: "identity",
                title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
                message: `تایید خودکار ورودی با امتیاز ${identityMatchScorePct}% (noul=${(identityMatchScorePct / 100).toFixed(2)} ≥ ${idApp}%)` +
                    (selfConfirms ? " + تأیید متقاطع (حضور فروشگاه خودمان در همین لیستینگ ادغام‌شده ترب)" : "") +
                    (aiConfirmsAmbiguous ? " + تایید تطبیق پنل ادغام توسط هوش مصنوعی" : "") +
                    (identityCheck.notes.length ? ` · ${identityCheck.notes.join(" · ")}` : ""),
                level: "info",
                data: { score: identityMatchScorePct, noul: identityMatchScorePct / 100, verdict: "approve", selfShopInListing, codeRelation: identityCheck.codeRelation ?? null },
            });
        }
    }
    // P0-7: اگر عنوان کارت ترب غایب بود (fail-closed) تطابق هویت هرگز بالای ۷۰٪ نمی‌رود
    if (!source.torob && !source.productTitle && !source.productTitleEn) {
        identityMatchScorePct = Math.min(identityMatchScorePct, 70);
        if (!selfShopInListing) {
            reviewReasons.push("عنوان کارت ترب دریافت نشد — تطابق هویت نیاز به بازبینی در صف (قفل PRK تنها با تایید هویت باز می‌شود)");
        }
        log({
            step: "identity",
            title: "گیت ۱ (ورودی): راستی‌آزمایی هویت کالا با ناظر SystemOne",
            message: `عنوان کارت ترب غایب بود → سقف تطابق هویت ${identityMatchScorePct}% (fail-closed ≤ ۷۰%)` +
                (selfShopInListing ? " — با اعتبار حضور فروشگاه خودمان در لیستینگ، مسیر ریویو رد شد" : " — ارسال به ریویو برای تطابق دستی مدیر"),
            level: "warn",
            data: { score: identityMatchScorePct, titleMissing: true, selfShopInListing },
        });
    }
    const sellerCount = source.torob ? source.torob.reportedSellers
        : (0, listing_1.listingPanel)(source.prk ?? "", source.offers, source.totalSellerCount).sellerCount;
    const ownOnly = source.ok && !isSourceChallenged && !isSourceDegraded &&
        source.sourceStatus !== "truncated" &&
        (source.torob ? Boolean(source.torob.ownStoreOnlyOnPrimary) || (sellerCount === 1 && externalIdentityConfirmed.length === 0) : sellerCount === 1) &&
        selfShopInListing &&
        externalIdentityConfirmed.length === 0 &&
        identityConfirmed.some(o => o.price > 0 && o.inStock !== false && !o.isAd && !o.priceUnreliable) &&
        !source.isTruncated && !source.meta?.isTruncated && !source.meta?.offersTruncated;
    log({
        step: "listing",
        title: "فروشندگان پنل ترب",
        message: ownOnly ? "تنها فروشندهٔ مشاهده‌شده فروشگاه خودمان است"
            : sellerCount === 1 ? "پنل تک‌فروشنده؛ قیمت بازار به یک فروشگاه وابسته است"
                : sellerCount ? `در پنل‌های بررسی‌شده ${fa(sellerCount)} فروشنده گزارش شده است` : "تعداد فروشندگان مشخص نیست",
        data: { sellerCount, ownOnly, extractedOffers: source.offers.length },
    });
    // ---------- 2) فیلترهای اعتبار داده + تفکیک شهر پیش‌فرض (مشهد)
    const canValidateOffers = !source.torob || source.torob.status === "MATCH_CONFIRMED" || source.torob.status === "NO_VALID_OFFERS";
    const offers = (canValidateOffers ? (0, filters_1.applyValidityFilters)(source.offers, cfg.filters, now, cfg.rank1, softStaleness ? { softStaleness: true, hardMaxAgeDays: est.hardMaxOfferAgeDays } : undefined) : source.offers.map((offer) => ({ ...offer, included: false, weight: 0, excludeReason: source.torob?.reason })))
        .map((offer, index) => confirmedSet.has(source.offers[index]) ? offer : {
        ...offer, included: false, weight: 0,
        excludeReason: offer.torobIdentity?.reason ?? "هویت مستقل پیشنهاد فروشنده احراز نشده است",
    });
    const marketOffers = identityAssessed ? offers.filter((_, index) => confirmedSet.has(source.offers[index])) : offers;
    const excludedByFilter = offers.filter((o) => !o.included);
    const localValidBeforeOutlier = offers.filter((o) => o.included && o.isLocalCity).length;
    const reasonCounts = {};
    for (const o of excludedByFilter) {
        reasonCounts[o.excludeReason ?? "?"] = (reasonCounts[o.excludeReason ?? "?"] ?? 0) + 1;
    }
    log({
        step: "filters",
        title: "فیلتر اعتبار داده و تفکیک جغرافیایی",
        message: !canValidateOffers ? "پیشنهادهای مشاهده‌شده تا تعیین وضعیت کارت وارد فیلترهای قیمت‌گذاری نشدند" :
            `${excludedByFilter.length} پیشنهاد نامعتبر حذف شد (${Object.entries(reasonCounts)
                .map(([k, v]) => `${k}: ${v}`)
                .join("، ") || "هیچ"})؛ ` +
                `${offers.length - excludedByFilter.length} پیشنهاد معتبر باقی ماند (${localValidBeforeOutlier} فروشنده در ${cfg.rank1.defaultCity})`,
        data: { ...reasonCounts, localValidBeforeOutlier: canValidateOffers ? localValidBeforeOutlier : null },
    });
    // ۴.۲.۱ — گارد «پژواک قیمت خودی»: اگر ارزان‌ترین پیشنهاد معتبر دقیقاً برابر قیمت‌های اخیرِ خودمان باشد، احتمالاً
    // پیشنهاد خودمان با نام ناشناخته است؛ undercut زیر آن در هر اجرا یک پله پایین‌تر می‌آید (مسابقهٔ کاهشی با خودمان).
    const echo = (0, own_shop_1.detectOwnPriceEcho)(offers, ctx.ownRecentPrices);
    if (echo.cheapestIsEcho) {
        reviewReasons.push(`ارزان‌ترین پیشنهاد معتبر (${fa(echo.cheapestPrice)}) دقیقاً برابر قیمت اخیر خودمان است — احتمال پیشنهاد خودی با نام ناشناخته (${echo.shopNames.join("، ")}); اعمال خودکار متوقف شد. اگر این فروشگاه خودِ ماست، نام یا شناسهٔ آن را در «نام فروشگاه خودمان» اضافه کنید`);
        log({
            step: "self_echo",
            title: "گارد پژواک قیمت خودی",
            message: `ارزان‌ترین پیشنهاد (${fa(echo.cheapestPrice)}) با قیمت اخیر خودمان یکی است؛ فروشگاه(ها): ${echo.shopNames.join("، ")}`,
            level: "warn",
            data: { cheapestPrice: echo.cheapestPrice, shopNames: echo.shopNames },
        });
    }
    const positiveRawPrices = identityConfirmed
        .map((o) => o.price)
        .filter((p) => Number.isFinite(p) && p > 0);
    const lowestRaw = positiveRawPrices.length ? Math.min(...positiveRawPrices) : null;
    // ---------- 3) طبقه‌بندی هوشمند داده‌های پرت و فروشندگان غیربه‌روز
    //  legacy: R0/R1 (نسخه ۴.۱) | v2: مدل احتمالیِ اعتبار برای سمت پایین + باند/IQR فقط برای سمت بالا
    let validity = null;
    if (useValidity) {
        validity = (0, validity_1.assessValidity)(offers, now, {
            params: est.validity && Object.keys(est.validity).length > 0 ? est.validity : est.validityParams,
            freshCutoffDays: cfg.outliers.freshCutoffDays,
            highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
            competitivenessCostRatio: est.competitivenessCostRatio,
        });
        for (const [o, v] of validity.perOffer) {
            o.pValid = Math.round(v.p * 1000) / 1000;
            o.ageDays = v.ageDays != null ? Math.round(v.ageDays * 100) / 100 : null;
        }
    }
    const outlierReport = (0, outliers_1.removeOutliers)(offers, cfg.outliers, {
        isCostlessMode: isInitiallyCostless,
        now,
        highTrustScoreThreshold: cfg.rank1.highTrustScoreThreshold,
        highSideOnly: useValidity,
    });
    // پیشنهادهایی که مدل اعتبار نگه داشت ولی پرتِ سمت بالا شدند؛ در هیچ فرضِ سناریویی وارد بازار نمی‌شوند
    const validityExcluded = new Set(validity?.excludedOffers ?? []);
    const highOutlierSet = new Set();
    if (validity)
        for (const o of validity.perOffer.keys())
            if (!o.included && !validityExcluded.has(o))
                highOutlierSet.add(o);
    if (validity) {
        for (const x of validity.excludedLows) {
            outlierReport.suspectLows.push({ price: x.price, shopName: x.shopName, cls: x.cls });
            outlierReport.removed++;
            if (x.cls === "stale_low")
                outlierReport.staleLowRemoved++;
        }
        log({
            step: "validity",
            title: "مدل احتمالیِ اعتبار پیشنهادها (v2)",
            message: `بدنهٔ بازار ${fa(validity.ref)} | پراکندگی σ=${(validity.sigma * 100).toFixed(1)}% | رانش روزانهٔ تخمینی ${(validity.driftPerDay * 100).toFixed(2)}%±${(validity.driftSe * 100).toFixed(2)} | ` +
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
        message: `${outlierReport.removed} پیشنهاد مشکوک حذف شد (${outlierReport.staleLowRemoved} قیمت کهنه/مشکوک پایین، ` +
            `${outlierReport.highOutlierRemoved} گران‌فروش پرت؛ باند ${fa(outlierReport.lowerBound)} تا ${fa(outlierReport.upperBound)} تومان) ` +
            `| مرجع طبقه‌بندی ${fa(outlierReport.stableRefPrice)}؛ ${outlierReport.suspectLows.length} فروشنده‌ی مشکوک برای مغز بازار ثبت شد`,
        data: { ...outlierReport },
    });
    // ۳.۵) فیلتر ریاضی فروشنده منفرد نقدکننده انبار / حراجی (بدون AI)
    const liquidationSet = new Set();
    if (v2 && cfg.outliers.liquidationGuard !== false) {
        const liq = (0, liquidation_1.detectIsolatedLiquidationOffers)(offers, {
            effectiveCostPrice: supply.effectiveCostPrice,
            minBodySellers: cfg.outliers.liquidationMinBodySellers ?? 4,
            stepGapPct: cfg.outliers.liquidationStepGapPct ?? 6,
            bodyGapPct: cfg.outliers.liquidationBodyGapPct ?? 8,
        });
        if (liq.excluded.length > 0) {
            for (const o of offers) {
                if (o.cls === "liquidation_low")
                    liquidationSet.add(o);
            }
            for (const x of liq.excluded) {
                outlierReport.suspectLows.push({ price: x.price, shopName: x.shopName, cls: "liquidation_low" });
                outlierReport.removed++;
            }
            log({
                step: "liquidation_guard",
                title: "فیلتر ریاضی فروشنده منفرد نقدکننده انبار / حراجی",
                message: liq.excluded
                    .map((x) => `«${x.shopName}» (${fa(x.price)} تومان — ${x.stepGapPct}٪ زیر نفر بعدی و ${x.bodyGapPct}٪ زیر میانه بازار ${fa(liq.bodyMedian)}) کنار گذاشته شد`)
                    .join("؛ "),
                level: "warn",
                data: { excluded: liq.excluded, bodyMedian: liq.bodyMedian },
            });
        }
    }
    // ---------- 4) وزن‌دهی و تجمیع (نسخه ۴.۱: suspectLows + ceiling مستقیماً وارد بازار می‌شوند)
    const weighOffers = (arr) => {
        (0, filters_1.applyRecencyWeights)(arr, cfg.aggregation.recencyHalfLifeDays, now);
        if (useValidity) {
            // وزن هر پیشنهاد در آمار بازار = تازگی × شهرت × احتمال اعتبار
            for (const o of arr)
                if (o.included && o.pValid != null)
                    o.weight = Math.max(0.02, Math.round(o.weight * o.pValid * 1000) / 1000);
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
    let market = (0, aggregate_1.summarizeMarket)(offers, cfg.aggregation, marketOpts);
    let torobInquiry;
    if (source.torob) {
        const status = source.torob.status === "MATCH_CONFIRMED" && market.count === 0 ? "NO_VALID_OFFERS" : source.torob.status;
        const reason = status !== source.torob.status
            ? "هیچ پیشنهاد بازار پس از فیلتر اعتبار و حذف داده‌های پرت باقی نماند" : source.torob.reason;
        torobInquiry = {
            status,
            reason,
            identityStatus: source.torob.identityStatus,
            extractedOffers: source.offers.length,
            validOffers: canValidateOffers ? market.count : null,
            validOnlineOffers: canValidateOffers ? offers.filter((o) => o.included && o.sellerType === "online").length : null,
            validLocalInPersonOffers: canValidateOffers ? offers.filter((o) => o.included && o.sellerType === "in_person" && o.isLocalCity).length : null,
            sellerRows: source.torob.sellerRows,
            reportedSellers: source.torob.reportedSellers,
            ...(source.torob.coverage ? { coverage: source.torob.coverage } : {}),
            ...(source.torob.panelEvidence ? { panelEvidence: source.torob.panelEvidence } : {}),
            ...(source.torob.selectedPanelPrks ? { selectedPanelPrks: source.torob.selectedPanelPrks } : {}),
            ...(source.torob.selfOnlyPanelPrks ? { selfOnlyPanelPrks: source.torob.selfOnlyPanelPrks } : {}),
            ...(source.torob.reviewPanelPrks ? { reviewPanelPrks: source.torob.reviewPanelPrks } : {}),
            ...(source.torob.rejectedPanelPrks ? { rejectedPanelPrks: source.torob.rejectedPanelPrks } : {}),
            ...(source.torob.ownStoreOnlyOnPrimary !== undefined ? { ownStoreOnlyOnPrimary: source.torob.ownStoreOnlyOnPrimary } : {}),
            ...(identityAssessed ? { offerIdentityCounts: {
                    MATCH_CONFIRMED: identityConfirmed.length,
                    REVIEW_REQUIRED: source.offers.filter((offer) => !offer.torobIdentity || offer.torobIdentity.status === "REVIEW_REQUIRED").length,
                    IDENTITY_MISMATCH: source.offers.filter((offer) => offer.torobIdentity?.status === "IDENTITY_MISMATCH").length,
                } } : {}),
        };
        log({
            step: "torob_inquiry",
            title: "نتیجه استعلام ترب",
            message: `${reason} · ${fa(source.offers.length)} پیشنهاد استخراج‌شده · ${torobInquiry.validOffers == null ? "اعتبار برای قیمت‌گذاری هنوز قابل سنجش نیست" : `${fa(torobInquiry.validOffers)} پیشنهاد معتبر`}`,
            level: status === "MATCH_CONFIRMED" ? "info" : status === "IDENTITY_MISMATCH" ? "error" : "warn",
            data: { ...torobInquiry, search: source.torob.search, candidate: source.torob.selected, titleOrigin: source.torob.titleOrigin,
                sellerTitle: source.meta?.sellerTitle, aiIdentityCheck: source.meta?.aiIdentityCheck, adminConfirmed: source.torob.adminConfirmed,
                coverage: source.torob.coverage,
                panelEvidence: source.torob.panelEvidence,
                selectedPanelPrks: source.torob.selectedPanelPrks,
                selfOnlyPanelPrks: source.torob.selfOnlyPanelPrks,
                reviewPanelPrks: source.torob.reviewPanelPrks,
                rejectedPanelPrks: source.torob.rejectedPanelPrks,
                ownStoreOnlyOnPrimary: source.torob.ownStoreOnlyOnPrimary,
                target: { name: ctx.productName, sku: ctx.sku } },
        });
    }
    const stopWithoutPrice = () => {
        const emptyPosition = (0, strategy_1.evaluateCompetitivePosition)(0, market, supply, "no_data");
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
        const supervisor = (0, systemone_supervisor_1.evaluateSystemOneSupervisorSync)({
            productName: ctx.productName, source: marketSource, offers: marketOffers, supply, position: emptyPosition, floorCeiling: emptyFloorCeiling,
            identityMatchScorePct, selfShopInListing: selfConfirmsIdentity, finalPrice: null, basePrice: null,
            discountPct: null, dispersion: market.dispersion, config: cfg, torobInquiryStatus: torobInquiry?.status,
        });
        const rejected = torobInquiry?.status === "IDENTITY_MISMATCH" || (supervisor.enabled && supervisor.verdict === "reject");
        log({
            step: "no_data",
            title: "توقف قیمت‌گذاری",
            message: torobInquiry?.reason ?? (!source.ok && source.error
                ? `داده معتبر از منبع دریافت نشد (${source.error}) و قیمت خرید همکار هم صفر است`
                : `از ${source.offers.length} پیشنهاد دریافتی، هیچ پیشنهاد معتبری باقی نماند و قیمت خرید همکار ثبت نشده است`),
            level: rejected ? "error" : "warn",
            data: { rawOffers: source.offers.length, sourceOk: source.ok, rejectedBySupervisor: rejected, status: torobInquiry?.status },
        });
        return {
            torobInquiry, offers, offersTotal: source.offers.length, offersUsed: market.count, lowestRaw,
            lowestValid: market.lowest, marketMedian: market.median, marketMean: market.mean,
            modalConsensusPrice: market.modalConsensus, referencePrice: market.reference,
            supply, position: emptyPosition, floorCeiling: emptyFloorCeiling, supervisor,
            finalPrice: null, basePrice: null, discountPct: null, strategy: "no_data", confidence: 0,
            needsReview: true, rejectedBySupervisor: rejected,
            reviewReasons: [...reviewReasons, torobInquiry?.reason ?? "نه داده بازار موجود است و نه قیمت خرید/تامین"], steps,
        };
    };
    if (torobInquiry && torobInquiry.status !== "MATCH_CONFIRMED")
        return stopWithoutPrice();
    const offersTruncated = Boolean(source.isTruncated ||
        source.sourceStatus === "truncated" ||
        source.meta?.isTruncated ||
        source.meta?.offersTruncated === true);
    const singleCompetitor = (0, listing_1.distinctSellerCount)(offers.filter((o) => o.included)) === 1;
    const strategyOpts = {
        onlyCompetitor: singleCompetitor,
        currentPrice: ctx.currentFinalPrice,
        ownOnly,
        skipGapRule: useValidity && est.chaseConfirmedLow,
        truncated: v2 && est.truncationAware && offersTruncated,
    };
    let isProvisional = false;
    const marketMakerOptIn = (0, sourcing_1.isMarketMakerWithoutCostEnabled)(cfg);
    if (isInitiallyCostless) {
        const credibleFresh = offers.filter((o) => o.included && o.fresh && o.credible && o.price > 0);
        const minCredibleNeeded = Math.max(1, cfg.costless?.minCredibleFresh ?? 3);
        const tryCostlessV2Fallback = () => {
            const validIncluded = offers.filter((o) => o.included && o.price > 0);
            const minFallbackNeeded = v2 ? 1 : Math.max(2, cfg.guards.minValidOffers);
            if (!v2 || validIncluded.length < minFallbackNeeded || market.reference == null) {
                return false;
            }
            const poolPrices = validIncluded.map((o) => o.price);
            const fallbackPct = Math.max(35, cfg.costless.provisionalPercentile ?? 30);
            const rawProv = poolPrices.length >= 2 ? (0, stats_1.percentile)(poolPrices, fallbackPct) : poolPrices[0];
            const provisional = (0, stats_1.ceilToStep)(rawProv, Math.max(1, cfg.rounding.finalStep));
            strategy = "provisional_market_percentile";
            competitionTier = "provisional_market_percentile";
            target = provisional;
            isProvisional = true;
            reviewReasons.push(poolPrices.length === 1
                ? `بدون قیمت خرید و تک‌پیشنهادی در ترب — قیمت پیشنهادی موقت (${fa(provisional)}) بر اساس تنها پیشنهاد معتبر، نیازمند تأیید شما در پنل قیمت‌گذاری`
                : `بدون قیمت خرید و کمبود فروشندگان خوش‌امتیاز تازه (${credibleFresh.length} < ${minCredibleNeeded}) — قیمت پیشنهادی موقت (${fa(provisional)} = صدک ${fallbackPct} از ${poolPrices.length} پیشنهاد معتبر ترب) نیازمند بازبینی دستی است`);
            log({
                step: "provisional",
                title: "مسیر آماری بی‌هزینه Provisional (از پیشنهادهای معتبر ترب)",
                message: `فروشنده خوش‌امتیاز تازه کافی نبود (${credibleFresh.length} < ${minCredibleNeeded})؛ قیمت پیشنهادی موقت ${fa(provisional)} تومان از ${poolPrices.length} پیشنهاد معتبر ترب محاسبه شد`,
                level: "warn",
                data: { provisional, poolSize: poolPrices.length, credibleFreshCount: credibleFresh.length },
            });
            return true;
        };
        if (marketMakerOptIn) {
            if (credibleFresh.length >= minCredibleNeeded && market.reference != null && market.count >= Math.max(2, cfg.guards.minValidOffers)) {
                supply = (0, sourcing_1.deriveSafeMarketConsensusSupply)(supply, market, cfg, source.priceTrend);
                marketOpts.hardFloorPrice = supply.hardFloorPrice;
                market = (0, aggregate_1.summarizeMarket)(offers, cfg.aggregation, marketOpts);
                isProvisional = false;
                log({
                    step: "sourcing",
                    title: "کشف هوشمند کف امن اجماع بازار (Market-Maker Consensus)",
                    message: supply.explanation,
                    level: "info",
                    data: {
                        costSource: supply.costSource,
                        hardFloorPrice: supply.hardFloorPrice,
                        impliedCostPrice: supply.impliedCostPrice ?? null,
                        effectiveCostPrice: supply.effectiveCostPrice,
                        usedMarketConsensusFloor: supply.usedMarketConsensusFloor,
                    },
                });
            }
            else if (!tryCostlessV2Fallback()) {
                target = null;
                isProvisional = true;
                reviewReasons.push(`تعداد فروشندگان به‌روز و معتبر (${credibleFresh.length} < ${minCredibleNeeded}) برای قیمت‌گذاری Market-Maker بدون قیمت خرید کافی نیست`);
                log({
                    step: "provisional",
                    title: "مسیر Market-Maker بدون قیمت خرید متوقف شد (کمبود داده معتبر)",
                    message: `فقط ${credibleFresh.length} فروشنده به‌روز و معتبر (حداقل لازم: ${minCredibleNeeded})`,
                    level: "warn",
                });
            }
        }
        else if (credibleFresh.length >= minCredibleNeeded && market.reference != null) {
            // مسیر پیش‌فرض ایمن Provisional (نسخه ۴.۱ / ۴.۲): بدون قیمت خرید، هرگز اعمال خودکار رخ نمی‌دهد؛
            // قیمت پیشنهادی از صدک امن پول «به‌روز + معتبر» محاسبه شده و الزامی به صف بازبینی می‌رود.
            const poolPrices = credibleFresh.map((o) => o.price);
            const effectiveProvisionalPct = cfg.costless.provisionalPercentile !== 30
                ? cfg.costless.provisionalPercentile
                : cfg.sourcing.costlessSafePercentile !== 55
                    ? cfg.sourcing.costlessSafePercentile
                    : cfg.costless.provisionalPercentile;
            const customSafetyMarginPct = cfg.sourcing.costlessSafetyMarginPct != null &&
                Number.isFinite(cfg.sourcing.costlessSafetyMarginPct) &&
                cfg.sourcing.costlessSafetyMarginPct !== 1.0
                ? Math.max(0, cfg.sourcing.costlessSafetyMarginPct)
                : 0;
            const rawProv = (0, stats_1.percentile)(poolPrices, effectiveProvisionalPct) * (1 + customSafetyMarginPct / 100);
            const provisional = (0, stats_1.ceilToStep)(rawProv, Math.max(1, cfg.rounding.finalStep));
            strategy = "provisional_market_percentile";
            competitionTier = "provisional_market_percentile";
            target = provisional;
            isProvisional = true;
            reviewReasons.push(`بدون قیمت خرید و لیست همکار — قیمت Provisional (${fa(provisional)} = صدک ${effectiveProvisionalPct} از ${poolPrices.length} فروشنده به‌روز و معتبر)` +
                " — نیازمند بازبینی و تایید دستی مدیر");
            log({
                step: "provisional",
                title: "مسیر بی‌هزینه Provisional (بدون تحمیلی از اجماع ترب)",
                message: `قیمت Provisional = صدهم ${effectiveProvisionalPct} پول به‌روز و معتبر (${poolPrices.length} عضو): ${fa(provisional)} تومان؛` +
                    ` ارزان‌ترین ${fa(Math.min(...poolPrices))} و گران‌ترین ${fa(Math.max(...poolPrices))} — هیچ ادعای سود قطعی دارد نیست (review)`,
                level: "warn",
                data: { provisional, poolSize: poolPrices.length, desiredMinProfit: supply.hardFloorPrice },
            });
        }
        else if (!tryCostlessV2Fallback()) {
            // داده کافی نیست → تصمیم واقعی تنها با استعلام مجدد/انبار ممکن است (no_data)
            target = null;
            log({
                step: "provisional",
                title: "مسیر بی‌هزینه Provisional غیرفعال",
                message: `فقط ${credibleFresh.length} فروشنده به‌روز و معتبر (حداقل لازم: ${minCredibleNeeded}) — بدون پیشنهاد Provisional`,
                level: "warn",
            });
        }
    }
    log({
        step: "aggregate",
        title: `تحلیل هسته بازار ترب و شهر ${cfg.rank1.defaultCity}`,
        message: market.count > 0
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
    if (singleCompetitor)
        reviewReasons.push("فقط یک رقیب معتبر مشاهده شد؛ قیمت او نیاز به بازبینی دارد");
    if (market.count < cfg.guards.minValidOffers) {
        reviewReasons.push(`تعداد پیشنهاد معتبر (${market.count}) کمتر از حداقل ${cfg.guards.minValidOffers}`);
    }
    // Veto «تازگی» (نسخه ۴.۱ / ۴.۲): در حالت نرم v2، نسبت وزنی تازگی ملاک است تا یک فروشنده قدیمی کم‌وزن اخطار کاذب ندهد
    if (market.count > 0) {
        const includedValid = offers.filter((o) => o.included);
        let freshRatio;
        if (softStaleness) {
            const totalW = includedValid.reduce((s, o) => s + Math.max(0.01, o.weight || 0), 0);
            const freshW = includedValid
                .filter((o) => o.fresh)
                .reduce((s, o) => s + Math.max(0.01, o.weight || 0), 0);
            freshRatio = totalW > 0 ? freshW / totalW : 0;
        }
        else {
            const freshCount = includedValid.filter((o) => o.fresh).length;
            freshRatio = freshCount / market.count;
        }
        if (freshRatio < Math.max(0, cfg.guards.minFreshRatio)) {
            reviewReasons.push(`نسبت ${softStaleness ? "وزنی " : ""}پیشنهادهای به‌روز (${(freshRatio * 100).toFixed(0)}%) زیر حداقل ${Math.round(cfg.guards.minFreshRatio * 100)}% — اطمینان بازار پایین است`);
        }
    }
    // ---------- 5) استراتژی چندسطحی هوشمند (نسخه ۴.۱ — ladder یکپارچه)
    if (!isProvisional) {
        const strat = (0, strategy_1.decideTargetPrice)(market, cfg.rank1, supply, strategyOpts);
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
            target = Math.max(supply.hardFloorPrice, supply.effectiveCostPrice * (1 + targetMargin / 100));
            strategy = "cost_plus";
            competitionTier = "cost_plus_target";
            reviewReasons.push("بدون داده بازار؛ قیمت بر اساس تمام‌شده لیست همکاران + سود هدف تعیین شد");
            log({
                step: "fallback",
                title: "قیمت جایگزین (مبتنی بر قیمت خرید همکاران)",
                message: `قیمت = تمام‌شده تامین (${fa(supply.effectiveCostPrice)}) × (1 + ${targetMargin}%) = ${fa(target)} تومان`,
                level: "warn",
            });
        }
        else {
            return stopWithoutPrice();
        }
    }
    // ---------- 6) محافظ‌ها (تضمین مطلق خط قرمز قیمت خرید همکاران یا کف امن بازار)
    // جهت گرد کردن (نسخه ۴.۱): انکرهای undercut → همیشه به پایین (هرگز بالای رقیب نشویم)؛
    // بقیه (کف/Provisional) → رفتار قبلی با سقف‌گیری به بالا هنگام زیر-کف.
    const guardCtx = {
        costPrice: supply.effectiveCostPrice,
        inventoryCost: supply.inventoryCostPrice,
        replacementCost: supply.replacementCostPrice,
        costPolicy: supply.costPolicyUsed,
        minMarginPct: supply.minMarginPctUsed,
        minProfitAmountToman: supply.minProfitAmountUsed,
        fixedCostToman: cfg.margin.fixedCostToman,
        strictAboveCost: cfg.margin.strictAboveCost ?? true,
        hardFloorPriceOverride: supply.hardFloorPrice,
        currentPrice: ctx.currentFinalPrice,
        price24hAgo: ctx.price24hAgo,
    };
    const guarded = (0, guards_1.applyGuards)(target, guardCtx, cfg.guards, cfg.rounding, {
        preserveCurrent: strategy === "hold_own_price" || strategy === "single_competitor",
        direction: UNDERCUT_ANCHOR_STRATEGIES.has(strategy) ? "floor" : "nearest",
    });
    reviewReasons.push(...guarded.reviewReasons);
    // حفاظت در برابر فروش ناخواسته زیر هزینهٔ موجودی انبار در سیاست replacement_floor
    if (supply.costPolicyUsed === "replacement_floor" &&
        supply.inventoryCostPrice != null &&
        supply.inventoryCostPrice > 0 &&
        guarded.price <= supply.inventoryCostPrice) {
        reviewReasons.push(supply.inventoryReplacementWarning ??
            `قیمت نهایی (${fa(guarded.price)}) مساوی یا کمتر از هزینه موجودی انبار (${fa(supply.inventoryCostPrice)}) است — نیازمند بازبینی دستی`);
    }
    // گاردهای سختگیرانه برای حالت Market-Maker بدون قیمت خرید
    if (supply.usedMarketConsensusFloor) {
        if (market.dispersion > 0.15) {
            reviewReasons.push(`پراکندگی قیمت بازار (${(market.dispersion * 100).toFixed(1)}% > ۱۵٪) در حالت بدون قیمت خرید بالاست — نیازمند بازبینی دستی`);
        }
        if (ctx.currentFinalPrice != null &&
            ctx.currentFinalPrice > 0 &&
            guarded.price < ctx.currentFinalPrice * (1 - Math.min(cfg.guards.maxChangePctPerRun || 20, 10) / 100)) {
            reviewReasons.push(`کاهش قیمت بیش از ۱۰٪ نسبت به قیمت فعلی (${fa(ctx.currentFinalPrice)}) در حالت بدون قیمت خرید — نیازمند بازبینی دستی`);
        }
        if (supply.hardFloorPrice > 0 && guarded.price < supply.hardFloorPrice) {
            reviewReasons.push("قیمت نهایی پایین‌تر از کف امن اجماع بازار قرار گرفت — نیازمند بازبینی دستی");
        }
    }
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
    let scenarioAnalysis = null;
    if (useValidity &&
        est.calibratedConfidence &&
        validity &&
        validity.sortedOffers.length > 0 &&
        validity.anchorPrice != null &&
        !isProvisional &&
        finalPrice > 0) {
        const decideWith = (included) => {
            const clones = offers.map((o) => {
                if (!validity.perOffer.has(o))
                    return { ...o };
                const inc = included.has(o);
                return { ...o, included: inc, cls: inc ? "ok" : o.cls, weight: 0 };
            });
            weighOffers(clones);
            const m = (0, aggregate_1.summarizeMarket)(clones, cfg.aggregation, marketOpts);
            const st = (0, strategy_1.decideTargetPrice)(m, cfg.rank1, supply, {
                ...strategyOpts, onlyCompetitor: (0, listing_1.distinctSellerCount)(clones.filter(o => o.included)) === 1,
            });
            if (st.targetPrice == null)
                return { finalPrice: null, strategy: st.strategy };
            const g = (0, guards_1.applyGuards)(st.targetPrice, guardCtx, cfg.guards, cfg.rounding, {
                preserveCurrent: st.strategy === "single_competitor",
                direction: UNDERCUT_ANCHOR_STRATEGIES.has(st.strategy) ? "floor" : "nearest",
            });
            return { finalPrice: g.price, strategy: st.strategy };
        };
        scenarioAnalysis = (0, robustness_1.analyzeDecisionScenarios)(validity, finalPrice, (o) => !highOutlierSet.has(o) && !liquidationSet.has(o), decideWith, {
            minIncludeProb: est.validity?.minIncludeProb ?? 0.15,
            ...(est.scenario ?? {}),
        });
        log({
            step: "robustness",
            title: "پایداری تصمیم نسبت به عدم‌قطعیتِ اعتبار پیشنهادها (v2)",
            message: `${scenarioAnalysis.scenarios.length} فرضِ محتمل برای «ارزان‌ترین پیشنهاد معتبر» اجرا شد؛ ` +
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
    const conflictOffers = offers.filter((o) => est?.marketConflictByProbability && v2
        ? (o.cls === "suspect_low" || o.cls === "stale_low") && o.price < finalPrice && (o.pValid ?? 0) >= (est.conflictMinProb ?? 0.1)
        : o.cls === "suspect_low" && o.price < finalPrice);
    const marketConflict = conflictOffers.length > 0 && (!scenarioAnalysis || est.conflictGateWhenCalibrated);
    if (marketConflict) {
        const summaryList = conflictOffers
            .slice(0, 3)
            .map((o) => `${o.shopName} (${o.price.toLocaleString("fa-IR")})`)
            .join("، ");
        reviewReasons.push(`تعارض بازار: ${conflictOffers.length} فروشنده‌ی «مشکوک پایین» زیر قیمت پیشنهادی ما قرار گرفت (${summaryList}) — بی‌دلیل نیست، نیازمند بازبینی`);
        log({
            step: "market_conflict",
            title: "Veto تعارض بازار (suspect_low زیر قیمت ما)",
            message: `${conflictOffers.length} فروشنده مشکوک: ${summaryList}`,
            level: "warn",
            data: { count: conflictOffers.length, suspects: conflictOffers.map((o) => ({ shop: o.shopName, price: o.price, cls: o.cls })) },
        });
    }
    if (market.reference != null &&
        supply.effectiveCostPrice > 0 &&
        finalPrice < market.reference * 0.7) {
        reviewReasons.push(`فروش عمیق زیر مرجع بازار (بیش از ۳۰٪ زیر مرجع ${fa(market.reference)}) — deep_floor، نیازمند بازبینی کف تامین`);
    }
    // ---------- 7) ارزیابی جایگاه نهایی در کل ترب و در شهر مشهد
    const position = (0, strategy_1.evaluateCompetitivePosition)(finalPrice, market, supply, competitionTier);
    log({
        step: "position",
        title: `جایگاه رقابتی در ترب و ${cfg.rank1.defaultCity}`,
        message: `رتبه در ${cfg.rank1.defaultCity}: #${position.projectedLocalRank} (از ${position.totalLocalValidSellers || 1}) | ` +
            `رتبه در کل ترب: #${position.projectedNationalRank} (از ${position.totalNationalValidSellers || 1}) | ` +
            `رتبه با احتساب فروشنده‌های مشکوک/کهنه: #${position.rankIncludingSuspect ?? "-"} (از ${position.totalSellersIncludingSuspect || 1}) | ` +
            `حاشیه ایمنی/سود: ${fa(position.netProfitToman)} تومان (${position.netMarginPct}%)`,
        data: { ...position },
    });
    // ---------- 8) سقف معیار با مرجع بیرونی (own_price_7d / market_p75) و کالیبراسیون دقیق (نسخه ۴.۱)
    const disc = (0, discount_1.buildDiscount)(finalPrice, offers, cfg.discount, cfg.rounding, {
        ownStableHigh7d: ctx.discountContext?.ownStableHigh7d ?? null,
        ownAvg7d: ctx.discountContext?.ownAvg7d ?? null,
        hasOwnPriceHistory: Boolean(ctx.discountContext?.ownStableHigh7d && ctx.discountContext.ownStableHigh7d > 0),
        ceilingOverride: market.ceiling,
    });
    const basePrice = disc.basePrice;
    if (!v2 && disc.referenceKind === "none" && disc.discountPct === 0 && market.reference != null && finalPrice < market.reference) {
        reviewReasons.push(`مرجع معتبر تخفیف (own_price_7d / market_p75) یافت نشد؛ کف ما زیر مرجع است → گیت تخفیف نیاز به بازبینی تاریخ قیمت خودی`);
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
    const conf = (0, confidence_1.computeConfidence)(market, { totalSellerCount: marketSource.totalSellerCount, offersTotal: marketOffers.length }, cfg);
    let confidenceScore = conf.score;
    let confidenceBreakdown = { ...conf.breakdown };
    if (scenarioAnalysis) {
        // اعتمادِ کالیبره: ترکیب لوجیستیک پایداری سناریوها و کفایت داده؛ جایگزین آستانهٔ قدیمیِ «امتیاز ساده»
        confidenceScore = (0, robustness_1.calibratedConfidence)(est.confidenceModel, {
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
            reviewReasons.push(`اعتماد کالیبره ${(confidenceScore * 100).toFixed(0)}٪ کمتر از حد اعمال خودکار ${(est.minCalibratedConfidence * 100).toFixed(0)}٪` +
                (alt
                    ? ` — اگر ارزان‌ترین پیشنهاد معتبر «${alt.shopName}» با ${fa(alt.lowestPrice)} باشد قیمت ${fa(alt.finalPrice)} می‌شود (احتمال ${(alt.p * 100).toFixed(0)}٪)`
                    : ""));
        }
    }
    else if (conf.score < cfg.guards.minConfidenceAutoApply) {
        reviewReasons.push(`اعتماد آماری ${conf.score} کمتر از حد اعمال خودکار ${cfg.guards.minConfidenceAutoApply}`);
    }
    if (v2 && est.truncationAware && offersTruncated && market.count < Math.max(3, cfg.guards.minValidOffers)) {
        reviewReasons.push(`خروجی ترب بریده شده (offers_truncated) و فقط ${market.count} پیشنهاد معتبر دیده شد — ممکن است ارزان‌ترین معتبرها دیده نشده باشند`);
    }
    // ---------- 9) ناظر بالاسر SubQ SystemOne (تصمیم‌گیری ۴ مقیاسی با قانون ۳ بازه‌ای 0..45..80..100%)
    const supervisor = (0, systemone_supervisor_1.evaluateSystemOneSupervisorSync)({
        productName: ctx.productName,
        source: marketSource,
        offers: marketOffers,
        supply,
        position,
        floorCeiling: disc.floorCeiling,
        identityMatchScorePct,
        selfShopInListing: selfConfirmsIdentity,
        holdingOwnPrice: ownOnly && strategy === "hold_own_price",
        finalPrice,
        basePrice,
        discountPct: disc.discountPct,
        dispersion: market.dispersion,
        config: cfg,
        marketScoreOverridePct: v2 && est.supervisorMarketCalibrated && scenarioAnalysis ? Math.round(confidenceScore * 100) : null,
        torobInquiryStatus: torobInquiry?.status,
    });
    let rejectedBySupervisor = false;
    if (supervisor.enabled) {
        if (supervisor.verdict === "reject") {
            rejectedBySupervisor = true;
            reviewReasons.push((0, systemone_supervisor_1.formatSupervisorRejectMessage)(supervisor));
        }
        else if (supervisor.verdict === "review") {
            reviewReasons.push(`ناظر بالاسر SystemOne تصمیم را در بازه ریویو قرار داد (${supervisor.overallScorePct}% بین ${supervisor.rejectBelowPct}% و ${supervisor.approveAbovePct}%)`);
        }
        log({
            step: "supervisor",
            title: "ناظر و تصمیم‌گیرنده بالاسر (SubQ SystemOne — ۴ مقیاس)",
            message: `${supervisor.summary} | ` +
                Object.values(supervisor.gates)
                    .map((g) => `${g.key}: ${g.scorePct}% (noul=${g.noul.toFixed(2)} → ${g.verdict})`)
                    .join(" · "),
            level: supervisor.verdict === "reject"
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
    const costUnknownRequiresReview = supply.effectiveCostPrice <= 0 &&
        !(marketMakerOptIn &&
            supply.usedMarketConsensusFloor &&
            !isProvisional &&
            supply.hardFloorPrice > 0 &&
            finalPrice >= supply.hardFloorPrice);
    const needsReview = reviewReasons.length > 0 ||
        !source.ok ||
        isProvisional ||
        costUnknownRequiresReview ||
        rejectedBySupervisor ||
        (supervisor.enabled && supervisor.verdict !== "approve");
    log({
        step: "decision",
        title: "نتیجه نهایی",
        message: rejectedBySupervisor
            ? `⛔ ${(0, systemone_supervisor_1.formatSupervisorRejectMessage)(supervisor)}: داده یا قیمت شرایط ایمنی را ندارد و متوقف شد`
            : needsReview
                ? `⏳ ارسال به بخش ریویو (بازبینی): ${reviewReasons.join("؛ ")} (پیشنهاد: سقف ${fa(basePrice)} با ${disc.discountPct}% تخفیف → کف ${fa(finalPrice)} تومان)`
                : `✅ تایید ناظر SystemOne (${supervisor.overallScorePct}% ≥ ${supervisor.approveAbovePct}%) ؛ آمادهٔ بازبینی مدیر: سقف معیار ${fa(basePrice)} با ${disc.discountPct}% تخفیف → کف قطعی ${fa(finalPrice)} تومان | ${isProvisional ? "قیمت Provisional بدون قیمت خرید تاییدنشده است" : `سود خالص: ${fa(position.netProfitToman)} تومان`}`,
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
        torobInquiry,
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
