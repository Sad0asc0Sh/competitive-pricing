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
    allowAutoApplyWithoutCost: "اعمال خودکار قیمت معیار بازار حتی در نبود لیست/قیمت خرید (Provisional همیشه ریویو است)",
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
    ownShopNames: "نام فروشگاه خودمان در ترب (کاما)",
    outliers: "۲) حذف داده‌های پرت و فروشندگان غیربه‌روز",
    method: "روش آماری حذف پرت",
    iqrK: "ضریب IQR",
    madK: "ضریب MAD",
    hardBandPct: "باند سخت بالای میانه بازار ٪ (حذف گران‌فروشان پرت)",
    lowerStaleBandPct: "باند سخت پایین حول میانه فروشندگان تازه ٪ (حذف ارزان‌فروشان آپدیت‌نشده)",
    minSamples: "حداقل نمونه برای روش آماری",
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
    minConfidenceAutoApply: "حداقل اعتماد برای اعمال خودکار (0-1)",
    minValidOffers: "حداقل پیشنهاد معتبر",
    hysteresisPct: "آستانه هیسترزیس (جلوگیری از نوسان جزئی) ٪",
    profitApproveMarginPct: "حداقل حاشیه سود برای اعمال خودکار ٪ (۰ = هر قیمت بالای کف سود؛ بیشتر = ریویو)",
    discount: "۷) کشف سقف واقعی بازار (معیار تخفیف) و اعمال درصد تخفیف روی کف",
    mode: "روش کشف سقف قیمت بازار (معیار تخفیف)",
    basePriceMode: "روش پایه سنتی (سازگاری)",
    marketUpperPercentile: "صدک سقف بازار تحت رصد (مثلاً ۸۵ یعنی صدک ۸۵ فروشندگان معتبر بدون پرت)",
    maxCeilingAboveMedianPct: "حداکثر فاصله مجاز سقف از میانه بازار ٪ (سپر ضد قیمت پرت)",
    calibrateCeilingForExactFloor: "کالیبراسیون دقیق سقف تا با درصد تخفیف صحیح دقیقاً به کف هدف برسد",
    markupPct: "درصد افزایش روی کف (در حالت markup یا نبود داده)",
    minDiscountPct: "حداقل درصد تخفیف روی سقف ٪",
    maxDiscountPct: "حداکثر درصد تخفیف روی سقف ٪",
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
    ai: "۱۰) هوش مصنوعی مکمل",
    reviewBelowConfidence: "بازبینی AI وقتی اعتماد کمتر از",
};
const gateTitles = {
    identity_match: "مقیاس ۱ (ورودی): تطابق هویت و کد مدل کالا در ترب",
    market_data_integrity: "مقیاس ۲: اعتبار و تازگی قیمت‌های استخراج‌شده بازار",
    profit_and_rank_safety: "مقیاس ۳: ایمنی حاشیه سود همکار و رتبه مشهد/ترب",
    ceiling_discount_validity: "مقیاس ۴: اصالت سقف معیار (بدون پرت) و تخفیف روی کف",
};
const selectOptions = {
    selectionMode: [
        { value: "priority_then_lowest", label: "اولویت همکار مشهد/معتبر، سپس ارزان‌ترین" },
        { value: "lowest_valid", label: "ارزان‌ترین همکار معتبر" },
        { value: "conservative_high", label: "محافظه‌کارانه (بالاترین همکار معتبر)" },
        { value: "weighted_priority", label: "میانگین وزنی اولویت همکاران" },
    ],
    costPolicy: [
        { value: "replacement_floor", label: "کف از قیمت ریپلیس (هشدار در صورت عبور از هزینه انبار)" },
        { value: "max_inventory_replacement", label: "کف از بیشینه هزینه انبار و ریپلیس (محافظه‌کارانه)" },
        { value: "legacy_never_below_manual", label: "سازگاری ۳.۶: هرگز کمتر از هزینه انبار" },
    ],
    method: [
        { value: "iqr", label: "ترکیبی IQR + MAD + باند فروشندگان تازه (پیشنهادی)" },
        { value: "mad", label: "انحراف مطلق از میانه (MAD)" },
        { value: "band", label: "باند درصدی حول میانه" },
    ],
    mode: [
        { value: "market_percentile_ceiling", label: "صدک بالای بازار تحت رصد (حذف کامل پرت‌ها — پیشنهادی)" },
        { value: "highest_valid_seller", label: "بالاترین فروشنده معتبر بازار (محصور در سپر ضدپرت)" },
        { value: "trimmed_upper_cluster", label: "میانگین نیمه بالایی فروشندگان معتبر بازار" },
        { value: "markup", label: "افزایش درصدی ثابت روی کف هدف (Markup)" },
        { value: "hybrid_subq_and_local", label: "ترکیبی SubQ SystemOne API + موتور آنی محلی (پیشنهادی)" },
        { value: "subq_api_only", label: "فقط API رسمی SubQ SystemOne (نیازمند SUBQ_API_KEY)" },
        { value: "local_instant_only", label: "فقط موتور آنی محلی SystemOne (بدون نیاز به اینترنت خارجی)" },
    ],
    basePriceMode: [
        { value: "market_upper", label: "سقف بازار تحت رصد (market_upper)" },
        { value: "markup", label: "افزایش درصدی (markup)" },
    ],
    psychological: [
        { value: "none", label: "بدون رُند روانی (دقیق روی ضریب گام)" },
        { value: "x900", label: "ختم به ۹۰۰" },
        { value: "x000", label: "ختم به ۰۰۰" },
    ],
};
function ProfileEditor({ profiles }) {
    const router = (0, navigation_1.useRouter)();
    const [selected, setSelected] = (0, react_1.useState)(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id);
    const prof = profiles.find((p) => p.id === selected) ?? profiles[0];
    const [cfg, setCfg] = (0, react_1.useState)({
        ...types_1.DEFAULT_PROFILE_CONFIG,
        ...prof.config,
        supervisor: {
            ...types_1.DEFAULT_PROFILE_CONFIG.supervisor,
            ...(prof.config?.supervisor ?? {}),
            gates: {
                ...types_1.DEFAULT_PROFILE_CONFIG.supervisor.gates,
                ...(prof.config?.supervisor?.gates ?? {}),
            },
        },
    });
    const [name, setName] = (0, react_1.useState)(prof.name);
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    const pick = (id) => {
        const p = profiles.find((x) => x.id === id);
        setSelected(id);
        setCfg({
            ...types_1.DEFAULT_PROFILE_CONFIG,
            ...p.config,
            supervisor: {
                ...types_1.DEFAULT_PROFILE_CONFIG.supervisor,
                ...(p.config?.supervisor ?? {}),
                gates: {
                    ...types_1.DEFAULT_PROFILE_CONFIG.supervisor.gates,
                    ...(p.config?.supervisor?.gates ?? {}),
                },
            },
        });
        setName(p.name);
    };
    const setField = (sec, key, val) => setCfg((c) => ({ ...c, [sec]: { ...c[sec], [key]: val } }));
    const setGateField = (gateKey, field, val) => setCfg((c) => ({
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
    const applyPreset = (preset) => {
        if (preset === "balanced") {
            setCfg(types_1.DEFAULT_PROFILE_CONFIG);
            setMsg("پیش‌فرض استاندارد (رتبه ۱ مشهد/ترب + ناظر SystemOne با بازه ۴۵٪ و ۸۰٪) بارگذاری شد — ذخیره را بزنید.");
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
            setMsg("حالت «سود کم، فروش حداکثری» اعمال شد — دکمه ذخیره را بزنید.");
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
            setMsg("حالت «بیشترین درصد تخفیف معتبر از سقف بازار» اعمال شد — دکمه ذخیره را بزنید.");
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
        setMsg(res.ok ? "✅ پروفایل با موفقیت ذخیره شد" : "❌ خطا در ذخیره");
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-indigo-900", children: "\u26A1 \u0633\u0646\u0627\u0631\u06CC\u0648\u0647\u0627\u06CC \u0622\u0645\u0627\u062F\u0647 \u0634\u062E\u0635\u06CC\u200C\u0633\u0627\u0632\u06CC \u0645\u0648\u062A\u0648\u0631 (\u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u0648 \u0633\u067E\u0633 \u0630\u062E\u06CC\u0631\u0647 \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F):" }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary text-xs", onClick: () => applyPreset("balanced"), children: "\u06F1. \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u0645\u062A\u0648\u0627\u0632\u0646 (\u0646\u0627\u0638\u0631 SystemOne \u06F4\u06F5\u066A/\u06F8\u06F0\u066A + \u0633\u0642\u0641 \u0635\u062F\u06A9 \u06F8\u06F5)" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary text-xs", onClick: () => applyPreset("aggressive_volume"), children: "\u06F2. \u0633\u0648\u062F \u06A9\u0645 \u0648 \u0641\u0631\u0648\u0634 \u062D\u062F\u0627\u06A9\u062B\u0631\u06CC (\u062D\u062F\u0627\u0642\u0644 \u0633\u0648\u062F \u06F2\u066A)" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary text-xs", onClick: () => applyPreset("high_discount_showcase"), children: "\u06F3. \u0633\u0642\u0641 \u0628\u0627\u0644\u0627\u062A\u0631\u06CC\u0646 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 (\u062A\u062E\u0641\u06CC\u0641 \u0648\u06CC\u062A\u0631\u06CC\u0646\u06CC \u062C\u0630\u0627\u0628\u200C\u062A\u0631)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-end gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0641\u0639\u0627\u0644" }), (0, jsx_runtime_1.jsx)("select", { className: "input", value: selected, onChange: (e) => pick(Number(e.target.value)), children: profiles.map((p) => ((0, jsx_runtime_1.jsxs)("option", { value: p.id, children: [p.name, p.isDefault ? " (پیش‌فرض)" : ""] }, p.id))) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex-1", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: name, onChange: (e) => setName(e.target.value) })] }), (0, jsx_runtime_1.jsx)("button", { className: "btn-primary", disabled: pending, onClick: () => save(false), children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644" }), (0, jsx_runtime_1.jsx)("button", { className: "btn-secondary", disabled: pending, onClick: () => save(true), children: "\u2795 \u0630\u062E\u06CC\u0631\u0647 \u0628\u0647\u200C\u0639\u0646\u0648\u0627\u0646 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u062F\u06CC\u062F" }), msg && (0, jsx_runtime_1.jsx)("span", { className: "text-xs font-medium text-indigo-700", children: msg })] }), (0, jsx_runtime_1.jsx)("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3", children: Object.keys(cfg).map((sec) => ((0, jsx_runtime_1.jsxs)("div", { className: `card ${sec === "supervisor"
                        ? "border-2 border-indigo-400 bg-indigo-50/25 md:col-span-2 xl:col-span-2"
                        : sec === "discount"
                            ? "border-2 border-emerald-300 bg-emerald-50/20"
                            : ""}`, children: [(0, jsx_runtime_1.jsx)("h3", { className: "mb-3 font-bold text-slate-800", children: labels[sec] ?? sec }), sec === "supervisor" ? ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("p", { className: "text-xs leading-5 text-slate-600", children: ["\u0627\u06CC\u0646 \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631 (`SubQ SystemOne \u2014 subq-snap-preview`) \u0641\u0642\u0637 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0627\u0633\u062A: \u062F\u0631 \u06F4 \u0645\u0642\u06CC\u0627\u0633 \u062D\u06CC\u0627\u062A\u06CC \u0627\u0645\u062A\u06CC\u0627\u0632 `noul` (`0%` \u062A\u0627 `100%`) \u0635\u0627\u062F\u0631 \u0645\u06CC\u200C\u06A9\u0646\u062F. \u0628\u0647 \u0635\u0648\u0631\u062A \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u0627\u06AF\u0631 \u0627\u0645\u062A\u06CC\u0627\u0632 ", (0, jsx_runtime_1.jsx)("b", { children: "\u0632\u06CC\u0631 \u06F4\u06F5\u066A" }), " \u0628\u0627\u0634\u062F ", (0, jsx_runtime_1.jsx)("b", { children: "\u0631\u062F \u06A9\u0627\u0645\u0644" }), " \u0645\u06CC\u200C\u0634\u0648\u062F\u060C \u0627\u06AF\u0631 \u0628\u06CC\u0646 ", (0, jsx_runtime_1.jsx)("b", { children: "\u06F4\u06F5\u066A \u062A\u0627 \u06F8\u06F0\u066A" }), " \u0628\u0627\u0634\u062F \u0628\u0647 ", (0, jsx_runtime_1.jsx)("b", { children: "\u0628\u062E\u0634 \u0631\u06CC\u0648\u06CC\u0648" }), " \u0645\u06CC\u200C\u0631\u0648\u062F \u0648 \u0627\u06AF\u0631 ", (0, jsx_runtime_1.jsx)("b", { children: "\u06F8\u06F0\u066A \u0628\u0647 \u0628\u0627\u0644\u0627" }), " \u0628\u0627\u0634\u062F ", (0, jsx_runtime_1.jsx)("b", { children: "\u062E\u0648\u062F\u06A9\u0627\u0631 \u062A\u0627\u06CC\u06CC\u062F \u0648 \u0627\u0639\u0645\u0627\u0644" }), " \u0645\u06CC\u200C\u06AF\u0631\u062F\u062F."] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0648\u0636\u0639\u06CC\u062A \u0646\u0627\u0638\u0631 \u0628\u0627\u0644\u0627\u0633\u0631" }), (0, jsx_runtime_1.jsxs)("label", { className: "inline-flex items-center gap-2 text-xs font-medium", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: cfg.supervisor.enabled, onChange: (e) => setField("supervisor", "enabled", e.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: cfg.supervisor.enabled ? "فعال (نظارت روی تمام مراحل)" : "غیرفعال" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u0627\u0644\u062A \u0627\u062C\u0631\u0627\u06CC SystemOne" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: cfg.supervisor.mode, onChange: (e) => setField("supervisor", "mode", e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "hybrid_subq_and_local", children: "\u062A\u0631\u06A9\u06CC\u0628\u06CC SubQ API + \u0645\u0648\u062A\u0648\u0631 \u0622\u0646\u06CC \u0645\u062D\u0644\u06CC (\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "subq_api_only", children: "\u0641\u0642\u0637 SubQ SystemOne API (`/v1/systemone`)" }), (0, jsx_runtime_1.jsx)("option", { value: "local_instant_only", children: "\u0641\u0642\u0637 \u0645\u0648\u062A\u0648\u0631 \u0622\u0646\u06CC \u0645\u062D\u0644\u06CC (\u0628\u062F\u0648\u0646 \u062A\u0627\u062E\u06CC\u0631 \u0634\u0628\u06A9\u0647)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u0644 SubQ (`model`)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: cfg.supervisor.model, onChange: (e) => setField("supervisor", "model", e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-rose-700 font-bold", children: "\u0622\u0633\u062A\u0627\u0646\u0647 \u0633\u0631\u0627\u0633\u0631\u06CC \u0631\u062F \u06A9\u0627\u0645\u0644 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 5, max: 90, value: cfg.supervisor.rejectBelowPct, onChange: (e) => setField("supervisor", "rejectBelowPct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-emerald-700 font-bold", children: "\u0622\u0633\u062A\u0627\u0646\u0647 \u0633\u0631\u0627\u0633\u0631\u06CC \u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 20, max: 99, value: cfg.supervisor.approveAbovePct, onChange: (e) => setField("supervisor", "approveAbovePct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0622\u062F\u0631\u0633 \u0633\u0631\u0648\u0631 SubQ (`baseURL`)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: cfg.supervisor.baseUrl, onChange: (e) => setField("supervisor", "baseUrl", e.target.value) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-indigo-200 bg-white p-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-2 text-xs font-bold text-indigo-900", children: "\uD83C\uDFAF \u0634\u062E\u0635\u06CC\u200C\u0633\u0627\u0632\u06CC \u0622\u0633\u062A\u0627\u0646\u0647\u200C\u0647\u0627\u06CC \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u06CC \u062F\u0631 \u0647\u0631 \u06F4 \u0645\u0642\u06CC\u0627\u0633 (\u0631\u062F / \u0631\u06CC\u0648\u06CC\u0648 / \u062A\u0627\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631):" }), (0, jsx_runtime_1.jsx)("div", { className: "grid gap-2.5 md:grid-cols-2", children: Object.keys(cfg.supervisor.gates).map((gKey) => {
                                                const g = cfg.supervisor.gates[gKey];
                                                return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg border border-slate-200 bg-slate-50/70 p-2.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-1.5 text-xs font-bold text-slate-800", children: gateTitles[gKey] ?? gKey }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-3 gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px] text-rose-700", children: "\u0631\u062F \u0632\u06CC\u0631 (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 5, max: 90, value: g.rejectBelowPct, onChange: (e) => setGateField(gKey, "rejectBelowPct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px] text-emerald-700", children: "\u062A\u0627\u06CC\u06CC\u062F \u0628\u0627\u0644\u0627\u06CC (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", min: 20, max: 99, value: g.approveAbovePct, onChange: (e) => setGateField(gKey, "approveAbovePct", Number(e.target.value)) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px]", children: "\u0648\u0632\u0646 (0..1)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num text-xs", type: "number", step: 0.05, min: 0.05, max: 1, value: g.weight, onChange: (e) => setGateField(gKey, "weight", Number(e.target.value)) })] })] })] }, gKey));
                                            }) })] })] })) : ((0, jsx_runtime_1.jsx)("div", { className: "space-y-2.5", children: Object.entries(cfg[sec]).map(([k, v]) => ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: labels[k] ?? k }), typeof v === "boolean" ? ((0, jsx_runtime_1.jsxs)("label", { className: "inline-flex items-center gap-2 text-xs text-slate-700", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: v, onChange: (e) => setField(sec, k, e.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: v ? "فعال" : "غیرفعال" })] })) : Array.isArray(v) ? ((0, jsx_runtime_1.jsx)("input", { className: "input", value: v.join(","), onChange: (e) => setField(sec, k, e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean)) })) : selectOptions[k] ? ((0, jsx_runtime_1.jsx)("select", { className: "input", value: String(v), onChange: (e) => setField(sec, k, e.target.value), children: selectOptions[k].map((o) => ((0, jsx_runtime_1.jsx)("option", { value: o.value, children: o.label }, o.value))) })) : typeof v === "string" ? ((0, jsx_runtime_1.jsx)("input", { className: "input", value: v, onChange: (e) => setField(sec, k, e.target.value) })) : ((0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: "any", value: v, onChange: (e) => setField(sec, k, Number(e.target.value)) }))] }, k))) }))] }, sec))) })] }));
}
function sourceLabel(source) {
    if (source === "db")
        return "توکن ذخیره‌شده در پنل (دیتابیس)";
    if (source === "env")
        return "توکن از متغیرهای محیطی (.env)";
    return "بدون توکن";
}
function ProviderCard({ title, desc, status, draft, onChange, onSave, onTest, onClear, pending, keyPlaceholder, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `card ${status.configured ? "border-emerald-300" : "border-amber-300"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-2 flex items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-bold", children: title }), status.configured ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-700", children: "\u062A\u0648\u06A9\u0646 \u062B\u0628\u062A \u0634\u062F\u0647" })) : ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-100 text-amber-700", children: "\u0628\u062F\u0648\u0646 \u062A\u0648\u06A9\u0646" }))] }), (0, jsx_runtime_1.jsx)("p", { className: "mb-3 text-xs leading-5 text-slate-500", children: desc }), (0, jsx_runtime_1.jsxs)("div", { className: "mb-3 space-y-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-600", children: [(0, jsx_runtime_1.jsxs)("div", { children: ["\u0645\u0646\u0628\u0639: ", (0, jsx_runtime_1.jsx)("b", { children: sourceLabel(status.source) }), status.apiKeyHint && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [" ", "\u00B7 \u062A\u0648\u06A9\u0646 \u0641\u0639\u0644\u06CC: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: status.apiKeyHint })] }))] }), (0, jsx_runtime_1.jsxs)("div", { children: ["\u0622\u062F\u0631\u0633 \u0645\u0624\u062B\u0631: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: status.baseUrl }), " \u00B7 \u0645\u062F\u0644 \u0645\u0624\u062B\u0631: ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: status.model })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-2", children: [(0, jsx_runtime_1.jsxs)("label", { className: "inline-flex items-center gap-2 text-xs font-medium text-slate-700", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.enabled, onChange: (e) => onChange({ ...draft, enabled: e.target.checked }) }), (0, jsx_runtime_1.jsx)("span", { children: draft.enabled ? "فعال" : "غیرفعال" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0648\u06A9\u0646 API (\u062E\u0627\u0644\u06CC \u0628\u06AF\u0630\u0627\u0631\u06CC\u062F \u062A\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u0646\u06A9\u0646\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", type: "password", autoComplete: "off", placeholder: status.apiKeyHint || keyPlaceholder, value: draft.apiKey, onChange: (e) => onChange({ ...draft, apiKey: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-2 md:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0622\u062F\u0631\u0633 \u0633\u0631\u0648\u0631 (Base URL)" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: draft.baseUrl, onChange: (e) => onChange({ ...draft, baseUrl: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u0644" }), (0, jsx_runtime_1.jsx)("input", { className: "input text-xs", dir: "ltr", value: draft.model, onChange: (e) => onChange({ ...draft, model: e.target.value }) })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 flex flex-wrap gap-2", children: [(0, jsx_runtime_1.jsx)("button", { className: "btn-primary", disabled: pending, onClick: onSave, children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647" }), (0, jsx_runtime_1.jsx)("button", { className: "btn-secondary", disabled: pending, onClick: onTest, children: "\uD83D\uDD0C \u062A\u0633\u062A \u0627\u062A\u0635\u0627\u0644 \u0632\u0646\u062F\u0647" }), (0, jsx_runtime_1.jsx)("button", { className: "btn-danger", disabled: pending || status.source !== "db", onClick: onClear, children: "\u067E\u0627\u06A9\u200C\u06A9\u0631\u062F\u0646 \u062A\u0648\u06A9\u0646 \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647" })] })] }));
}
function AISettingsPanel({ initial }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const [status, setStatus] = (0, react_1.useState)(initial);
    const [msg, setMsg] = (0, react_1.useState)(null);
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
            : action === "test"
                ? { provider, action, apiKey: draft.apiKey || undefined, baseUrl: draft.baseUrl, model: draft.model, enabled: draft.enabled }
                : { provider, action, apiKey: draft.apiKey || undefined, baseUrl: draft.baseUrl, model: draft.model, enabled: draft.enabled };
        const res = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => null));
        if (!res.ok) {
            setMsg({ ok: false, text: data?.error ?? "خطا در ارتباط با سرور" });
            return;
        }
        if (data?.all)
            setStatus(data.all);
        if (action === "test")
            setMsg({ ok: Boolean(data?.ok), text: data?.message ?? "—" });
        else if (action === "clear")
            setMsg({ ok: true, text: "توکن ذخیره‌شده پاک شد؛ در صورت وجود، مقدار .env جایگزین می‌شود" });
        else
            setMsg({ ok: true, text: "پیکربندی با موفقیت در دیتابیس ذخیره شد" });
        setAi((s) => ({ ...s, apiKey: "" }));
        setSubq((s) => ({ ...s, apiKey: "" }));
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [msg && ((0, jsx_runtime_1.jsxs)("div", { className: `rounded-lg border p-2 text-xs font-medium ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`, children: [msg.ok ? "✅ " : "❌ ", msg.text] })), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-4 lg:grid-cols-2", children: [(0, jsx_runtime_1.jsx)(ProviderCard, { title: "\u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC \u0645\u06A9\u0645\u0644 (OpenAI-compatible)", desc: "\u0628\u0631\u0627\u06CC \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627 \u0627\u0632 HTML\u060C \u0646\u0638\u0631 \u062F\u0648\u0645 \u0631\u0648\u06CC \u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627\u06CC \u06A9\u0645\u200C\u0627\u0639\u062A\u0645\u0627\u062F \u0648 \u062A\u0623\u06CC\u06CC\u062F \u062A\u0637\u0627\u0628\u0642 \u06A9\u0627\u0644\u0627. \u0628\u0627 \u0647\u0631 \u0633\u0631\u0648\u06CC\u0633 \u0633\u0627\u0632\u06AF\u0627\u0631 \u0628\u0627 OpenAI (OpenAI, OpenRouter, Groq, Ollama \u0648 ...) \u06A9\u0627\u0631 \u0645\u06CC\u200C\u06A9\u0646\u062F.", status: status.ai, draft: ai, onChange: setAi, onSave: () => call("ai", "save", ai), onTest: () => call("ai", "test", ai), onClear: () => call("ai", "clear", ai), pending: pending, keyPlaceholder: "sk-..." }), (0, jsx_runtime_1.jsx)(ProviderCard, { title: "\u0646\u0627\u0638\u0631 \u0648 \u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0628\u0627\u0644\u0627\u0633\u0631 SubQ SystemOne", desc: "\u062A\u0635\u0645\u06CC\u0645\u200C\u06AF\u06CC\u0631\u0646\u062F\u0647 \u0627\u0635\u0644\u06CC \u0645\u0648\u062A\u0648\u0631 (\u0642\u0627\u0646\u0648\u0646 \u06F3 \u0628\u0627\u0632\u0647\u200C\u0627\u06CC \u0631\u062F/\u0631\u06CC\u0648\u06CC\u0648/\u062A\u0623\u06CC\u06CC\u062F \u062E\u0648\u062F\u06A9\u0627\u0631). \u062A\u0648\u06A9\u0646 \u0627\u0632 \u0627\u06CC\u0646\u200C\u062C\u0627 \u062F\u0631 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0630\u062E\u06CC\u0631\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F \u0648 \u0647\u0645\u0627\u0646 \u0644\u062D\u0638\u0647 \u062F\u0631 \u0647\u0645\u0647 \u0627\u0633\u062A\u0639\u0644\u0627\u0645\u200C\u0647\u0627 (\u0627\u062C\u0631\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC\u060C \u062F\u0633\u062A\u06CC \u0648 API) \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.", status: status.subq, draft: subq, onChange: setSubq, onSave: () => call("subq", "save", subq), onTest: () => call("subq", "test", subq), onClear: () => call("subq", "clear", subq), pending: pending, keyPlaceholder: "SUBQ_API_KEY" })] })] }));
}
/* ---------------- زمان‌بندی ---------------- */
function ScheduleEditor({ items }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const [draft, setDraft] = (0, react_1.useState)({ name: "", intervalMinutes: 180, category: "" });
    const call = (body, method = "POST") => start(async () => {
        await fetch("/api/schedules", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("table", { className: "data", children: [(0, jsx_runtime_1.jsx)("thead", { children: (0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("th", { children: "\u0646\u0627\u0645" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0628\u0627\u0632\u0647 (\u062F\u0642\u06CC\u0642\u0647)" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0641\u06CC\u0644\u062A\u0631" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0622\u062E\u0631\u06CC\u0646 \u0627\u062C\u0631\u0627" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0627\u062C\u0631\u0627\u06CC \u0628\u0639\u062F\u06CC" }), (0, jsx_runtime_1.jsx)("th", { children: "\u0641\u0639\u0627\u0644" }), (0, jsx_runtime_1.jsx)("th", {})] }) }), (0, jsx_runtime_1.jsx)("tbody", { children: items.map((s) => ((0, jsx_runtime_1.jsxs)("tr", { children: [(0, jsx_runtime_1.jsx)("td", { children: s.name }), (0, jsx_runtime_1.jsx)("td", { className: "num", children: s.intervalMinutes }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: s.filter?.category ? `دسته: ${s.filter.category}` : "همه محصولات" }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—" }), (0, jsx_runtime_1.jsx)("td", { className: "text-xs", children: s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—" }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: s.active, onChange: (e) => call({
                                            id: s.id,
                                            name: s.name,
                                            intervalMinutes: s.intervalMinutes,
                                            category: s.filter?.category,
                                            active: e.target.checked,
                                        }) }) }), (0, jsx_runtime_1.jsx)("td", { children: (0, jsx_runtime_1.jsx)("button", { className: "btn-danger", disabled: pending, onClick: () => call({ id: s.id }, "DELETE"), children: "\u062D\u0630\u0641" }) })] }, s.id))) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-end gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0647\u0631 \u0686\u0646\u062F \u062F\u0642\u06CC\u0642\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: draft.intervalMinutes, onChange: (e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0641\u0642\u0637 \u062F\u0633\u062A\u0647 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: draft.category, onChange: (e) => setDraft({ ...draft, category: e.target.value }) })] }), (0, jsx_runtime_1.jsx)("button", { className: "btn-primary", disabled: pending || !draft.name, onClick: () => call(draft), children: "\u0627\u0641\u0632\u0648\u062F\u0646 \u0632\u0645\u0627\u0646\u200C\u0628\u0646\u062F\u06CC" })] })] }));
}
/* ---------------- کانکتور فروشگاه ---------------- */
function ConnectorEditor({ items }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const [drafts, setDrafts] = (0, react_1.useState)(items.map((c) => ({ ...c })));
    const save = (c, active) => start(async () => {
        await fetch("/api/connectors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: c.id, config: c.config, active: active ?? c.active }),
        });
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsx)("div", { className: "grid gap-4 md:grid-cols-3", children: drafts.map((c, i) => ((0, jsx_runtime_1.jsxs)("div", { className: `card ${c.active ? "border-emerald-300" : ""}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-2 flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-bold", children: c.name }), c.active ? ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-700", children: "\u0641\u0639\u0627\u0644" })) : ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-slate-100 text-slate-600", children: "\u063A\u06CC\u0631\u0641\u0639\u0627\u0644" }))] }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-2", children: Object.entries(c.config).map(([k, v]) => ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: k }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: v, onChange: (e) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, config: { ...x.config, [k]: e.target.value } } : x))) })] }, k))) }), c.lastError && (0, jsx_runtime_1.jsxs)("p", { className: "mt-2 text-xs text-rose-600", children: ["\u0622\u062E\u0631\u06CC\u0646 \u062E\u0637\u0627: ", c.lastError] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 flex gap-2", children: [(0, jsx_runtime_1.jsx)("button", { className: "btn-primary", disabled: pending, onClick: () => save(c), children: "\u0630\u062E\u06CC\u0631\u0647" }), (0, jsx_runtime_1.jsx)("button", { className: "btn-secondary", disabled: pending, onClick: () => save(c, !c.active), children: c.active ? "غیرفعال کردن" : "فعال کردن" })] })] }, c.id))) }));
}
