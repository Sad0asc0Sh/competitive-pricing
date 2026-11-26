"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileEditor = ProfileEditor;
exports.AISettingsPanel = AISettingsPanel;
exports.ScheduleEditor = ScheduleEditor;
exports.ConnectorEditor = ConnectorEditor;
const jsx_runtime_1 = require("react/jsx-runtime");
const types_1 = require("../lib/pricing/types");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const icons_1 = require("./icons");
const ui_1 = require("./ui");
const labels = {
    sourcing: "۰) لیست قیمت همکاران + کشف قیمت در نبود لیست",
    selectionMode: "روش انتخاب قیمت خرید از لیست همکاران",
    maxQuoteAgeDays: "حداکثر قدمت لیست قیمت همکار (روز)",
    preferLocalCitySuppliers: "ترجیح همکاران شهر پیش‌فرض (مشهد) برای تامین سریع",
    priorityTolerancePct: "تلرانس ترجیح همکار اولویت‌دار/همشهری نسبت به ارزان‌ترین ٪",
    defaultOverheadPct: "سربار پیش‌فرض تامین و درگاه پرداخت ٪",
    defaultNonLocalShippingToman: "هزینه باربری پیش‌فرض همکاران شهرستان (تومان)",
    staleSafetyBufferPct: "ضریب احتیاط روی لیست قدیمی همکاران ٪",
    neverBelowManualCost: "هرگز کمتر از قیمت خرید ثبت‌شده انبار نباشد (سازگاری قدیمی)",
    costPolicy: "سیاست تقاطع هزینه انبار و قیمت ریپلیس (replacement_floor | max_inventory_replacement | legacy_never_below_manual)",
    allowAutoApplyWithoutCost: "اعمال خودکار قیمت معیار بازار حتی در نبود لیست/قیمت خرید (پیش‌فرض غیرفعال = همیشه ریویو)",
    allowMarketMakerWithoutCost: "مجوز صریح سیاست تجاری Market-Maker در نبود قیمت خرید (پیش‌فرض غیرفعال)",
    costlessSafePercentile: "صدک امن بازار در نبود لیست خرید (حذف نیمه ارزان مشکوک)",
    costlessSafetyMarginPct: "حاشیه ایمنی ضدضرر روی هسته بازار در نبود لیست خرید ٪",
    impliedCostBackoffPct: "فاصله تخمینی قیمت خرید از کف امن بازار در نبود لیست ٪",
    filters: "۱) فیلترهای اعتبار داده ترب",
    minSellerCount: "حداقل تعداد فروشنده (لیستینگ ادغام‌شده)",
    maxOfferAgeDays: "حداکثر قدمت قیمت رقبا در ترب (روز)",
    excludeAds: "حذف آگهی‌های تبلیغاتی (is_adv)",
    excludeOutOfStock: "حذف ناموجودها",
    excludeUnreliablePrices: "حذف قیمت‌های دارای هشدار غیرقابل اعتماد ترب (price_unreliable)",
    includeInPersonSellers: "لحاظ کردن فروشندگان حضوری مشهد در رقابت محلی",
    minShopScore: "حداقل امتیاز فروشگاه رقیب در ترب (۰ تا ۵)",
    shopBlacklist: "لیست سیاه فروشگاه‌ها (کاما)",
    ownShopNames: "نام فروشگاه خودمان در ترب (کاما)؛ املاهای رایج برند همیشه خودکار شناخته می‌شوند",
    ownShopIds: "شناسهٔ فروشندهٔ خودمان در ترب (shop_id، کاما) — دقیق‌ترین راه؛ پس از دیدن پیام «پژواک قیمت خودی» از گزارش تصمیم بردارید",
    outliers: "۲) حذف داده‌های پرت و فروشندگان غیربه‌روز",
    method: "روش آماری/تجمیع",
    iqrK: "ضریب IQR",
    madK: "ضریب MAD",
    hardBandPct: "باند سخت بالای میانه بازار ٪ (حذف گران‌فروشان پرت)",
    lowerStaleBandPct: "باند سخت پایین حول میانه فروشندگان تازه ٪ (حذف ارزان‌فروشان آپدیت‌نشده)",
    minSamples: "حداقل نمونه برای روش آماری",
    classifyClusterPct: "حداکثر فاصله گروه خرید هم‌قیمت ٪ (تشخیص هسته تاییدشده R0)",
    suspectLowBandPct: "باند بدگمانی پایین R1 زیر مرجع ٪ (تشخیص دام قیمتی)",
    freshCutoffDays: "آستانه تازگی «به‌روز» برای طبقه‌بندی R0/R1 (روز)",
    minClusterMembers: "حداقل اعضای خوشه برای تایید هسته R0",
    aggregation: "۳) تجمیع و کشف قیمت معیار بازار",
    trimPct: "درصد برش دو سر بازار (trimmed mean)",
    recencyHalfLifeDays: "نیمه‌عمر وزن تازگی (روز)",
    modalClusterRadiusPct: "شعاع خوشه چگال (Modal Consensus) برای کشف قیمت توافقی بازار ٪",
    rank1: "۴) استراتژی چندسطحی صدر اول ترب و مشهد (کشف کف هدف)",
    enabled: "فعال",
    defaultCity: "شهر پیش‌فرض برای رقابت منطقه‌ای (مثلاً مشهد)",
    localCityAliases: "نام‌های معادل شهر پیش‌فرض (کاما)",
    volumeMode: "استراتژی «سود کم ولی فروش زیاد» (رقابت تا خط قرمز سود)",
    competeInDefaultCity: "در صورت عدم امکان رتبه ۱ کشوری، برای رتبه ۱ مشهد رقابت کن",
    competeInReachableCluster: "قرارگیری در رتبه ۱ گروه فروشندگان بالای کف خرید ما",
    maxGapPct: "حداکثر اختلاف کف با مرجع ٪ در حالت عادی",
    clusterMaxGapPct: "حداکثر فاصله خوشه‌بندی فروشندگان هم‌سطح ٪",
    highTrustScoreThreshold: "حداقل امتیاز فروشگاه‌های خوش‌نام (High-Trust)",
    undercutAmount: "کاهش زیر قیمت رقیب هدف (تومان)",
    undercutPct: "کاهش زیر قیمت رقیب هدف ٪",
    leaderGapPct: "حداکثر فاصله مجاز از رهبر منفرد در حالت پریمیوم ٪",
    leaderMinMarginPct: "حداقل حاشیه سود برای دنبال‌کردن رهبر منفرد ٪",
    leaderPremiumMode: "حالت premium رهبر منفرد: نشستن بالای رهبر (پیش‌فرض false: رتبه ۱ زیر رهبر یا زیر بدنه بازار)",
    localMonopolyDiscountFromRefPct: "تخفیف زیر مرجع کشوری در زمان تک‌فروشندگی در مشهد ٪",
    fallbackToReference: "در اختلاف زیاد، روی مرجع بمان",
    margin: "۵) حاشیه سود و خط قرمز فروش",
    minPct: "حداقل سود خط قرمز روی تمام‌شده همکار ٪",
    targetPct: "سود هدف ٪ (بدون داده بازار)",
    minProfitAmountToman: "حداقل سود خالص تومانی در هر فروش",
    fixedCostToman: "هزینه ثابت هر سفارش (تومان)",
    strictAboveCost: "تضمین مطلق قیمت فروش > قیمت خرید و تامین",
    guards: "۶) محافظ‌ها و پایداری",
    maxChangePctPerRun: "حداکثر تغییر قیمت در هر اجرا ٪",
    maxIncreasePct: "سقف مجاز افزایش قیمت در هر اجرا ٪",
    maxDecreasePct: "سقف مجاز کاهش قیمت در هر اجرا ٪",
    maxDailyChangePct: "سقف مجاز تغییرات تجمعی ۲۴ ساعته ٪",
    minConfidenceAutoApply: "حداقل اعتماد برای اعمال خودکار (0-1)",
    minValidOffers: "حداقل پیشنهاد معتبر",
    hysteresisPct: "آستانه هیسترزیس (جلوگیری از نوسان جزئی) ٪",
    minFreshRatio: "حداقل نسبت پیشنهادهای به‌روز از کل معتبرها (0-1)",
    profitApproveMarginPct: "حداقل حاشیه سود برای اعمال خودکار ٪ (۰ = هر قیمت بالای کف سود؛ بیشتر = ریویو)",
    discount: "۷) کشف سقف واقعی بازار (معیار تخفیف) و اعمال درصد تخفیف روی کف",
    mode: "روش کشف سقف قیمت بازار (معیار تخفیف)",
    basePriceMode: "روش پایه کشف سقف (basePriceMode)",
    marketUpperPercentile: "صدک سقف بازار تحت رصد (مثلاً ۸۵ یعنی صدک ۸۵ فروشندگان معتبر بدون پرت)",
    maxCeilingAboveMedianPct: "حداکثر فاصله مجاز سقف از میانه بازار ٪ (سپر ضد قیمت پرت)",
    calibrateCeilingForExactFloor: "کالیبراسیون دقیق سقف تا با درصد تخفیف صحیح دقیقاً به کف هدف برسد",
    markupPct: "درصد افزایش روی کف (در حالت markup یا نبود داده)",
    minDiscountPct: "حداقل درصد تخفیف روی سقف ٪",
    maxDiscountPct: "حداکثر درصد تخفیف روی سقف ٪",
    ownPriceWindowDays: "پنجره تاریخی قیمت خودی برای مرجع تخفیف (روز)",
    ownPriceMinHoldHours: "حداقل دوام قیمت خودی برای تبدیل به مرجع تخفیف (ساعت)",
    rounding: "۸) گرد کردن قیمت‌ها",
    finalStep: "گام گرد کردن قیمت کف (نهایی)",
    baseStep: "گام گرد کردن قیمت سقف (معیار)",
    psychological: "قیمت روانی",
    supervisor: "۹) ناظر و تصمیم‌گیرنده بالاسر SubQ SystemOne (قانون ۳ بازه‌ای ۰..۴۵..۸۰..۱۰۰٪)",
    baseUrl: "آدرس پایه SubQ SystemOne API",
    model: "مدل تصمیم‌گیرنده (subq-snap-preview)",
    rejectBelowPct: "آستانه رد کامل ٪ (زیر این درصد = رد فوری و عدم ورود به سیستم)",
    approveAbovePct: "آستانه تایید خودکار ٪ (بین رد تا این عدد = ریویو | بالای این عدد = تایید و ادامه خودکار)",
    strictGateVeto: "قانون وتوی سخت‌گیرانه (اگر حتی ۱ مقیاس رد شود، کل تصمیم متوقف شود)",
    shareCostWithApi: "ارسال اعداد خام هزینه/کف سود به API خارجی SubQ (پیش‌فرض false = محرمانگی کامل)",
    ai: "۱۰) هوش مصنوعی مکمل",
    reviewBelowConfidence: "بازبینی AI وقتی اعتماد کمتر از",
    costless: "۱۱) مسیر کالاهای بدون قیمت خرید (Provisional)",
    provisionalPercentile: "صدک استخراج قیمت موقت بازار در نبود قیمت خرید",
    minCredibleFresh: "حداقل فروشندگان معتبر و به‌روز برای فعال‌شدن قیمت موقت",
    autoApply: "اجازه اعمال خودکار قیمت موقت بدون قیمت خرید (پیش‌فرض false = همیشه ریویو)",
    engine: "۱۲) نسخه موتور",
    version: "نسخه موتور قیمت‌گذاری",
    estimator: "۱۳) تخمین‌گر احتمالی نسخه ۲ (Estimator v2)",
    validityModel: "مدل احتمالی اعتبار پیشنهادها (Validity Model)",
    softStaleness: "کاهش نرم وزن قدمت به‌جای حذف سخت سنی",
    hardMaxOfferAgeDays: "سقف مطلق سن پیشنهاد در حالت نرم (روز)",
    guaranteeFix: "اصلاح تشخیص گارانتی معتبر در برابر disabled",
    competitivenessCostRatio: "نسبت وزن رقابت به حفظ حاشیه سود",
    marketConflictByProbability: "تشخیص تعارض بازار بر اساس احتمال اعتبار",
    conflictMinProb: "حداقل احتمال اعتبار برای ثبت تعارض بازار (0-1)",
    truncationAware: "لحاظ کردن برش لیست فروشندگان ترب (Truncation-Aware)",
    confirmedAnchorOverridesGap: "اولویت لنگر تاییدشده با احتمال بالا بر سقف فاصله مرجع",
    anchorOverrideMinProb: "حداقل احتمال اعتبار لنگر برای عبور از سقف فاصله (0-1)",
    anchorOverrideMaxGapPct: "حداکثر فاصله مجاز لنگر تاییدشده از مرجع ٪",
    adaptiveClusterRadius: "شعاع خوشه‌بندی تطبیقی بر اساس پراکندگی بازار",
};
const gateTitles = {
    identity_match: "مقیاس ۱ (ورودی): تطابق هویت و کد مدل کالا در ترب",
    market_data_integrity: "مقیاس ۲: اعتبار و تازگی قیمت‌های استخراج‌شده بازار",
    profit_and_rank_safety: "مقیاس ۳: ایمنی حاشیه سود همکار و رتبه مشهد/ترب",
    ceiling_discount_validity: "مقیاس ۴: اصالت سقف معیار (بدون پرت) و تخفیف روی کف",
};
const selectOptions = {
    "sourcing.selectionMode": [
        { value: "priority_then_lowest", label: "اولویت همکار مشهد/معتبر، سپس ارزان‌ترین" },
        { value: "lowest_valid", label: "ارزان‌ترین همکار معتبر" },
        { value: "conservative_high", label: "محافظه‌کارانه (بالاترین همکار معتبر)" },
        { value: "weighted_priority", label: "میانگین وزنی اولویت همکاران" },
    ],
    "sourcing.costPolicy": [
        { value: "replacement_floor", label: "کف از قیمت ریپلیس (هشدار در صورت عبور از هزینه انبار)" },
        { value: "max_inventory_replacement", label: "کف از بیشینه هزینه انبار و ریپلیس (محافظه‌کارانه)" },
        { value: "legacy_never_below_manual", label: "سازگاری ۳.۶: هرگز کمتر از هزینه انبار" },
    ],
    "outliers.method": [
        { value: "iqr", label: "ترکیبی IQR + MAD + باند فروشندگان تازه (پیشنهادی)" },
        { value: "mad", label: "انحراف مطلق از میانه (MAD)" },
        { value: "band", label: "باند درصدی حول میانه" },
    ],
    "aggregation.method": [
        { value: "trimmed_weighted_mean", label: "میانگین وزنی بریده (trimmed_weighted_mean — پیشنهادی)" },
        { value: "median", label: "میانه (median)" },
        { value: "weighted_mean", label: "میانگین وزنی (weighted_mean)" },
        { value: "modal_consensus", label: "هسته چگال بازار (modal_consensus)" },
    ],
    "discount.mode": [
        { value: "market_percentile_ceiling", label: "صدک بالای بازار تحت رصد (حذف کامل پرت‌ها — پیشنهادی)" },
        { value: "highest_valid_seller", label: "بالاترین فروشنده معتبر بازار (محصور در سپر ضدپرت)" },
        { value: "trimmed_upper_cluster", label: "میانگین نیمه بالایی فروشندگان معتبر بازار" },
        { value: "markup", label: "افزایش درصدی ثابت روی کف هدف (Markup)" },
    ],
    "discount.basePriceMode": [
        { value: "market_ceiling", label: "سقف اصولی بازار (market_ceiling)" },
        { value: "market_upper", label: "صدک بالای بازار (market_upper)" },
        { value: "cluster_ceiling", label: "سقف خوشه بالایی (cluster_ceiling)" },
        { value: "markup", label: "افزایش درصدی روی کف (markup)" },
    ],
    "supervisor.mode": [
        { value: "hybrid_subq_and_local", label: "ترکیبی SubQ SystemOne API + موتور آنی محلی (پیشنهادی)" },
        { value: "subq_api_only", label: "فقط API رسمی SubQ SystemOne (نیازمند SUBQ_API_KEY)" },
        { value: "local_instant_only", label: "فقط موتور آنی محلی SystemOne (بدون نیاز به اینترنت خارجی)" },
    ],
    "estimator.mode": [
        { value: "v2", label: "نسخه ۲ — مدل احتمالی اعتبار و بهینه‌سازی انتظار سود/رقابت (v2)" },
        { value: "legacy", label: "نسخه کلاسیک ۴.۱.۲ (legacy)" },
    ],
    "rounding.psychological": [
        { value: "none", label: "بدون رُند روانی (دقیق روی ضریب گام)" },
        { value: "x900", label: "ختم به ۹۰۰" },
        { value: "x000", label: "ختم به ۰۰۰" },
    ],
};
function normalizeProfileConfig(c) {
    return {
        ...types_1.DEFAULT_PROFILE_CONFIG,
        ...c,
        supervisor: {
            ...types_1.DEFAULT_PROFILE_CONFIG.supervisor,
            ...(c?.supervisor ?? {}),
            gates: {
                ...types_1.DEFAULT_PROFILE_CONFIG.supervisor.gates,
                ...(c?.supervisor?.gates ?? {}),
            },
        },
    };
}
function ProfileEditor({ profiles }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [selected, setSelected] = (0, react_1.useState)(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id);
    const prof = profiles.find((p) => p.id === selected) ?? profiles[0];
    const [cfg, setCfg] = (0, react_1.useState)(() => normalizeProfileConfig(prof.config));
    const [name, setName] = (0, react_1.useState)(prof.name);
    const [dirty, setDirty] = (0, react_1.useState)(false);
    const [paramQuery, setParamQuery] = (0, react_1.useState)("");
    const [openMap, setOpenMap] = (0, react_1.useState)({ supervisor: true, discount: true });
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    const pick = (id) => {
        const p = profiles.find((x) => x.id === id);
        if (!p)
            return;
        setSelected(id);
        setCfg(normalizeProfileConfig(p.config));
        setName(p.name);
        setDirty(false);
        setMsg(null);
    };
    const setField = (sec, key, val) => {
        setDirty(true);
        setCfg((c) => ({ ...c, [sec]: { ...c[sec], [key]: val } }));
    };
    const setGateField = (gateKey, field, val) => {
        setDirty(true);
        setCfg((c) => ({
            ...c,
            supervisor: {
                ...c.supervisor,
                gates: {
                    ...c.supervisor.gates,
                    [gateKey]: {
                        ...c.supervisor.gates[gateKey],
                        [field]: val,
                    },
                },
            },
        }));
    };
    const applyPreset = (preset) => {
        setDirty(true);
        if (preset === "balanced") {
            setCfg(types_1.DEFAULT_PROFILE_CONFIG);
            const text = "پیش‌فرض استاندارد (رتبه ۱ مشهد/ترب + ناظر SystemOne با بازه ۴۵٪ و ۸۰٪) بارگذاری شد — ذخیره را بزنید.";
            setMsg(text);
            toast.info(text);
        }
        else if (preset === "aggressive_volume") {
            setCfg((c) => ({
                ...c,
                margin: { ...c.margin, minPct: 2, minProfitAmountToman: 8000 },
                rank1: { ...c.rank1, volumeMode: true, undercutAmount: 2000 },
                discount: {
                    ...c.discount,
                    mode: "market_percentile_ceiling",
                    marketUpperPercentile: 82,
                    maxCeilingAboveMedianPct: 16,
                    calibrateCeilingForExactFloor: true,
                },
            }));
            const text = "حالت «سود کم، فروش حداکثری» اعمال شد — دکمه ذخیره را بزنید.";
            setMsg(text);
            toast.info(text);
        }
        else if (preset === "high_discount_showcase") {
            setCfg((c) => ({
                ...c,
                discount: {
                    ...c.discount,
                    mode: "highest_valid_seller",
                    marketUpperPercentile: 90,
                    maxCeilingAboveMedianPct: 22,
                    minDiscountPct: 8,
                    maxDiscountPct: 35,
                    calibrateCeilingForExactFloor: true,
                },
            }));
            const text = "حالت «بیشترین درصد تخفیف معتبر از سقف بازار» اعمال شد — دکمه ذخیره را بزنید.";
            setMsg(text);
            toast.info(text);
        }
    };
    const save = (asNew = false) => start(async () => {
        const res = await fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: asNew ? undefined : selected,
                name: asNew ? `${name} (کپی)` : name,
                config: cfg,
                isDefault: !asNew && prof.isDefault,
            }),
        });
        if (res.ok) {
            const text = "✅ پروفایل با موفقیت ذخیره شد";
            setMsg(text);
            setDirty(false);
            toast.success(text);
        }
        else {
            const text = "❌ خطا در ذخیره پروفایل";
            setMsg(text);
            toast.error(text);
        }
        router.refresh();
    });
    const sections = (0, react_1.useMemo)(() => Object.keys(cfg), [cfg]);
    const setAllOpen = (open) => {
        const next = {};
        for (const sec of sections)
            next[sec] = open;
        setOpenMap(next);
    };
    const q = paramQuery.trim().toLowerCase();
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-indigo-950", children: "\u26A1 \u0633\u0646\u0627\u0631\u06CC\u0648\u0647\u0627\u06CC \u0622\u0645\u0627\u062F\u0647 \u0634\u062E\u0635\u06CC\u200C\u0633\u0627\u0632\u06CC \u0645\u0648\u062A\u0648\u0631 (\u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u0648 \u0633\u067E\u0633 \u0630\u062E\u06CC\u0631\u0647 \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F):" }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-2 md:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]", onClick: () => applyPreset("balanced"), children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-slate-900", children: "\u06F1. \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u0645\u062A\u0648\u0627\u0632\u0646" }), (0, jsx_runtime_1.jsx)("div", { className: "mt-0.5 text-[11px] text-slate-500", children: "\u0646\u0627\u0638\u0631 SystemOne \u06F4\u06F5\u066A/\u06F8\u06F0\u066A + \u0633\u0642\u0641 \u0635\u062F\u06A9 \u06F8\u06F5" })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]", onClick: () => applyPreset("aggressive_volume"), children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-slate-900", children: "\u06F2. \u0633\u0648\u062F \u06A9\u0645 \u0648 \u0641\u0631\u0648\u0634 \u062D\u062F\u0627\u06A9\u062B\u0631\u06CC" }), (0, jsx_runtime_1.jsx)("div", { className: "mt-0.5 text-[11px] text-slate-500", children: "\u062D\u062F\u0627\u0642\u0644 \u0633\u0648\u062F \u06F2\u066A + \u0631\u0642\u0627\u0628\u062A \u062A\u0627 \u062E\u0637 \u0642\u0631\u0645\u0632" })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]", onClick: () => applyPreset("high_discount_showcase"), children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-slate-900", children: "\u06F3. \u062A\u062E\u0641\u06CC\u0641 \u0648\u06CC\u062A\u0631\u06CC\u0646\u06CC \u062C\u0630\u0627\u0628\u200C\u062A\u0631" }), (0, jsx_runtime_1.jsx)("div", { className: "mt-0.5 text-[11px] text-slate-500", children: "\u0633\u0642\u0641 \u0628\u0627\u0644\u0627\u062A\u0631\u06CC\u0646 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 (\u062A\u0627 \u06F3\u06F5\u066A)" })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "card space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_auto_auto] lg:items-end", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0641\u0639\u0627\u0644" }), (0, jsx_runtime_1.jsx)("select", { className: "input", value: selected, onChange: (e) => pick(Number(e.target.value)), children: profiles.map((p) => ((0, jsx_runtime_1.jsxs)("option", { value: p.id, children: [p.name, p.isDefault ? " (پیش‌فرض)" : ""] }, p.id))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: name, onChange: (e) => {
                                            setDirty(true);
                                            setName(e.target.value);
                                        } })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary w-full lg:w-auto", disabled: pending, onClick: () => save(false), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary w-full lg:w-auto", disabled: pending, onClick: () => save(true), children: "\u2795 \u0630\u062E\u06CC\u0631\u0647 \u0628\u0647\u200C\u0639\u0646\u0648\u0627\u0646 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u062F\u06CC\u062F" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "relative flex-1 sm:max-w-sm", children: [(0, jsx_runtime_1.jsx)(icons_1.IconSearch, { className: "pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" }), (0, jsx_runtime_1.jsx)("input", { className: "input pr-9 text-xs", placeholder: "\u062C\u0633\u062A\u062C\u0648 \u062F\u0631 \u062A\u0645\u0627\u0645 \u067E\u0627\u0631\u0627\u0645\u062A\u0631\u0647\u0627\u06CC \u0645\u0648\u062A\u0648\u0631 (\u0645\u062B\u0644\u0627\u064B \u0645\u0634\u0647\u062F\u060C \u062D\u0627\u0634\u06CC\u0647 \u0633\u0648\u062F\u060C \u062A\u062E\u0641\u06CC\u0641)\u2026", value: paramQuery, onChange: (e) => setParamQuery(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setAllOpen(true), className: "btn-secondary btn-sm flex-1 sm:flex-initial", children: "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0647\u0645\u0647 \u0628\u062E\u0634\u200C\u0647\u0627" }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setAllOpen(false), className: "btn-secondary btn-sm flex-1 sm:flex-initial", children: "\u0628\u0633\u062A\u0646 \u0647\u0645\u0647" })] })] }), msg && (0, jsx_runtime_1.jsx)("div", { className: "rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800", children: msg })] }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-3", children: sections.map((sec) => {
                    const sectionTitle = labels[sec] ?? sec;
                    const entries = Object.entries(cfg[sec] ?? {}).filter(([, v]) => {
                        if (v != null &&
                            typeof v === "object" &&
                            (!Array.isArray(v) || (v.length > 0 && typeof v[0] === "object"))) {
                            return false;
                        }
                        return true;
                    });
                    const sectionMatches = !q ||
                        sectionTitle.toLowerCase().includes(q) ||
                        sec.toLowerCase().includes(q) ||
                        entries.some(([k]) => (labels[k] ?? k).toLowerCase().includes(q) || k.toLowerCase().includes(q));
                    if (!sectionMatches)
                        return null;
                    const visibleEntries = !q || sectionTitle.toLowerCase().includes(q) || sec.toLowerCase().includes(q)
                        ? entries
                        : entries.filter(([k]) => (labels[k] ?? k).toLowerCase().includes(q) || k.toLowerCase().includes(q));
                    const isOpen = q ? true : Boolean(openMap[sec]);
                    return ((0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: sectionTitle, open: isOpen, onOpenChange: (next) => setOpenMap((m) => ({ ...m, [sec]: next })), className: sec === "supervisor"
                            ? "border-2 border-indigo-300 bg-indigo-50/15"
                            : sec === "discount"
                                ? "border-2 border-emerald-300 bg-emerald-50/15"
                                : "", children: sec === "supervisor" ? ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("p", { className: "text-xs leading-6 text-slate-600", children: ["\u0627\u06CC\u0646 \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "SubQ SystemOne \u2014 subq-snap-preview" }), ") \u0641\u0642\u0637 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0627\u0633\u062A: \u062F\u0631 \u06F4 \u0645\u0642\u06CC\u0627\u0633 \u062D\u06CC\u0627\u062A\u06CC \u0627\u0645\u062A\u06CC\u0627\u0632 ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "noul" }), " (\u06F0\u066A \u062A\u0627 \u06F1\u06F0\u06F0\u066A) \u0635\u0627\u062F\u0631 \u0645\u06CC\u200C\u06A9\u0646\u062F. \u0628\u0647 \u0635\u0648\u0631\u062A \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u0627\u06AF\u0631 \u0627\u0645\u062A\u06CC\u0627\u0632 ", (0, jsx_runtime_1.jsx)("b", { children: "\u0632\u06CC\u0631 \u06F4\u06F5\u066A" }), " \u0628\u0627\u0634\u062F ", (0, jsx_runtime_1.jsx)("b", { children: "\u0631\u062F \u06A9\u0627\u0645\u0644" }), " \u0645\u06CC\u200C\u0634\u0648\u062F\u060C \u0627\u06AF\u0631 \u0628\u06CC\u0646 ", (0, jsx_runtime_1.jsx)("b", { children: "\u06F4\u06F5\u066A \u062A\u0627 \u06F8\u06F0\u066A" }), " \u0628\u0627\u0634\u062F \u0628\u0647 ", (0, jsx_runtime_1.jsx)("b", { children: "\u0628\u062E\u0634 \u0631\u06CC\u0648\u06CC\u0648" }), " \u0645\u06CC\u200C\u0631\u0648\u062F \u0648 \u0627\u06AF\u0631 ", (0, jsx_runtime_1.jsx)("b", { children: "\u06F8\u06F0\u066A \u0628\u0647 \u0628\u0627\u0644\u0627" }), " \u0628\u0627\u0634\u062F ", (0, jsx_runtime_1.jsx)("b", { children: "\u062E\u0648\u062F\u06A9\u0627\u0631 \u062A\u0627\u06CC\u06CC\u062F \u0648 \u0627\u0639\u0645\u0627\u0644" }), " \u0645\u06CC\u200C\u06AF\u0631\u062F\u062F."] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-slate-200 bg-white p-3", children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: cfg.supervisor.enabled, onChange: (next) => setField("supervisor", "enabled", next), label: "\u0648\u0636\u0639\u06CC\u062A \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631", description: cfg.supervisor.enabled ? "فعال (نظارت روی تمام مراحل)" : "غیرفعال" }) }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u0627\u0644\u062A \u0627\u062C\u0631\u0627\u06CC SystemOne" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: cfg.supervisor.mode, onChange: (e) => setField("supervisor", "mode", e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "hybrid_subq_and_local", children: "\u062A\u0631\u06A9\u06CC\u0628\u06CC SubQ API + \u0645\u0648\u062A\u0648\u0631 \u0622\u0646\u06CC \u0645\u062D\u0644\u06CC (\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "subq_api_only", children: "\u0641\u0642\u0637 SubQ SystemOne API (/v1/systemone)" }), (0, jsx_runtime_1.jsx)("option", { value: "local_instant_only", children: "\u0641\u0642\u0637 \u0645\u0648\u062A\u0648\u0631 \u0622\u0646\u06CC \u0645\u062D\u0644\u06CC (\u0628\u062F\u0648\u0646 \u062A\u0627\u062E\u06CC\u0631 \u0634\u0628\u06A9\u0647)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u0644 SubQ (model)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: cfg.supervisor.model, onChange: (e) => setField("supervisor", "model", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label font-bold text-rose-700", children: "\u0622\u0633\u062A\u0627\u0646\u0647 \u0633\u0631\u0627\u0633\u0631\u06CC \u0631\u062F \u06A9\u0627\u0645\u0644 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 5, max: 90, value: cfg.supervisor.rejectBelowPct, onChange: (e) => setField("supervisor", "rejectBelowPct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label font-bold text-emerald-700", children: "\u0622\u0633\u062A\u0627\u0646\u0647 \u0633\u0631\u0627\u0633\u0631\u06CC \u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 20, max: 99, value: cfg.supervisor.approveAbovePct, onChange: (e) => setField("supervisor", "approveAbovePct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0622\u062F\u0631\u0633 \u0633\u0631\u0648\u0631 SubQ (baseURL)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: cfg.supervisor.baseUrl, onChange: (e) => setField("supervisor", "baseUrl", e.target.value) })] }), (0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2 lg:col-span-3", children: (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [(0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: cfg.supervisor.strictGateVeto, onChange: (next) => setField("supervisor", "strictGateVeto", next), label: labels.strictGateVeto }), (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: Boolean(cfg.supervisor.shareCostWithApi), onChange: (next) => setField("supervisor", "shareCostWithApi", next), label: labels.shareCostWithApi })] }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-indigo-200 bg-white p-3.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-3 text-xs font-bold text-indigo-900", children: "\uD83C\uDFAF \u0634\u062E\u0635\u06CC\u200C\u0633\u0627\u0632\u06CC \u0622\u0633\u062A\u0627\u0646\u0647\u200C\u0647\u0627\u06CC \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u06CC \u062F\u0631 \u0647\u0631 \u06F4 \u0645\u0642\u06CC\u0627\u0633 (\u0631\u062F / \u0631\u06CC\u0648\u06CC\u0648 / \u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631):" }), (0, jsx_runtime_1.jsx)("div", { className: "grid gap-3 md:grid-cols-2", children: Object.keys(cfg.supervisor.gates).map((gKey) => {
                                                const g = cfg.supervisor.gates[gKey];
                                                return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-slate-50/70 p-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-2 text-xs font-bold text-slate-800", children: gateTitles[gKey] ?? gKey }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px] text-rose-700", children: "\u0631\u062F \u0632\u06CC\u0631 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 5, max: 90, value: g.rejectBelowPct, onChange: (e) => setGateField(gKey, "rejectBelowPct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px] text-emerald-700", children: "\u062A\u0627\u06CC\u06CC\u062F \u0628\u0627\u0644\u0627\u06CC (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 20, max: 99, value: g.approveAbovePct, onChange: (e) => setGateField(gKey, "approveAbovePct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px]", children: "\u0648\u0632\u0646 (0..1)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", step: 0.05, min: 0.05, max: 1, value: g.weight, onChange: (e) => setGateField(gKey, "weight", Number(e.target.value)) })] })] })] }, gKey));
                                            }) })] })] })) : ((0, jsx_runtime_1.jsx)("div", { className: "grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3", children: visibleEntries.map(([k, v]) => {
                                const opts = selectOptions[`${sec}.${k}`] ?? selectOptions[k];
                                if (typeof v === "boolean") {
                                    return ((0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-slate-200/80 bg-slate-50/50 p-3", children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: v, onChange: (next) => setField(sec, k, next), label: labels[k] ?? k }) }, k));
                                }
                                return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: labels[k] ?? k }), Array.isArray(v) ? ((0, jsx_runtime_1.jsx)("input", { className: "input", value: v.join(","), onChange: (e) => setField(sec, k, e.target.value
                                                .split(",")
                                                .map((s) => s.trim())
                                                .filter(Boolean)) })) : opts ? ((0, jsx_runtime_1.jsx)("select", { className: "input", value: String(v), onChange: (e) => setField(sec, k, e.target.value), children: opts.map((o) => ((0, jsx_runtime_1.jsx)("option", { value: o.value, children: o.label }, o.value))) })) : typeof v === "string" ? ((0, jsx_runtime_1.jsx)("input", { className: "input", value: v, onChange: (e) => setField(sec, k, e.target.value) })) : ((0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: "any", value: v, onChange: (e) => setField(sec, k, Number(e.target.value)) }))] }, k));
                            }) })) }, sec));
                }) }), dirty && ((0, jsx_runtime_1.jsxs)("div", { className: "sticky bottom-20 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-300 bg-indigo-950 px-4 py-3 text-white shadow-xl lg:bottom-4", children: [(0, jsx_runtime_1.jsxs)("span", { className: "text-xs font-semibold sm:text-sm", children: ["\u062A\u063A\u06CC\u06CC\u0631\u0627\u062A \u0630\u062E\u06CC\u0631\u0647 \u0646\u0634\u062F\u0647 \u062F\u0631 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u00AB", name, "\u00BB \u0648\u062C\u0648\u062F \u062F\u0627\u0631\u062F."] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-success btn-sm", disabled: pending, onClick: () => save(false), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647 \u062A\u063A\u06CC\u06CC\u0631\u0627\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644" })] })] }))] }));
}
function sourceLabel(source) {
    if (source === "db")
        return "توکن ذخیره‌شده در پنل (دیتابیس)";
    if (source === "env")
        return "توکن از متغیرهای محیطی (.env)";
    return "بدون توکن";
}
function ProviderCard({ title, desc, status, draft, onChange, onSave, onTest, onClear, pending, keyPlaceholder, }) {
    const [showKey, setShowKey] = (0, react_1.useState)(false);
    return ((0, jsx_runtime_1.jsxs)("div", { className: `card space-y-3 ${status.configured ? "border-emerald-300" : "border-amber-300"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-bold text-slate-900", children: title }), status.configured ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-700", children: "\u062A\u0648\u06A9\u0646 \u062B\u0628\u062A \u0634\u062F\u0647" })) : ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-100 text-amber-700", children: "\u0628\u062F\u0648\u0646 \u062A\u0648\u06A9\u0646" }))] }), (0, jsx_runtime_1.jsx)("p", { className: "text-xs leading-6 text-slate-500", children: desc }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600", children: [(0, jsx_runtime_1.jsxs)("div", { className: "break-words", children: ["\u0645\u0646\u0628\u0639: ", (0, jsx_runtime_1.jsx)("b", { children: sourceLabel(status.source) }), status.apiKeyHint && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [" ", "\u00B7 \u062A\u0648\u06A9\u0646 \u0641\u0639\u0644\u06CC: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "break-all", children: status.apiKeyHint })] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "break-all", children: ["\u0622\u062F\u0631\u0633 \u0645\u0624\u062B\u0631: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: status.baseUrl })] }), (0, jsx_runtime_1.jsxs)("div", { className: "break-all", children: ["\u0645\u062F\u0644 \u0645\u0624\u062B\u0631: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: status.model })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-slate-200/80 bg-white p-2.5", children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: draft.enabled, onChange: (next) => onChange({ ...draft, enabled: next }), label: draft.enabled ? "ارائه‌دهنده فعال است" : "ارائه‌دهنده غیرفعال است" }) }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0648\u06A9\u0646 API (\u062E\u0627\u0644\u06CC \u0628\u06AF\u0630\u0627\u0631\u06CC\u062F \u062A\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u0646\u06A9\u0646\u062F)" }), (0, jsx_runtime_1.jsxs)("div", { className: "relative", children: [(0, jsx_runtime_1.jsx)("input", { className: "input pl-11", dir: "ltr", type: showKey ? "text" : "password", autoComplete: "off", placeholder: status.apiKeyHint || keyPlaceholder, value: draft.apiKey, onChange: (e) => onChange({ ...draft, apiKey: e.target.value }) }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setShowKey((s) => !s), "aria-label": showKey ? "مخفی کردن توکن" : "نمایش توکن", className: "absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700", children: showKey ? (0, jsx_runtime_1.jsx)(icons_1.IconEyeOff, { className: "h-4 w-4" }) : (0, jsx_runtime_1.jsx)(icons_1.IconEye, { className: "h-4 w-4" }) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-2.5 sm:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0622\u062F\u0631\u0633 \u0633\u0631\u0648\u0631 (Base URL)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: draft.baseUrl, onChange: (e) => onChange({ ...draft, baseUrl: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u0644" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: draft.model, onChange: (e) => onChange({ ...draft, model: e.target.value }) })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2 pt-1", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary flex-1 sm:flex-initial", disabled: pending, onClick: onSave, children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary flex-1 sm:flex-initial", disabled: pending, onClick: onTest, children: "\uD83D\uDD0C \u062A\u0633\u062A \u0627\u062A\u0635\u0627\u0644 \u0632\u0646\u062F\u0647" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-danger w-full sm:w-auto", disabled: pending || status.source !== "db", onClick: onClear, children: "\u067E\u0627\u06A9\u200C\u06A9\u0631\u062F\u0646 \u062A\u0648\u06A9\u0646 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647" })] })] }));
}
function AISettingsPanel({ initial }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [status, setStatus] = (0, react_1.useState)(initial);
    const [msg, setMsg] = (0, react_1.useState)(null);
    const [clearTarget, setClearTarget] = (0, react_1.useState)(null);
    const [ai, setAi] = (0, react_1.useState)({
        enabled: initial.ai.enabled,
        apiKey: "",
        baseUrl: initial.ai.baseUrl,
        model: initial.ai.model,
    });
    const [subq, setSubq] = (0, react_1.useState)({
        enabled: initial.subq.enabled,
        apiKey: "",
        baseUrl: initial.subq.baseUrl,
        model: initial.subq.model,
    });
    const call = (provider, action, draft) => start(async () => {
        setMsg(null);
        const payload = action === "clear"
            ? { provider, action: "save", clearApiKey: true }
            : {
                provider,
                action,
                apiKey: draft.apiKey || undefined,
                baseUrl: draft.baseUrl,
                model: draft.model,
                enabled: draft.enabled,
            };
        const res = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => null));
        if (!res.ok) {
            const errText = data?.error ?? "خطا در ارتباط با سرور";
            setMsg({ ok: false, text: errText });
            toast.error(errText);
            return;
        }
        if (data?.all)
            setStatus(data.all);
        if (action === "test") {
            const ok = Boolean(data?.ok);
            const text = data?.message ?? "—";
            setMsg({ ok, text });
            if (ok)
                toast.success(text);
            else
                toast.error(text);
        }
        else if (action === "clear") {
            const text = "توکن ذخیره‌شده پاک شد؛ در صورت وجود، مقدار .env جایگزین می‌شود";
            setMsg({ ok: true, text });
            toast.info(text);
            setClearTarget(null);
        }
        else {
            const text = "پیکربندی با موفقیت در دیتابیس ذخیره شد";
            setMsg({ ok: true, text });
            toast.success(text);
        }
        setAi((s) => ({ ...s, apiKey: "" }));
        setSubq((s) => ({ ...s, apiKey: "" }));
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [msg && ((0, jsx_runtime_1.jsxs)("div", { className: `rounded-xl border px-3.5 py-2.5 text-xs font-medium ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`, children: [msg.ok ? "✅ " : "❌ ", msg.text] })), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-4 lg:grid-cols-2", children: [(0, jsx_runtime_1.jsx)(ProviderCard, { title: "\u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u0645\u06A9\u0645\u0644 (OpenAI-compatible)", desc: "\u0628\u0631\u0627\u06CC \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627 \u0627\u0632 HTML\u060C \u0646\u0638\u0631 \u062F\u0648\u0645 \u0631\u0648\u06CC \u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627\u06CC \u06A9\u0645\u200C\u0627\u0639\u062A\u0645\u0627\u062F \u0648 \u062A\u0623\u06CC\u06CC\u062F \u062A\u0637\u0627\u0628\u0642 \u06A9\u0627\u0644\u0627. \u0628\u0627 \u0647\u0631 \u0633\u0631\u0648\u06CC\u0633 \u0633\u0627\u0632\u06AF\u0627\u0631 \u0628\u0627 OpenAI (OpenAI, OpenRouter, Groq, Ollama \u0648 ...) \u06A9\u0627\u0631 \u0645\u06CC\u200C\u06A9\u0646\u062F.", status: status.ai, draft: ai, onChange: setAi, onSave: () => call("ai", "save", ai), onTest: () => call("ai", "test", ai), onClear: () => setClearTarget("ai"), pending: pending, keyPlaceholder: "sk-..." }), (0, jsx_runtime_1.jsx)(ProviderCard, { title: "\u0646\u0627\u0638\u0631 \u0648 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0628\u0627\u0644\u0627\u0633\u0631 SubQ SystemOne", desc: "\u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0627\u0635\u0644\u06CC \u0645\u0648\u062A\u0648\u0631 (\u0642\u0627\u0646\u0648\u0646 \u06F3 \u0628\u0627\u0632\u0647\u200C\u0627\u06CC \u0631\u062F/\u0631\u06CC\u0648\u06CC\u0648/\u062A\u0623\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631). \u062A\u0648\u06A9\u0646 \u0627\u0632 \u0627\u06CC\u0646\u200C\u062C\u0627 \u062F\u0631 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0630\u062E\u06CC\u0631\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F \u0648 \u0647\u0645\u0627\u0646 \u0644\u062D\u0638\u0647 \u062F\u0631 \u0647\u0645\u0647 \u0627\u0633\u062A\u0639\u0644\u0627\u0645\u200C\u0647\u0627 (\u0627\u062C\u0631\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u060C \u062F\u0633\u062A\u06CC \u0648 API) \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.", status: status.subq, draft: subq, onChange: setSubq, onSave: () => call("subq", "save", subq), onTest: () => call("subq", "test", subq), onClear: () => setClearTarget("subq"), pending: pending, keyPlaceholder: "SUBQ_API_KEY" })] }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: Boolean(clearTarget), title: "\u062D\u0630\u0641 \u062A\u0648\u06A9\u0646 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0627\u0632 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633", description: "\u0622\u06CC\u0627 \u0627\u0632 \u062D\u0630\u0641 \u062A\u0648\u06A9\u0646 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0627\u06CC\u0646 \u0633\u0631\u0648\u06CC\u0633 \u0645\u0637\u0645\u0626\u0646 \u0647\u0633\u062A\u06CC\u062F\u061F \u067E\u0633 \u0627\u0632 \u062D\u0630\u0641\u060C \u062F\u0631 \u0635\u0648\u0631\u062A \u0648\u062C\u0648\u062F \u0645\u0642\u062F\u0627\u0631 \u062F\u0631 \u0641\u0627\u06CC\u0644 .env \u062C\u0627\u06CC\u06AF\u0632\u06CC\u0646 \u0645\u06CC\u200C\u0634\u0648\u062F.", confirmLabel: "\u067E\u0627\u06A9\u200C\u06A9\u0631\u062F\u0646 \u062A\u0648\u06A9\u0646", tone: "danger", busy: pending, onConfirm: () => {
                    if (clearTarget === "ai")
                        call("ai", "clear", ai);
                    else if (clearTarget === "subq")
                        call("subq", "clear", subq);
                }, onCancel: () => setClearTarget(null) })] }));
}
/* ---------------- زمان‌بندی ---------------- */
function ScheduleEditor({ items }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [draft, setDraft] = (0, react_1.useState)({ name: "", intervalMinutes: 180, category: "", productIds: "" });
    const [deleteTarget, setDeleteTarget] = (0, react_1.useState)(null);
    const call = (body, method = "POST", successMsg = "تغییرات زمان‌بندی ثبت شد") => start(async () => {
        const res = await fetch("/api/schedules", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            toast.success(successMsg);
            if (method === "POST" && body.id == null) {
                setDraft({ name: "", intervalMinutes: 180, category: "", productIds: "" });
            }
            setDeleteTarget(null);
        }
        else {
            toast.error("خطا در ثبت زمان‌بندی");
        }
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsx)("div", { className: "space-y-3 md:hidden", children: items.map((s) => {
                    const filterParts = [];
                    if (s.filter?.category)
                        filterParts.push(`دسته: ${s.filter.category}`);
                    if (s.filter?.productIds?.length)
                        filterParts.push(`کالاها: ${s.filter.productIds.join(", ")}`);
                    return ((0, jsx_runtime_1.jsxs)("div", { className: "m-row space-y-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("div", { className: "font-bold text-slate-900", children: s.name }), (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: s.active, disabled: pending, onChange: (checked) => call({
                                            id: s.id,
                                            name: s.name,
                                            intervalMinutes: s.intervalMinutes,
                                            category: s.filter?.category,
                                            productIds: s.filter?.productIds,
                                            active: checked,
                                        }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "m-row-kv", children: [(0, jsx_runtime_1.jsx)("span", { children: "\u0628\u0627\u0632\u0647 \u0627\u062C\u0631\u0627" }), (0, jsx_runtime_1.jsxs)("span", { className: "num", children: ["\u0647\u0631 ", s.intervalMinutes.toLocaleString("fa-IR"), " \u062F\u0642\u06CC\u0642\u0647"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "m-row-kv", children: [(0, jsx_runtime_1.jsx)("span", { children: "\u0641\u06CC\u0644\u062A\u0631" }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs", children: filterParts.length ? filterParts.join(" · ") : "همه محصولات" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "m-row-kv", children: [(0, jsx_runtime_1.jsx)("span", { children: "\u0622\u062E\u0631\u06CC\u0646 / \u0628\u0639\u062F\u06CC" }), (0, jsx_runtime_1.jsxs)("span", { className: "text-xs", children: [s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—", " /", " ", s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—"] })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-danger btn-sm w-full", disabled: pending, onClick: () => setDeleteTarget(s), children: [(0, jsx_runtime_1.jsx)(icons_1.IconTrash, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: "\u062D\u0630\u0641 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC" })] })] }, s.id));
                }) }), (0, jsx_runtime_1.jsx)("div", { className: "table-scroll hidden md:block", children: (0, jsx_runtime_1.jsxs)("table", { className: "data min-w-[700px]", children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "\u0646\u0627\u0645" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0628\u0627\u0632\u0647 (\u062F\u0642\u06CC\u0642\u0647)" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0641\u06CC\u0644\u062A\u0631" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0622\u062E\u0631\u06CC\u0646 \u0627\u062C\u0631\u0627" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0627\u062C\u0631\u0627\u06CC \u0628\u0639\u062F\u06CC" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0641\u0639\u0627\u0644" }), (0, jsx_runtime_1.jsx)("th", {})] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: items.map((s) => {
                                const filterParts = [];
                                if (s.filter?.category)
                                    filterParts.push(`دسته: ${s.filter.category}`);
                                if (s.filter?.productIds?.length)
                                    filterParts.push(`کالاها: ${s.filter.productIds.join(", ")}`);
                                return ((0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { className: "font-medium", children: s.name }), (0, jsx_runtime_1.jsx)("td", { className: "num", children: s.intervalMinutes }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: filterParts.length ? filterParts.join(" · ") : "همه محصولات" }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—" }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—" }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: s.active, disabled: pending, onChange: (checked) => call({
                                                    id: s.id,
                                                    name: s.name,
                                                    intervalMinutes: s.intervalMinutes,
                                                    category: s.filter?.category,
                                                    productIds: s.filter?.productIds,
                                                    active: checked,
                                                }) }) }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-danger btn-sm", disabled: pending, onClick: () => setDeleteTarget(s), children: "\u062D\u0630\u0641" }) })] }, s.id));
                            }) })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-slate-50/70 p-3.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-2.5 text-xs font-bold text-slate-700", children: "\u0627\u0641\u0632\u0648\u062F\u0646 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC \u062C\u062F\u06CC\u062F" }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645" }), (0, jsx_runtime_1.jsx)("input", { className: "input", placeholder: "\u0645\u062B\u0644\u0627\u064B \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u06F3 \u0633\u0627\u0639\u062A\u0647", value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0647\u0631 \u0686\u0646\u062F \u062F\u0642\u06CC\u0642\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: draft.intervalMinutes, onChange: (e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0641\u0642\u0637 \u062F\u0633\u062A\u0647 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: draft.category, onChange: (e) => setDraft({ ...draft, category: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0644\u0627\u0647\u0627 (\u0628\u0627 \u06A9\u0627\u0645\u0627)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", placeholder: "1, 2, 5", value: draft.productIds, onChange: (e) => setDraft({ ...draft, productIds: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary w-full", disabled: pending || !draft.name, onClick: () => call(draft, "POST", "زمان‌بندی جدید اضافه شد"), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0627\u0641\u0632\u0648\u062F\u0646 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC" })] })] })] }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: Boolean(deleteTarget), title: "\u062D\u0630\u0641 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC", description: `آیا از حذف زمان‌بندی «${deleteTarget?.name ?? ""}» مطمئن هستید؟`, confirmLabel: "\u062D\u0630\u0641", tone: "danger", busy: pending, onConfirm: () => deleteTarget && call({ id: deleteTarget.id }, "DELETE", "زمان‌بندی حذف شد"), onCancel: () => setDeleteTarget(null) })] }));
}
/* ---------------- کانکتور فروشگاه ---------------- */
function ConnectorEditor({ items }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [drafts, setDrafts] = (0, react_1.useState)(items.map((c) => ({ ...c })));
    const [revealed, setRevealed] = (0, react_1.useState)({});
    const save = (c, active) => start(async () => {
        const res = await fetch("/api/connectors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: c.id, config: c.config, active: active ?? c.active }),
        });
        if (res.ok) {
            toast.success(`تنظیمات «${c.name}» ذخیره شد`);
        }
        else {
            toast.error("خطا در ذخیره تنظیمات کانکتور");
        }
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsx)("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3", children: drafts.map((c, i) => ((0, jsx_runtime_1.jsxs)("div", { className: `card flex flex-col justify-between gap-3 ${c.active ? "border-emerald-300" : ""}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-bold text-slate-900", children: c.name }), c.active ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-700", children: "\u0641\u0639\u0627\u0644" })) : ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-slate-100 text-slate-600", children: "\u063A\u06CC\u0631\u0641\u0639\u0627\u0644" }))] }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-2.5", children: Object.entries(c.config).map(([k, v]) => {
                                const isSecret = /secret|key|token|pass/i.test(k);
                                const fieldKey = `${c.id}-${k}`;
                                const visible = Boolean(revealed[fieldKey]);
                                return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: k }), (0, jsx_runtime_1.jsxs)("div", { className: "relative", children: [(0, jsx_runtime_1.jsx)("input", { className: `input ${isSecret ? "pl-11" : ""}`, dir: "ltr", type: isSecret && !visible ? "password" : "text", value: v, onChange: (e) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, config: { ...x.config, [k]: e.target.value } } : x))) }), isSecret && ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setRevealed((r) => ({ ...r, [fieldKey]: !r[fieldKey] })), "aria-label": visible ? "مخفی کردن مقدار" : "نمایش مقدار", className: "absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700", children: visible ? (0, jsx_runtime_1.jsx)(icons_1.IconEyeOff, { className: "h-4 w-4" }) : (0, jsx_runtime_1.jsx)(icons_1.IconEye, { className: "h-4 w-4" }) }))] })] }, k));
                            }) }), c.lastError && ((0, jsx_runtime_1.jsxs)("p", { className: "rounded-xl bg-rose-50 px-3 py-2 text-xs break-all text-rose-700", children: ["\u0622\u062E\u0631\u06CC\u0646 \u062E\u0637\u0627: ", c.lastError] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2 border-t border-slate-100 pt-3", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary flex-1 sm:flex-initial", disabled: pending, onClick: () => save(c), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0630\u062E\u06CC\u0631\u0647" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary flex-1 sm:flex-initial", disabled: pending, onClick: () => save(c, !c.active), children: c.active ? "غیرفعال کردن" : "فعال کردن" })] })] }, c.id))) }));
}
