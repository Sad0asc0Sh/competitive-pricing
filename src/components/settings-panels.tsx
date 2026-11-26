"use client";

import type { PricingProfile, Schedule, StoreConnector } from "@/db/schema";
import type { AIStatus, ProviderStatus } from "@/lib/ai/config";
import type { TorobRelayStatus } from "@/lib/torob-relay/config";
import { DEFAULT_PROFILE_CONFIG, type PricingProfileConfig, type SystemOneGateThresholdConfig } from "@/lib/pricing/types";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { IconEye, IconEyeOff, IconSearch, IconSpinner, IconTrash } from "./icons";
import { CollapsibleSection, ConfirmDialog, Switch, useToast } from "./ui";

/* ---------------- پروفایل موتور ---------------- */
type Section = keyof PricingProfileConfig;

const labels: Record<string, string> = {
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

const gateTitles: Record<string, string> = {
  identity_match: "مقیاس ۱ (ورودی): تطابق هویت و کد مدل کالا در ترب",
  market_data_integrity: "مقیاس ۲: اعتبار و تازگی قیمت‌های استخراج‌شده بازار",
  profit_and_rank_safety: "مقیاس ۳: ایمنی حاشیه سود همکار و رتبه مشهد/ترب",
  ceiling_discount_validity: "مقیاس ۴: اصالت سقف معیار (بدون پرت) و تخفیف روی کف",
};

const selectOptions: Record<string, { value: string; label: string }[]> = {
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

function normalizeProfileConfig(c?: PricingProfileConfig): PricingProfileConfig {
  return {
    ...DEFAULT_PROFILE_CONFIG,
    ...c,
    supervisor: {
      ...DEFAULT_PROFILE_CONFIG.supervisor,
      ...(c?.supervisor ?? {}),
      gates: {
        ...DEFAULT_PROFILE_CONFIG.supervisor.gates,
        ...(c?.supervisor?.gates ?? {}),
      },
    },
  };
}

export function ProfileEditor({ profiles }: { profiles: PricingProfile[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id);
  const prof = profiles.find((p) => p.id === selected) ?? profiles[0];
  const [cfg, setCfg] = useState<PricingProfileConfig>(() => normalizeProfileConfig(prof.config));
  const [name, setName] = useState(prof.name);
  const [dirty, setDirty] = useState(false);
  const [paramQuery, setParamQuery] = useState("");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ supervisor: true, discount: true });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const pick = (id: number) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSelected(id);
    setCfg(normalizeProfileConfig(p.config));
    setName(p.name);
    setDirty(false);
    setMsg(null);
  };

  const setField = (sec: Section, key: string, val: unknown) => {
    setDirty(true);
    setCfg((c) => ({ ...c, [sec]: { ...c[sec], [key]: val } }));
  };

  const setGateField = (
    gateKey: keyof PricingProfileConfig["supervisor"]["gates"],
    field: keyof SystemOneGateThresholdConfig,
    val: number,
  ) => {
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

  const applyPreset = (preset: "balanced" | "aggressive_volume" | "high_discount_showcase") => {
    setDirty(true);
    if (preset === "balanced") {
      setCfg(DEFAULT_PROFILE_CONFIG);
      const text = "پیش‌فرض استاندارد (رتبه ۱ مشهد/ترب + ناظر SystemOne با بازه ۴۵٪ و ۸۰٪) بارگذاری شد — ذخیره را بزنید.";
      setMsg(text);
      toast.info(text);
    } else if (preset === "aggressive_volume") {
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
    } else if (preset === "high_discount_showcase") {
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

  const save = (asNew = false) =>
    start(async () => {
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
      } else {
        const text = "❌ خطا در ذخیره پروفایل";
        setMsg(text);
        toast.error(text);
      }
      router.refresh();
    });

  const sections = useMemo(() => Object.keys(cfg) as Section[], [cfg]);

  const setAllOpen = (open: boolean) => {
    const next: Record<string, boolean> = {};
    for (const sec of sections) next[sec] = open;
    setOpenMap(next);
  };

  const q = paramQuery.trim().toLowerCase();

  return (
    <div className="space-y-4">
      {/* سناریوهای آماده در قالب کارت‌های قابل لمس */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2.5">
        <div className="text-xs font-bold text-indigo-950">
          ⚡ سناریوهای آماده شخصی‌سازی موتور (کلیک کنید و سپس ذخیره را بزنید):
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <button
            type="button"
            className="rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]"
            onClick={() => applyPreset("balanced")}
          >
            <div className="text-xs font-bold text-slate-900">۱. استاندارد متوازن</div>
            <div className="mt-0.5 text-[11px] text-slate-500">ناظر SystemOne ۴۵٪/۸۰٪ + سقف صدک ۸۵</div>
          </button>
          <button
            type="button"
            className="rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]"
            onClick={() => applyPreset("aggressive_volume")}
          >
            <div className="text-xs font-bold text-slate-900">۲. سود کم و فروش حداکثری</div>
            <div className="mt-0.5 text-[11px] text-slate-500">حداقل سود ۲٪ + رقابت تا خط قرمز</div>
          </button>
          <button
            type="button"
            className="rounded-xl border border-indigo-200 bg-white p-3 text-right transition hover:border-indigo-400 active:scale-[0.99]"
            onClick={() => applyPreset("high_discount_showcase")}
          >
            <div className="text-xs font-bold text-slate-900">۳. تخفیف ویترینی جذاب‌تر</div>
            <div className="mt-0.5 text-[11px] text-slate-500">سقف بالاترین فروشنده معتبر (تا ۳۵٪)</div>
          </button>
        </div>
      </div>

      {/* انتخاب پروفایل و دکمه‌های ذخیره */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_auto_auto] lg:items-end">
          <div>
            <label className="label">پروفایل فعال</label>
            <select className="input" value={selected} onChange={(e) => pick(Number(e.target.value))}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? " (پیش‌فرض)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">نام پروفایل</label>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setDirty(true);
                setName(e.target.value);
              }}
            />
          </div>
          <button type="button" className="btn-primary w-full lg:w-auto" disabled={pending} onClick={() => save(false)}>
            {pending && <IconSpinner className="h-4 w-4" />}
            <span>💾 ذخیره پروفایل</span>
          </button>
          <button type="button" className="btn-secondary w-full lg:w-auto" disabled={pending} onClick={() => save(true)}>
            ➕ ذخیره به‌عنوان پروفایل جدید
          </button>
        </div>

        {/* جستجو در پارامترها */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pr-9 text-xs"
              placeholder="جستجو در تمام پارامترهای موتور (مثلاً مشهد، حاشیه سود، تخفیف)…"
              value={paramQuery}
              onChange={(e) => setParamQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAllOpen(true)} className="btn-secondary btn-sm flex-1 sm:flex-initial">
              باز کردن همه بخش‌ها
            </button>
            <button type="button" onClick={() => setAllOpen(false)} className="btn-secondary btn-sm flex-1 sm:flex-initial">
              بستن همه
            </button>
          </div>
        </div>

        {msg && <div className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800">{msg}</div>}
      </div>

      {/* آکاردئون ۱۳ بخش تنظیمات */}
      <div className="space-y-3">
        {sections.map((sec) => {
          const sectionTitle = labels[sec] ?? sec;
          const entries = Object.entries(cfg[sec] ?? {}).filter(([, v]) => {
            if (
              v != null &&
              typeof v === "object" &&
              (!Array.isArray(v) || (v.length > 0 && typeof v[0] === "object"))
            ) {
              return false;
            }
            return true;
          });

          const sectionMatches =
            !q ||
            sectionTitle.toLowerCase().includes(q) ||
            sec.toLowerCase().includes(q) ||
            entries.some(([k]) => (labels[k] ?? k).toLowerCase().includes(q) || k.toLowerCase().includes(q));

          if (!sectionMatches) return null;

          const visibleEntries =
            !q || sectionTitle.toLowerCase().includes(q) || sec.toLowerCase().includes(q)
              ? entries
              : entries.filter(([k]) => (labels[k] ?? k).toLowerCase().includes(q) || k.toLowerCase().includes(q));

          const isOpen = q ? true : Boolean(openMap[sec]);

          return (
            <CollapsibleSection
              key={sec}
              title={sectionTitle}
              open={isOpen}
              onOpenChange={(next) => setOpenMap((m) => ({ ...m, [sec]: next }))}
              className={
                sec === "supervisor"
                  ? "border-2 border-indigo-300 bg-indigo-50/15"
                  : sec === "discount"
                    ? "border-2 border-emerald-300 bg-emerald-50/15"
                    : ""
              }
            >
              {sec === "supervisor" ? (
                <div className="space-y-4">
                  <p className="text-xs leading-6 text-slate-600">
                    این ناظر بالاسر (<code dir="ltr">SubQ SystemOne — subq-snap-preview</code>) فقط تصمیم‌گیرنده است: در ۴ مقیاس حیاتی امتیاز <code dir="ltr">noul</code> (۰٪ تا ۱۰۰٪) صادر می‌کند. به صورت پیش‌فرض اگر امتیاز <b>زیر ۴۵٪</b> باشد <b>رد کامل</b> می‌شود، اگر بین <b>۴۵٪ تا ۸۰٪</b> باشد به <b>بخش ریویو</b> می‌رود و اگر <b>۸۰٪ به بالا</b> باشد <b>خودکار تایید و اعمال</b> می‌گردد.
                  </p>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <Switch
                        checked={cfg.supervisor.enabled}
                        onChange={(next) => setField("supervisor", "enabled", next)}
                        label="وضعیت ناظر بالاسر"
                        description={cfg.supervisor.enabled ? "فعال (نظارت روی تمام مراحل)" : "غیرفعال"}
                      />
                    </div>
                    <div>
                      <label className="label">حالت اجرای SystemOne</label>
                      <select
                        className="input text-xs"
                        value={cfg.supervisor.mode}
                        onChange={(e) => setField("supervisor", "mode", e.target.value)}
                      >
                        <option value="hybrid_subq_and_local">ترکیبی SubQ API + موتور آنی محلی (پیشنهادی)</option>
                        <option value="subq_api_only">فقط SubQ SystemOne API (/v1/systemone)</option>
                        <option value="local_instant_only">فقط موتور آنی محلی (بدون تاخیر شبکه)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">مدل SubQ (model)</label>
                      <input
                        className="input text-xs"
                        dir="ltr"
                        value={cfg.supervisor.model}
                        onChange={(e) => setField("supervisor", "model", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label font-bold text-rose-700">آستانه سراسری رد کامل (٪)</label>
                      <input
                        className="input num"
                        type="number"
                        min={5}
                        max={90}
                        value={cfg.supervisor.rejectBelowPct}
                        onChange={(e) => setField("supervisor", "rejectBelowPct", Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="label font-bold text-emerald-700">آستانه سراسری تایید خودکار (٪)</label>
                      <input
                        className="input num"
                        type="number"
                        min={20}
                        max={99}
                        value={cfg.supervisor.approveAbovePct}
                        onChange={(e) => setField("supervisor", "approveAbovePct", Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="label">آدرس سرور SubQ (baseURL)</label>
                      <input
                        className="input text-xs"
                        dir="ltr"
                        value={cfg.supervisor.baseUrl}
                        onChange={(e) => setField("supervisor", "baseUrl", e.target.value)}
                      />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2 lg:col-span-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Switch
                          checked={cfg.supervisor.strictGateVeto}
                          onChange={(next) => setField("supervisor", "strictGateVeto", next)}
                          label={labels.strictGateVeto}
                        />
                        <Switch
                          checked={Boolean(cfg.supervisor.shareCostWithApi)}
                          onChange={(next) => setField("supervisor", "shareCostWithApi", next)}
                          label={labels.shareCostWithApi}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ۴ مقیاس ناظر */}
                  <div className="rounded-xl border border-indigo-200 bg-white p-3.5">
                    <div className="mb-3 text-xs font-bold text-indigo-900">
                      🎯 شخصی‌سازی آستانه‌های تصمیم‌گیری در هر ۴ مقیاس (رد / ریویو / تایید خودکار):
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(Object.keys(cfg.supervisor.gates) as (keyof PricingProfileConfig["supervisor"]["gates"])[]).map(
                        (gKey) => {
                          const g = cfg.supervisor.gates[gKey];
                          return (
                            <div key={gKey} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                              <div className="mb-2 text-xs font-bold text-slate-800">{gateTitles[gKey] ?? gKey}</div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <div>
                                  <label className="label text-[11px] text-rose-700">رد زیر (٪)</label>
                                  <input
                                    className="input num text-xs"
                                    type="number"
                                    min={5}
                                    max={90}
                                    value={g.rejectBelowPct}
                                    onChange={(e) => setGateField(gKey, "rejectBelowPct", Number(e.target.value))}
                                  />
                                </div>
                                <div>
                                  <label className="label text-[11px] text-emerald-700">تایید بالای (٪)</label>
                                  <input
                                    className="input num text-xs"
                                    type="number"
                                    min={20}
                                    max={99}
                                    value={g.approveAbovePct}
                                    onChange={(e) => setGateField(gKey, "approveAbovePct", Number(e.target.value))}
                                  />
                                </div>
                                <div>
                                  <label className="label text-[11px]">وزن (0..1)</label>
                                  <input
                                    className="input num text-xs"
                                    type="number"
                                    step={0.05}
                                    min={0.05}
                                    max={1}
                                    value={g.weight}
                                    onChange={(e) => setGateField(gKey, "weight", Number(e.target.value))}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleEntries.map(([k, v]) => {
                    const opts = selectOptions[`${sec}.${k}`] ?? selectOptions[k];
                    if (typeof v === "boolean") {
                      return (
                        <div key={k} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                          <Switch
                            checked={v}
                            onChange={(next) => setField(sec, k, next)}
                            label={labels[k] ?? k}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={k}>
                        <label className="label">{labels[k] ?? k}</label>
                        {Array.isArray(v) ? (
                          <input
                            className="input"
                            value={v.join(",")}
                            onChange={(e) =>
                              setField(
                                sec,
                                k,
                                e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              )
                            }
                          />
                        ) : opts ? (
                          <select
                            className="input"
                            value={String(v)}
                            onChange={(e) => setField(sec, k, e.target.value)}
                          >
                            {opts.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : typeof v === "string" ? (
                          <input className="input" value={v} onChange={(e) => setField(sec, k, e.target.value)} />
                        ) : (
                          <input
                            className="input num"
                            type="number"
                            step="any"
                            value={v as number}
                            onChange={(e) => setField(sec, k, Number(e.target.value))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>
          );
        })}
      </div>

      {/* نوار چسبان ذخیره تغییرات در پایین صفحه */}
      {dirty && (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-300 bg-indigo-950 px-4 py-3 text-white shadow-xl lg:bottom-4">
          <span className="text-xs font-semibold sm:text-sm">تغییرات ذخیره نشده در پروفایل «{name}» وجود دارد.</span>
          <button type="button" className="btn-success btn-sm" disabled={pending} onClick={() => save(false)}>
            {pending && <IconSpinner className="h-3.5 w-3.5" />}
            <span>💾 ذخیره تغییرات پروفایل</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- هوش مصنوعی و توکن‌های API ---------------- */
interface ProviderDraft {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function sourceLabel(source: ProviderStatus["source"]): string {
  if (source === "db") return "توکن ذخیره‌شده در پنل (دیتابیس)";
  if (source === "env") return "توکن از متغیرهای محیطی (.env)";
  return "بدون توکن";
}

function ProviderCard({
  title,
  desc,
  status,
  draft,
  onChange,
  onSave,
  onTest,
  onClear,
  pending,
  keyPlaceholder,
}: {
  title: string;
  desc: string;
  status: ProviderStatus;
  draft: ProviderDraft;
  onChange: (d: ProviderDraft) => void;
  onSave: () => void;
  onTest: () => void;
  onClear: () => void;
  pending: boolean;
  keyPlaceholder: string;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className={`card space-y-3 ${status.configured ? "border-emerald-300" : "border-amber-300"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">{title}</h3>
        {status.configured ? (
          <span className="badge bg-emerald-100 text-emerald-700">توکن ثبت شده</span>
        ) : (
          <span className="badge bg-amber-100 text-amber-700">بدون توکن</span>
        )}
      </div>
      <p className="text-xs leading-6 text-slate-500">{desc}</p>

      <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <div className="break-words">
          منبع: <b>{sourceLabel(status.source)}</b>
          {status.apiKeyHint && (
            <>
              {" "}
              · توکن فعلی: <code dir="ltr" className="break-all">{status.apiKeyHint}</code>
            </>
          )}
        </div>
        <div className="break-all">
          آدرس مؤثر: <code dir="ltr">{status.baseUrl}</code>
        </div>
        <div className="break-all">
          مدل مؤثر: <code dir="ltr">{status.model}</code>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200/80 bg-white p-2.5">
          <Switch
            checked={draft.enabled}
            onChange={(next) => onChange({ ...draft, enabled: next })}
            label={draft.enabled ? "ارائه‌دهنده فعال است" : "ارائه‌دهنده غیرفعال است"}
          />
        </div>

        <div>
          <label className="label">توکن API (خالی بگذارید تا تغییر نکند)</label>
          <div className="relative">
            <input
              className="input pl-11"
              dir="ltr"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder={status.apiKeyHint || keyPlaceholder}
              value={draft.apiKey}
              onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              aria-label={showKey ? "مخفی کردن توکن" : "نمایش توکن"}
              className="absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              {showKey ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="label">آدرس سرور (Base URL)</label>
            <input
              className="input text-xs"
              dir="ltr"
              value={draft.baseUrl}
              onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="label">مدل</label>
            <input
              className="input text-xs"
              dir="ltr"
              value={draft.model}
              onChange={(e) => onChange({ ...draft, model: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-primary flex-1 sm:flex-initial" disabled={pending} onClick={onSave}>
          {pending && <IconSpinner className="h-4 w-4" />}
          <span>💾 ذخیره</span>
        </button>
        <button type="button" className="btn-secondary flex-1 sm:flex-initial" disabled={pending} onClick={onTest}>
          🔌 تست اتصال زنده
        </button>
        <button
          type="button"
          className="btn-danger w-full sm:w-auto"
          disabled={pending || status.source !== "db"}
          onClick={onClear}
        >
          پاک‌کردن توکن ذخیره‌شده
        </button>
      </div>
    </div>
  );
}

export function AISettingsPanel({ initial }: { initial: AIStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<AIStatus>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [clearTarget, setClearTarget] = useState<"ai" | "subq" | null>(null);
  const [ai, setAi] = useState<ProviderDraft>({
    enabled: initial.ai.enabled,
    apiKey: "",
    baseUrl: initial.ai.baseUrl,
    model: initial.ai.model,
  });
  const [subq, setSubq] = useState<ProviderDraft>({
    enabled: initial.subq.enabled,
    apiKey: "",
    baseUrl: initial.subq.baseUrl,
    model: initial.subq.model,
  });

  const call = (provider: "ai" | "subq", action: "save" | "test" | "clear", draft: ProviderDraft) =>
    start(async () => {
      setMsg(null);
      const payload =
        action === "clear"
          ? { provider, action: "save" as const, clearApiKey: true }
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
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string; all?: AIStatus; status?: ProviderStatus }
        | null;
      if (!res.ok) {
        const errText = data?.error ?? "خطا در ارتباط با سرور";
        setMsg({ ok: false, text: errText });
        toast.error(errText);
        return;
      }
      if (data?.all) setStatus(data.all);
      if (action === "test") {
        const ok = Boolean(data?.ok);
        const text = data?.message ?? "—";
        setMsg({ ok, text });
        if (ok) toast.success(text);
        else toast.error(text);
      } else if (action === "clear") {
        const text = "توکن ذخیره‌شده پاک شد؛ در صورت وجود، مقدار .env جایگزین می‌شود";
        setMsg({ ok: true, text });
        toast.info(text);
        setClearTarget(null);
      } else {
        const text = "پیکربندی با موفقیت در دیتابیس ذخیره شد";
        setMsg({ ok: true, text });
        toast.success(text);
      }
      setAi((s) => ({ ...s, apiKey: "" }));
      setSubq((s) => ({ ...s, apiKey: "" }));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {msg && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {msg.ok ? "✅ " : "❌ "}
          {msg.text}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderCard
          title="هوش مصنوعی مکمل (OpenAI-compatible)"
          desc="برای استخراج پیشنهادها از HTML، نظر دوم روی تصمیم‌های کم‌اعتماد و تأیید تطابق کالا. با هر سرویس سازگار با OpenAI (OpenAI, OpenRouter, Groq, Ollama و ...) کار می‌کند."
          status={status.ai}
          draft={ai}
          onChange={setAi}
          onSave={() => call("ai", "save", ai)}
          onTest={() => call("ai", "test", ai)}
          onClear={() => setClearTarget("ai")}
          pending={pending}
          keyPlaceholder="sk-..."
        />
        <ProviderCard
          title="ناظر و تصمیم‌گیرنده بالاسر SubQ SystemOne"
          desc="تصمیم‌گیرنده اصلی موتور (قانون ۳ بازه‌ای رد/ریویو/تأیید خودکار). توکن از این‌جا در دیتابیس ذخیره می‌شود و همان لحظه در همه استعلام‌ها (اجرای زمان‌بندی، دستی و API) استفاده می‌شود."
          status={status.subq}
          draft={subq}
          onChange={setSubq}
          onSave={() => call("subq", "save", subq)}
          onTest={() => call("subq", "test", subq)}
          onClear={() => setClearTarget("subq")}
          pending={pending}
          keyPlaceholder="SUBQ_API_KEY"
        />
      </div>

      <ConfirmDialog
        open={Boolean(clearTarget)}
        title="حذف توکن ذخیره‌شده از دیتابیس"
        description="آیا از حذف توکن ذخیره‌شده این سرویس مطمئن هستید؟ پس از حذف، در صورت وجود مقدار در فایل .env جایگزین می‌شود."
        confirmLabel="پاک‌کردن توکن"
        tone="danger"
        busy={pending}
        onConfirm={() => {
          if (clearTarget === "ai") call("ai", "clear", ai);
          else if (clearTarget === "subq") call("subq", "clear", subq);
        }}
        onCancel={() => setClearTarget(null)}
      />
    </div>
  );
}

/* ---------------- رله اتصال امن به ترب ---------------- */
function extractPortFromUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "43389";
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withScheme);
    if (u.port) return u.port;
    return u.protocol === "https:" ? "443" : "43389";
  } catch {
    return "43389";
  }
}

function generateSimpleRelayKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "trb_";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function TorobRelayPanel({ initial }: { initial: TorobRelayStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<TorobRelayStatus>(initial);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [url, setUrl] = useState<string>(initial.url || "2.180.37.182:43389");
  const [relayKey, setRelayKey] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const port = extractPortFromUrl(url);
  const displayKey = relayKey.trim() || "YOUR_RELAY_KEY";
  const runCmd = `node torob-relay.mjs --port=${port} --key="${displayKey}"`;

  const act = (action: "save" | "test" | "clear" | "reset_breaker") =>
    start(async () => {
      setMsg(null);
      const payload =
        action === "reset_breaker"
          ? { action }
          : action === "clear"
            ? { action }
            : { action, enabled, url, relayKey: relayKey || undefined };
      const res = await fetch("/api/torob-relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string; status?: TorobRelayStatus; mcpSynced?: boolean }
        | null;

      if (!res.ok) {
        const text = data?.error ?? "خطا در ارتباط با سرور";
        setMsg({ ok: false, text });
        toast.error(text);
        return;
      }

      if (data?.status) {
        setStatus(data.status);
        setEnabled(data.status.enabled);
        if (action === "clear") setUrl("2.180.37.182:43389");
        else if (data.status.url) setUrl(data.status.url);
      }

      if (action === "test" || action === "reset_breaker") {
        const ok = Boolean(data?.ok);
        const text = data?.message ?? "—";
        setMsg({ ok, text });
        if (ok) toast.success(text);
        else toast.error(text);
      } else if (action === "clear") {
        const text = "تنظیمات رله پاک شد و اتصال به حالت پیش‌فرض برگشت.";
        setMsg({ ok: true, text });
        toast.info(text);
        setRelayKey("");
        setClearConfirmOpen(false);
      } else {
        const syncNote = data?.mcpSynced ? " و به torob-mcp اعمال شد" : "";
        const text = `تنظیمات رله ذخیره شد${syncNote}.`;
        setMsg({ ok: true, text });
        toast.success(text);
        setRelayKey("");
      }
      router.refresh();
    });

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(runCmd);
      toast.success("دستور اجرا کپی شد");
    } catch {
      toast.error("کپی خودکار پشتیبانی نشد — دستور را دستی کپی کنید");
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {msg.ok ? "✅ " : "❌ "}
          {msg.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className={`card space-y-3.5 ${
            status.configured && status.enabled ? "border-emerald-300" : "border-amber-300"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900">اتصال به سرور رله ایران (با یک کلید)</h3>
            {status.configured && status.enabled ? (
              <span className="badge bg-emerald-100 text-emerald-700">
                {status.mode === "encrypted_relay" ? "رله رمزنگاری‌شده فعال" : "رله HTTPS فعال"}
              </span>
            ) : (
              <span className="badge bg-amber-100 text-amber-700">اتصال مستقیم سرور</span>
            )}
          </div>

          <p className="text-xs leading-6 text-slate-500">
            آدرس سرور مسکونی (مثل <code dir="ltr">2.180.37.182:43389</code>) و یک کلید ساده وارد کنید. تمام
            درخواست‌ها و پاسخ‌ها با <code dir="ltr">AES-256-GCM</code> رمزنگاری می‌شوند و نیازی به گواهی SSL یا
            تنظیمات پیچیده نیست.
          </p>

          <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <div>
              منبع فعلی:{" "}
              <b>
                {status.source === "db"
                  ? "پنل (دیتابیس)"
                  : status.source === "env"
                    ? "فایل .env"
                    : "تنظیم‌نشده (مستقیم)"}
              </b>
              {status.keyHint && (
                <>
                  {" "}
                  · کلید فعلی: <code dir="ltr">{status.keyHint}</code>
                </>
              )}
            </div>
            <div className="break-all">
              آدرس مؤثر: <code dir="ltr">{status.url || "https://api.torob.com (مستقیم)"}</code>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-2.5">
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label={enabled ? "ارسال درخواست‌های ترب از طریق رله فعال است" : "رله خاموش است (اتصال مستقیم)"}
            />
          </div>

          <div>
            <label className="label">آدرس و پورت سرور ایران</label>
            <input
              className="input text-xs"
              dir="ltr"
              placeholder="2.180.37.182:43389"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="label">کلید رله (حداقل ۶ کاراکتر — خالی بگذارید تا تغییر نکند)</label>
              <button
                type="button"
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                onClick={() => {
                  setRelayKey(generateSimpleRelayKey());
                  setShowKey(true);
                }}
              >
                🎲 ساخت کلید تصادفی
              </button>
            </div>
            <div className="relative">
              <input
                className="input pl-11 text-xs"
                dir="ltr"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                placeholder={status.keyHint || "مثلاً MyTorobKey2026"}
                value={relayKey}
                onChange={(e) => setRelayKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "مخفی کردن کلید" : "نمایش کلید"}
                className="absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                {showKey ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn-primary flex-1 sm:flex-initial"
              disabled={pending}
              onClick={() => act("save")}
            >
              {pending && <IconSpinner className="h-4 w-4" />}
              <span>💾 ذخیره و اعمال فوری</span>
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 sm:flex-initial"
              disabled={pending}
              onClick={() => act("test")}
            >
              🔌 تست اتصال زنده به ترب
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 sm:flex-initial"
              disabled={pending}
              onClick={() => act("reset_breaker")}
            >
              🔓 ریست قفل ۴۹۰
            </button>
            <button
              type="button"
              className="btn-danger w-full sm:w-auto"
              disabled={pending || status.source !== "db"}
              onClick={() => setClearConfirmOpen(true)}
            >
              پاک‌کردن تنظیمات
            </button>
          </div>
        </div>

        {/* راهنمای اجرای ۱ دقیقه‌ای روی ویندوز و لینوکس */}
        <div className="card space-y-3.5 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900">⚡ راه‌اندازی ۱ دقیقه‌ای روی ویندوز یا لینوکس</h3>
            <a
              href="/api/torob-relay/script"
              download="torob-relay.mjs"
              className="btn-secondary btn-sm"
            >
              ⬇️ دانلود فایل torob-relay.mjs
            </a>
          </div>

          <ol className="list-decimal space-y-2 pr-4 text-xs leading-6 text-slate-700">
            <li>
              فایل <code dir="ltr">torob-relay.mjs</code> را با دکمه بالا دانلود کنید (بدون نیاز به{" "}
              <code dir="ltr">npm install</code> — فقط Node.js 18+ لازم است).
            </li>
            <li>
              روی سرور مسکونی ایران، همان فایل را با دستور زیر در ترمینال (PowerShell ویندوز یا Bash لینوکس) اجرا
              کنید:
            </li>
          </ol>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-900 p-3 text-slate-100">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>دستور اجرا (Windows &amp; Linux)</span>
              <button
                type="button"
                onClick={copyCommand}
                className="rounded bg-slate-700 px-2 py-0.5 text-slate-100 hover:bg-slate-600"
              >
                کپی دستور
              </button>
            </div>
            <pre dir="ltr" className="overflow-x-auto text-xs leading-relaxed text-emerald-300">
              {runCmd}
            </pre>
          </div>

          <div className="space-y-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/60 p-3 text-[11px] leading-6 text-indigo-950">
            <div className="font-bold">نکات امنیتی آماده و ساده:</div>
            <ul className="list-disc space-y-1 pr-4">
              <li>
                پورت <code dir="ltr">{port}</code> روی فایروال ویندوز/لینوکس سیستم مسکونی باید باز باشد.
              </li>
              <li>
                برای امنیت بیشتر می‌توانید IP سرور پنل خودتان را هم اضافه کنید:{" "}
                <code dir="ltr">--allow-ip=YOUR_VPS_IP</code>
              </li>
              <li>
                رله فقط درخواست‌های <code dir="ltr">GET</code> به <code dir="ltr">api.torob.com</code> را قبول
                می‌کند و بدون کلید یکسان حتی به اسکنرها پاسخ <code dir="ltr">404</code> می‌دهد.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="حذف تنظیمات رله از دیتابیس"
        description="آیا مطمئن هستید؟ پس از پاک‌کردن، استعلام ترب به حالت مستقیم (یا مقدار .env در صورت وجود) برمی‌گردد."
        confirmLabel="پاک‌کردن"
        tone="danger"
        busy={pending}
        onConfirm={() => act("clear")}
        onCancel={() => setClearConfirmOpen(false)}
      />
    </div>
  );
}

/* ---------------- زمان‌بندی ---------------- */
export function ScheduleEditor({ items }: { items: Schedule[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", intervalMinutes: 180, category: "", productIds: "" });
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const call = (body: unknown, method = "POST", successMsg = "تغییرات زمان‌بندی ثبت شد") =>
    start(async () => {
      const res = await fetch("/api/schedules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(successMsg);
        if (method === "POST" && (body as { id?: number }).id == null) {
          setDraft({ name: "", intervalMinutes: 180, category: "", productIds: "" });
        }
        setDeleteTarget(null);
      } else {
        toast.error("خطا در ثبت زمان‌بندی");
      }
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {/* نمای موبایل زمان‌بندی‌ها */}
      <div className="space-y-3 md:hidden">
        {items.map((s) => {
          const filterParts: string[] = [];
          if (s.filter?.category) filterParts.push(`دسته: ${s.filter.category}`);
          if (s.filter?.productIds?.length) filterParts.push(`کالاها: ${s.filter.productIds.join(", ")}`);
          return (
            <div key={s.id} className="m-row space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-slate-900">{s.name}</div>
                <Switch
                  checked={s.active}
                  disabled={pending}
                  onChange={(checked) =>
                    call({
                      id: s.id,
                      name: s.name,
                      intervalMinutes: s.intervalMinutes,
                      category: s.filter?.category,
                      productIds: s.filter?.productIds,
                      active: checked,
                    })
                  }
                />
              </div>
              <div className="m-row-kv">
                <span>بازه اجرا</span>
                <span className="num">هر {s.intervalMinutes.toLocaleString("fa-IR")} دقیقه</span>
              </div>
              <div className="m-row-kv">
                <span>فیلتر</span>
                <span className="text-xs">{filterParts.length ? filterParts.join(" · ") : "همه محصولات"}</span>
              </div>
              <div className="m-row-kv">
                <span>آخرین / بعدی</span>
                <span className="text-xs">
                  {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—"} /{" "}
                  {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—"}
                </span>
              </div>
              <button
                type="button"
                className="btn-danger btn-sm w-full"
                disabled={pending}
                onClick={() => setDeleteTarget(s)}
              >
                <IconTrash className="h-3.5 w-3.5" />
                <span>حذف زمان‌بندی</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* نمای دسکتاپ */}
      <div className="table-scroll hidden md:block">
        <table className="data min-w-[700px]">
          <thead>
            <tr>
              <th>نام</th>
              <th>بازه (دقیقه)</th>
              <th>فیلتر</th>
              <th>آخرین اجرا</th>
              <th>اجرای بعدی</th>
              <th>فعال</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const filterParts: string[] = [];
              if (s.filter?.category) filterParts.push(`دسته: ${s.filter.category}`);
              if (s.filter?.productIds?.length) filterParts.push(`کالاها: ${s.filter.productIds.join(", ")}`);
              return (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="num">{s.intervalMinutes}</td>
                  <td className="text-xs">{filterParts.length ? filterParts.join(" · ") : "همه محصولات"}</td>
                  <td className="text-xs">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—"}</td>
                  <td className="text-xs">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—"}</td>
                  <td>
                    <Switch
                      checked={s.active}
                      disabled={pending}
                      onChange={(checked) =>
                        call({
                          id: s.id,
                          name: s.name,
                          intervalMinutes: s.intervalMinutes,
                          category: s.filter?.category,
                          productIds: s.filter?.productIds,
                          active: checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={pending}
                      onClick={() => setDeleteTarget(s)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* افزودن زمان‌بندی جدید */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
        <div className="mb-2.5 text-xs font-bold text-slate-700">افزودن زمان‌بندی جدید</div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <label className="label">نام</label>
            <input
              className="input"
              placeholder="مثلاً استعلام ۳ ساعته"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">هر چند دقیقه</label>
            <input
              className="input num"
              type="number"
              value={draft.intervalMinutes}
              onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">فقط دسته (اختیاری)</label>
            <input
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </div>
          <div>
            <label className="label">شناسه کالاها (با کاما)</label>
            <input
              className="input"
              dir="ltr"
              placeholder="1, 2, 5"
              value={draft.productIds}
              onChange={(e) => setDraft({ ...draft, productIds: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={pending || !draft.name}
            onClick={() => call(draft, "POST", "زمان‌بندی جدید اضافه شد")}
          >
            {pending && <IconSpinner className="h-4 w-4" />}
            <span>افزودن زمان‌بندی</span>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="حذف زمان‌بندی"
        description={`آیا از حذف زمان‌بندی «${deleteTarget?.name ?? ""}» مطمئن هستید؟`}
        confirmLabel="حذف"
        tone="danger"
        busy={pending}
        onConfirm={() => deleteTarget && call({ id: deleteTarget.id }, "DELETE", "زمان‌بندی حذف شد")}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ---------------- کانکتور فروشگاه ---------------- */
export function ConnectorEditor({ items }: { items: StoreConnector[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState(items.map((c) => ({ ...c })));
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const save = (c: StoreConnector, active?: boolean) =>
    start(async () => {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, config: c.config, active: active ?? c.active }),
      });
      if (res.ok) {
        toast.success(`تنظیمات «${c.name}» ذخیره شد`);
      } else {
        toast.error("خطا در ذخیره تنظیمات کانکتور");
      }
      router.refresh();
    });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {drafts.map((c, i) => (
        <div key={c.id} className={`card flex flex-col justify-between gap-3 ${c.active ? "border-emerald-300" : ""}`}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">{c.name}</h3>
              {c.active ? (
                <span className="badge bg-emerald-100 text-emerald-700">فعال</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">غیرفعال</span>
              )}
            </div>

            <div className="space-y-2.5">
              {Object.entries(c.config).map(([k, v]) => {
                const isSecret = /secret|key|token|pass/i.test(k);
                const fieldKey = `${c.id}-${k}`;
                const visible = Boolean(revealed[fieldKey]);
                return (
                  <div key={k}>
                    <label className="label">{k}</label>
                    <div className="relative">
                      <input
                        className={`input ${isSecret ? "pl-11" : ""}`}
                        dir="ltr"
                        type={isSecret && !visible ? "password" : "text"}
                        value={v}
                        onChange={(e) =>
                          setDrafts((d) =>
                            d.map((x, j) => (j === i ? { ...x, config: { ...x.config, [k]: e.target.value } } : x)),
                          )
                        }
                      />
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealed((r) => ({ ...r, [fieldKey]: !r[fieldKey] }))}
                          aria-label={visible ? "مخفی کردن مقدار" : "نمایش مقدار"}
                          className="absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        >
                          {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {c.lastError && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs break-all text-rose-700">
                آخرین خطا: {c.lastError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button type="button" className="btn-primary flex-1 sm:flex-initial" disabled={pending} onClick={() => save(c)}>
              {pending && <IconSpinner className="h-4 w-4" />}
              <span>ذخیره</span>
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 sm:flex-initial"
              disabled={pending}
              onClick={() => save(c, !c.active)}
            >
              {c.active ? "غیرفعال کردن" : "فعال کردن"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
