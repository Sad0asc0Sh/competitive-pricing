"use strict";
"use client";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AISettingsPanel = AISettingsPanel;
exports.ConnectorEditor = ConnectorEditor;
exports.ProfileEditor = ProfileEditor;
exports.ScheduleEditor = ScheduleEditor;
var _types = require("../lib/pricing/types");
var _navigation = require("next/navigation");
var _react = require("react");
const labels = {
  sourcing: "۰) لیست قیمت همکاران + کشف قیمت در نبود لیست",
  selectionMode: "روش انتخاب قیمت خرید از لیست همکاران",
  maxQuoteAgeDays: "حداکثر قدمت لیست قیمت همکار (روز)",
  preferLocalCitySuppliers: "ترجیح همکاران شهر پیش‌فرض (مشهد) برای تامین سریع",
  priorityTolerancePct: "تلرانس ترجیح همکار اولویت‌دار/همشهری نسبت به ارزان‌ترین ٪",
  defaultOverheadPct: "سربار پیش‌فرض تامین و درگاه پرداخت ٪",
  defaultNonLocalShippingToman: "هزینه باربری پیش‌فرض همکاران شهرستان (تومان)",
  staleSafetyBufferPct: "ضریب احتیاط روی لیست قدیمی همکاران ٪",
  neverBelowManualCost: "هرگز کمتر از قیمت خرید ثبت‌شده انبار نباشد",
  allowAutoApplyWithoutCost: "اعمال خودکار قیمت معیار بازار حتی در نبود لیست/قیمت خرید",
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
  reviewBelowConfidence: "بازبینی AI وقتی اعتماد کمتر از"
};
const gateTitles = {
  identity_match: "مقیاس ۱ (ورودی): تطابق هویت و کد مدل کالا در ترب",
  market_data_integrity: "مقیاس ۲: اعتبار و تازگی قیمت‌های استخراج‌شده بازار",
  profit_and_rank_safety: "مقیاس ۳: ایمنی حاشیه سود همکار و رتبه مشهد/ترب",
  ceiling_discount_validity: "مقیاس ۴: اصالت سقف معیار (بدون پرت) و تخفیف روی کف"
};
const selectOptions = {
  selectionMode: [{
    value: "priority_then_lowest",
    label: "اولویت همکار مشهد/معتبر، سپس ارزان‌ترین"
  }, {
    value: "lowest_valid",
    label: "ارزان‌ترین همکار معتبر"
  }, {
    value: "conservative_high",
    label: "محافظه‌کارانه (بالاترین همکار معتبر)"
  }, {
    value: "weighted_priority",
    label: "میانگین وزنی اولویت همکاران"
  }],
  method: [{
    value: "iqr",
    label: "ترکیبی IQR + MAD + باند فروشندگان تازه (پیشنهادی)"
  }, {
    value: "mad",
    label: "انحراف مطلق از میانه (MAD)"
  }, {
    value: "band",
    label: "باند درصدی حول میانه"
  }],
  mode: [{
    value: "market_percentile_ceiling",
    label: "صدک بالای بازار تحت رصد (حذف کامل پرت‌ها — پیشنهادی)"
  }, {
    value: "highest_valid_seller",
    label: "بالاترین فروشنده معتبر بازار (محصور در سپر ضدپرت)"
  }, {
    value: "trimmed_upper_cluster",
    label: "میانگین نیمه بالایی فروشندگان معتبر بازار"
  }, {
    value: "markup",
    label: "افزایش درصدی ثابت روی کف هدف (Markup)"
  }, {
    value: "hybrid_subq_and_local",
    label: "ترکیبی SubQ SystemOne API + موتور آنی محلی (پیشنهادی)"
  }, {
    value: "subq_api_only",
    label: "فقط API رسمی SubQ SystemOne (نیازمند SUBQ_API_KEY)"
  }, {
    value: "local_instant_only",
    label: "فقط موتور آنی محلی SystemOne (بدون نیاز به اینترنت خارجی)"
  }],
  basePriceMode: [{
    value: "market_upper",
    label: "سقف بازار تحت رصد (market_upper)"
  }, {
    value: "markup",
    label: "افزایش درصدی (markup)"
  }],
  psychological: [{
    value: "none",
    label: "بدون رُند روانی (دقیق روی ضریب گام)"
  }, {
    value: "x900",
    label: "ختم به ۹۰۰"
  }, {
    value: "x000",
    label: "ختم به ۰۰۰"
  }]
};
function ProfileEditor({
  profiles
}) {
  const router = (0, _navigation.useRouter)();
  const [selected, setSelected] = (0, _react.useState)(profiles.find(p => p.isDefault)?.id ?? profiles[0]?.id);
  const prof = profiles.find(p => p.id === selected) ?? profiles[0];
  const [cfg, setCfg] = (0, _react.useState)({
    ..._types.DEFAULT_PROFILE_CONFIG,
    ...prof.config,
    supervisor: {
      ..._types.DEFAULT_PROFILE_CONFIG.supervisor,
      ...(prof.config?.supervisor ?? {}),
      gates: {
        ..._types.DEFAULT_PROFILE_CONFIG.supervisor.gates,
        ...(prof.config?.supervisor?.gates ?? {})
      }
    }
  });
  const [name, setName] = (0, _react.useState)(prof.name);
  const [pending, start] = (0, _react.useTransition)();
  const [msg, setMsg] = (0, _react.useState)(null);
  const pick = id => {
    const p = profiles.find(x => x.id === id);
    setSelected(id);
    setCfg({
      ..._types.DEFAULT_PROFILE_CONFIG,
      ...p.config,
      supervisor: {
        ..._types.DEFAULT_PROFILE_CONFIG.supervisor,
        ...(p.config?.supervisor ?? {}),
        gates: {
          ..._types.DEFAULT_PROFILE_CONFIG.supervisor.gates,
          ...(p.config?.supervisor?.gates ?? {})
        }
      }
    });
    setName(p.name);
  };
  const setField = (sec, key, val) => setCfg(c => ({
    ...c,
    [sec]: {
      ...c[sec],
      [key]: val
    }
  }));
  const setGateField = (gateKey, field, val) => setCfg(c => ({
    ...c,
    supervisor: {
      ...c.supervisor,
      gates: {
        ...c.supervisor.gates,
        [gateKey]: {
          ...c.supervisor.gates[gateKey],
          [field]: val
        }
      }
    }
  }));
  const applyPreset = preset => {
    if (preset === "balanced") {
      setCfg(_types.DEFAULT_PROFILE_CONFIG);
      setMsg("پیش‌فرض استاندارد (رتبه ۱ مشهد/ترب + ناظر SystemOne با بازه ۴۵٪ و ۸۰٪) بارگذاری شد — ذخیره را بزنید.");
    } else if (preset === "aggressive_volume") {
      setCfg(c => ({
        ...c,
        margin: {
          ...c.margin,
          minPct: 2,
          minProfitAmountToman: 8000
        },
        rank1: {
          ...c.rank1,
          volumeMode: true,
          undercutAmount: 2000
        },
        discount: {
          ...c.discount,
          mode: "market_percentile_ceiling",
          marketUpperPercentile: 82,
          maxCeilingAboveMedianPct: 16,
          calibrateCeilingForExactFloor: true
        }
      }));
      setMsg("حالت «سود کم، فروش حداکثری» اعمال شد — دکمه ذخیره را بزنید.");
    } else if (preset === "high_discount_showcase") {
      setCfg(c => ({
        ...c,
        discount: {
          ...c.discount,
          mode: "highest_valid_seller",
          marketUpperPercentile: 90,
          maxCeilingAboveMedianPct: 22,
          minDiscountPct: 8,
          maxDiscountPct: 35,
          calibrateCeilingForExactFloor: true
        }
      }));
      setMsg("حالت «بیشترین درصد تخفیف معتبر از سقف بازار» اعمال شد — دکمه ذخیره را بزنید.");
    }
  };
  const save = (asNew = false) => start(async () => {
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: asNew ? undefined : selected,
        name: asNew ? `${name} (کپی)` : name,
        config: cfg,
        isDefault: !asNew && prof.isDefault
      })
    });
    setMsg(res.ok ? "✅ پروفایل با موفقیت ذخیره شد" : "❌ خطا در ذخیره");
    router.refresh();
  });
  return <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
        <div className="text-xs font-bold text-indigo-900">
          ⚡ سناریوهای آماده شخصی‌سازی موتور (کلیک کنید و سپس ذخیره را بزنید):
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => applyPreset("balanced")}>
            ۱. استاندارد متوازن (ناظر SystemOne ۴۵٪/۸۰٪ + سقف صدک ۸۵)
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={() => applyPreset("aggressive_volume")}>
            ۲. سود کم و فروش حداکثری (حداقل سود ۲٪)
          </button>
          <button type="button" className="btn-secondary text-xs" onClick={() => applyPreset("high_discount_showcase")}>
            ۳. سقف بالاترین فروشنده معتبر (تخفیف ویترینی جذاب‌تر)
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">پروفایل فعال</label>
          <select className="input" value={selected} onChange={e => pick(Number(e.target.value))}>
            {profiles.map(p => <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (پیش‌فرض)" : ""}
              </option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">نام پروفایل</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={pending} onClick={() => save(false)}>
          💾 ذخیره پروفایل
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => save(true)}>
          ➕ ذخیره به‌عنوان پروفایل جدید
        </button>
        {msg && <span className="text-xs font-medium text-indigo-700">{msg}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.keys(cfg).map(sec => <div key={sec} className={`card ${sec === "supervisor" ? "border-2 border-indigo-400 bg-indigo-50/25 md:col-span-2 xl:col-span-2" : sec === "discount" ? "border-2 border-emerald-300 bg-emerald-50/20" : ""}`}>
            <h3 className="mb-3 font-bold text-slate-800">{labels[sec] ?? sec}</h3>

            {sec === "supervisor" ? <div className="space-y-4">
                <p className="text-xs leading-5 text-slate-600">
                  این ناظر بالاسر (`SubQ SystemOne — subq-snap-preview`) فقط تصمیم‌گیرنده است: در ۴ مقیاس حیاتی امتیاز `noul` (`0%` تا `100%`) صادر می‌کند. به صورت پیش‌فرض اگر امتیاز <b>زیر ۴۵٪</b> باشد <b>رد کامل</b> می‌شود، اگر بین <b>۴۵٪ تا ۸۰٪</b> باشد به <b>بخش ریویو</b> می‌رود و اگر <b>۸۰٪ به بالا</b> باشد <b>خودکار تایید و اعمال</b> می‌گردد.
                </p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="label">وضعیت ناظر بالاسر</label>
                    <label className="inline-flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={cfg.supervisor.enabled} onChange={e => setField("supervisor", "enabled", e.target.checked)} />
                      <span>{cfg.supervisor.enabled ? "فعال (نظارت روی تمام مراحل)" : "غیرفعال"}</span>
                    </label>
                  </div>
                  <div>
                    <label className="label">حالت اجرای SystemOne</label>
                    <select className="input text-xs" value={cfg.supervisor.mode} onChange={e => setField("supervisor", "mode", e.target.value)}>
                      <option value="hybrid_subq_and_local">ترکیبی SubQ API + موتور آنی محلی (پیشنهادی)</option>
                      <option value="subq_api_only">فقط SubQ SystemOne API (`/v1/systemone`)</option>
                      <option value="local_instant_only">فقط موتور آنی محلی (بدون تاخیر شبکه)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">مدل SubQ (`model`)</label>
                    <input className="input text-xs" dir="ltr" value={cfg.supervisor.model} onChange={e => setField("supervisor", "model", e.target.value)} />
                  </div>
                  <div>
                    <label className="label text-rose-700 font-bold">آستانه سراسری رد کامل (٪)</label>
                    <input className="input num" type="number" min={5} max={90} value={cfg.supervisor.rejectBelowPct} onChange={e => setField("supervisor", "rejectBelowPct", Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label text-emerald-700 font-bold">آستانه سراسری تایید خودکار (٪)</label>
                    <input className="input num" type="number" min={20} max={99} value={cfg.supervisor.approveAbovePct} onChange={e => setField("supervisor", "approveAbovePct", Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label">آدرس سرور SubQ (`baseURL`)</label>
                    <input className="input text-xs" dir="ltr" value={cfg.supervisor.baseUrl} onChange={e => setField("supervisor", "baseUrl", e.target.value)} />
                  </div>
                </div>

                {/* جدول شخصی‌سازی هر یک از ۴ مقیاس ناظر */}
                <div className="rounded-xl border border-indigo-200 bg-white p-3">
                  <div className="mb-2 text-xs font-bold text-indigo-900">
                    🎯 شخصی‌سازی آستانه‌های تصمیم‌گیری در هر ۴ مقیاس (رد / ریویو / تایید خودکار):
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {Object.keys(cfg.supervisor.gates).map(gKey => {
                const g = cfg.supervisor.gates[gKey];
                return <div key={gKey} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                            <div className="mb-1.5 text-xs font-bold text-slate-800">{gateTitles[gKey] ?? gKey}</div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="label text-[11px] text-rose-700">رد زیر (٪)</label>
                                <input className="input num text-xs" type="number" min={5} max={90} value={g.rejectBelowPct} onChange={e => setGateField(gKey, "rejectBelowPct", Number(e.target.value))} />
                              </div>
                              <div>
                                <label className="label text-[11px] text-emerald-700">تایید بالای (٪)</label>
                                <input className="input num text-xs" type="number" min={20} max={99} value={g.approveAbovePct} onChange={e => setGateField(gKey, "approveAbovePct", Number(e.target.value))} />
                              </div>
                              <div>
                                <label className="label text-[11px]">وزن (0..1)</label>
                                <input className="input num text-xs" type="number" step={0.05} min={0.05} max={1} value={g.weight} onChange={e => setGateField(gKey, "weight", Number(e.target.value))} />
                              </div>
                            </div>
                          </div>;
              })}
                  </div>
                </div>
              </div> : <div className="space-y-2.5">
                {Object.entries(cfg[sec]).map(([k, v]) => <div key={k}>
                    <label className="label">{labels[k] ?? k}</label>
                    {typeof v === "boolean" ? <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={v} onChange={e => setField(sec, k, e.target.checked)} />
                        <span>{v ? "فعال" : "غیرفعال"}</span>
                      </label> : Array.isArray(v) ? <input className="input" value={v.join(",")} onChange={e => setField(sec, k, e.target.value.split(",").map(s => s.trim()).filter(Boolean))} /> : selectOptions[k] ? <select className="input" value={String(v)} onChange={e => setField(sec, k, e.target.value)}>
                        {selectOptions[k].map(o => <option key={o.value} value={o.value}>
                            {o.label}
                          </option>)}
                      </select> : typeof v === "string" ? <input className="input" value={v} onChange={e => setField(sec, k, e.target.value)} /> : <input className="input num" type="number" step="any" value={v} onChange={e => setField(sec, k, Number(e.target.value))} />}
                  </div>)}
              </div>}
          </div>)}
      </div>
    </div>;
}

/* ---------------- هوش مصنوعی و توکن‌های API ---------------- */

function sourceLabel(source) {
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
  keyPlaceholder
}) {
  return <div className={`card ${status.configured ? "border-emerald-300" : "border-amber-300"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {status.configured ? <span className="badge bg-emerald-100 text-emerald-700">توکن ثبت شده</span> : <span className="badge bg-amber-100 text-amber-700">بدون توکن</span>}
      </div>
      <p className="mb-3 text-xs leading-5 text-slate-500">{desc}</p>
      <div className="mb-3 space-y-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
        <div>
          منبع: <b>{sourceLabel(status.source)}</b>
          {status.apiKeyHint && <>
              {" "}
              · توکن فعلی: <code dir="ltr">{status.apiKeyHint}</code>
            </>}
        </div>
        <div>
          آدرس مؤثر: <code dir="ltr">{status.baseUrl}</code> · مدل مؤثر: <code dir="ltr">{status.model}</code>
        </div>
      </div>
      <div className="space-y-2">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" checked={draft.enabled} onChange={e => onChange({
          ...draft,
          enabled: e.target.checked
        })} />
          <span>{draft.enabled ? "فعال" : "غیرفعال"}</span>
        </label>
        <div>
          <label className="label">توکن API (خالی بگذارید تا تغییر نکند)</label>
          <input className="input" dir="ltr" type="password" autoComplete="off" placeholder={status.apiKeyHint || keyPlaceholder} value={draft.apiKey} onChange={e => onChange({
          ...draft,
          apiKey: e.target.value
        })} />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <label className="label">آدرس سرور (Base URL)</label>
            <input className="input text-xs" dir="ltr" value={draft.baseUrl} onChange={e => onChange({
            ...draft,
            baseUrl: e.target.value
          })} />
          </div>
          <div>
            <label className="label">مدل</label>
            <input className="input text-xs" dir="ltr" value={draft.model} onChange={e => onChange({
            ...draft,
            model: e.target.value
          })} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={pending} onClick={onSave}>
          💾 ذخیره
        </button>
        <button className="btn-secondary" disabled={pending} onClick={onTest}>
          🔌 تست اتصال زنده
        </button>
        <button className="btn-danger" disabled={pending || status.source !== "db"} onClick={onClear}>
          پاک‌کردن توکن ذخیره‌شده
        </button>
      </div>
    </div>;
}
function AISettingsPanel({
  initial
}) {
  const router = (0, _navigation.useRouter)();
  const [pending, start] = (0, _react.useTransition)();
  const [status, setStatus] = (0, _react.useState)(initial);
  const [msg, setMsg] = (0, _react.useState)(null);
  const [ai, setAi] = (0, _react.useState)({
    enabled: initial.ai.enabled,
    apiKey: "",
    baseUrl: initial.ai.baseUrl,
    model: initial.ai.model
  });
  const [subq, setSubq] = (0, _react.useState)({
    enabled: initial.subq.enabled,
    apiKey: "",
    baseUrl: initial.subq.baseUrl,
    model: initial.subq.model
  });
  const call = (provider, action, draft) => start(async () => {
    setMsg(null);
    const payload = action === "clear" ? {
      provider,
      action: "save",
      clearApiKey: true
    } : action === "test" ? {
      provider,
      action,
      apiKey: draft.apiKey || undefined,
      baseUrl: draft.baseUrl,
      model: draft.model,
      enabled: draft.enabled
    } : {
      provider,
      action,
      apiKey: draft.apiKey || undefined,
      baseUrl: draft.baseUrl,
      model: draft.model,
      enabled: draft.enabled
    };
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg({
        ok: false,
        text: data?.error ?? "خطا در ارتباط با سرور"
      });
      return;
    }
    if (data?.all) setStatus(data.all);
    if (action === "test") setMsg({
      ok: Boolean(data?.ok),
      text: data?.message ?? "—"
    });else if (action === "clear") setMsg({
      ok: true,
      text: "توکن ذخیره‌شده پاک شد؛ در صورت وجود، مقدار .env جایگزین می‌شود"
    });else setMsg({
      ok: true,
      text: "پیکربندی با موفقیت در دیتابیس ذخیره شد"
    });
    setAi(s => ({
      ...s,
      apiKey: ""
    }));
    setSubq(s => ({
      ...s,
      apiKey: ""
    }));
    router.refresh();
  });
  return <div className="space-y-3">
      {msg && <div className={`rounded-lg border p-2 text-xs font-medium ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
          {msg.ok ? "✅ " : "❌ "}
          {msg.text}
        </div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderCard title="هوش مصنوعی مکمل (OpenAI-compatible)" desc="برای استخراج پیشنهادها از HTML، نظر دوم روی تصمیم‌های کم‌اعتماد و تأیید تطابق کالا. با هر سرویس سازگار با OpenAI (OpenAI, OpenRouter, Groq, Ollama و ...) کار می‌کند." status={status.ai} draft={ai} onChange={setAi} onSave={() => call("ai", "save", ai)} onTest={() => call("ai", "test", ai)} onClear={() => call("ai", "clear", ai)} pending={pending} keyPlaceholder="sk-..." />
        <ProviderCard title="ناظر و تصمیم‌گیرنده بالاسر SubQ SystemOne" desc="تصمیم‌گیرنده اصلی موتور (قانون ۳ بازه‌ای رد/ریویو/تأیید خودکار). توکن از این‌جا در دیتابیس ذخیره می‌شود و همان لحظه در همه استعلام‌ها (اجرای زمان‌بندی، دستی و API) استفاده می‌شود." status={status.subq} draft={subq} onChange={setSubq} onSave={() => call("subq", "save", subq)} onTest={() => call("subq", "test", subq)} onClear={() => call("subq", "clear", subq)} pending={pending} keyPlaceholder="SUBQ_API_KEY" />
      </div>
    </div>;
}

/* ---------------- زمان‌بندی ---------------- */
function ScheduleEditor({
  items
}) {
  const router = (0, _navigation.useRouter)();
  const [pending, start] = (0, _react.useTransition)();
  const [draft, setDraft] = (0, _react.useState)({
    name: "",
    intervalMinutes: 180,
    category: ""
  });
  const call = (body, method = "POST") => start(async () => {
    await fetch("/api/schedules", {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    router.refresh();
  });
  return <div className="space-y-3">
      <table className="data">
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
          {items.map(s => <tr key={s.id}>
              <td>{s.name}</td>
              <td className="num">{s.intervalMinutes}</td>
              <td className="text-xs">{s.filter?.category ? `دسته: ${s.filter.category}` : "همه محصولات"}</td>
              <td className="text-xs">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—"}</td>
              <td className="text-xs">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—"}</td>
              <td>
                <input type="checkbox" checked={s.active} onChange={e => call({
              id: s.id,
              name: s.name,
              intervalMinutes: s.intervalMinutes,
              category: s.filter?.category,
              active: e.target.checked
            })} />
              </td>
              <td>
                <button className="btn-danger" disabled={pending} onClick={() => call({
              id: s.id
            }, "DELETE")}>
                  حذف
                </button>
              </td>
            </tr>)}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">نام</label>
          <input className="input" value={draft.name} onChange={e => setDraft({
          ...draft,
          name: e.target.value
        })} />
        </div>
        <div>
          <label className="label">هر چند دقیقه</label>
          <input className="input num" type="number" value={draft.intervalMinutes} onChange={e => setDraft({
          ...draft,
          intervalMinutes: Number(e.target.value)
        })} />
        </div>
        <div>
          <label className="label">فقط دسته (اختیاری)</label>
          <input className="input" value={draft.category} onChange={e => setDraft({
          ...draft,
          category: e.target.value
        })} />
        </div>
        <button className="btn-primary" disabled={pending || !draft.name} onClick={() => call(draft)}>
          افزودن زمان‌بندی
        </button>
      </div>
    </div>;
}

/* ---------------- کانکتور فروشگاه ---------------- */
function ConnectorEditor({
  items
}) {
  const router = (0, _navigation.useRouter)();
  const [pending, start] = (0, _react.useTransition)();
  const [drafts, setDrafts] = (0, _react.useState)(items.map(c => ({
    ...c
  })));
  const save = (c, active) => start(async () => {
    await fetch("/api/connectors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: c.id,
        config: c.config,
        active: active ?? c.active
      })
    });
    router.refresh();
  });
  return <div className="grid gap-4 md:grid-cols-3">
      {drafts.map((c, i) => <div key={c.id} className={`card ${c.active ? "border-emerald-300" : ""}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-bold">{c.name}</h3>
            {c.active ? <span className="badge bg-emerald-100 text-emerald-700">فعال</span> : <span className="badge bg-slate-100 text-slate-600">غیرفعال</span>}
          </div>
          <div className="space-y-2">
            {Object.entries(c.config).map(([k, v]) => <div key={k}>
                <label className="label">{k}</label>
                <input className="input" dir="ltr" value={v} onChange={e => setDrafts(d => d.map((x, j) => j === i ? {
            ...x,
            config: {
              ...x.config,
              [k]: e.target.value
            }
          } : x))} />
              </div>)}
          </div>
          {c.lastError && <p className="mt-2 text-xs text-rose-600">آخرین خطا: {c.lastError}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" disabled={pending} onClick={() => save(c)}>
              ذخیره
            </button>
            <button className="btn-secondary" disabled={pending} onClick={() => save(c, !c.active)}>
              {c.active ? "غیرفعال کردن" : "فعال کردن"}
            </button>
          </div>
        </div>)}
    </div>;
}