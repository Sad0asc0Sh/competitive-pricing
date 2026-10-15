"use client";

import { badgeThemeLabel, campaignLabel, strategyLabel } from "@/lib/format";
import type { CeilingDiscoveryMode, PricingResult, SgeoooleBadgeTheme, SgeoooleCampaignType } from "@/lib/pricing/types";
import { useState } from "react";

export default function SimulatePage() {
  const [productName, setProductName] = useState("");
  const [torobTitle, setTorobTitle] = useState("");
  const [colleaguesText, setColleaguesText] = useState("");
  const [offersText, setOffersText] = useState("");
  const [cost, setCost] = useState(0);
  const [minMargin, setMinMargin] = useState(3);
  const [current, setCurrent] = useState<string>("");
  const [sellers, setSellers] = useState(0);

  // آستانه‌های ناظر بالاسر SubQ SystemOne (پیش‌فرض: زیر 45% رد، 45 تا 80% ریویو، 80% به بالا تایید خودکار)
  const [rejectBelowPct, setRejectBelowPct] = useState(45);
  const [approveAbovePct, setApproveAbovePct] = useState(80);

  // پارامترهای شخصی‌سازی زنده کف و سقف بازار و ۳ سیستم تخفیف
  const [ceilingMode, setCeilingMode] = useState<CeilingDiscoveryMode>("market_percentile_ceiling");
  const [upperPercentile, setUpperPercentile] = useState(85);
  const [maxCeilingAboveMedianPct, setMaxCeilingAboveMedianPct] = useState(18);
  const [minDiscountPct, setMinDiscountPct] = useState(5);
  const [maxDiscountPct, setMaxDiscountPct] = useState(35);
  const [calibrateExact, setCalibrateExact] = useState(true);

  // پیش‌نمایش کارت در یکی از ۳ سیستم تخفیف sgeooole
  const [previewCampaign, setPreviewCampaign] = useState<SgeoooleCampaignType>("timed_sale");
  const [previewCampaignName, setPreviewCampaignName] = useState("فروش ویژه مشهد");
  const [previewTheme, setPreviewTheme] = useState<SgeoooleBadgeTheme>("green-orange");
  const [previewFeatured, setPreviewFeatured] = useState(true);

  const [res, setRes] = useState<PricingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (forceCostless = false, overrideTorobTitle?: string) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    if (!productName.trim()) {
      setErr("نام محصول الزامی است (سیستم واقعی بدون داده ساختگی کار می‌کند).");
      setBusy(false);
      return;
    }
    const offers = offersText
      .split("\n")
      .map((l) => l.split(",").map((s) => s.trim()))
      .filter((p) => p.length >= 2 && Number(p[1]) > 0)
      .map((p) => ({
        shopName: p[0],
        price: Number(p[1]),
        shopCity: p[2] || "تهران",
        lastChangedDaysAgo: p[3] ? Number(p[3]) : 0,
        sellerType: p[4] === "in_person" ? ("in_person" as const) : ("online" as const),
        isAd: p[4] === "ad",
        inStock: p[4] !== "out",
        priceUnreliable: p[4] === "unreliable",
        shopScore: p[5] ? Number(p[5]) : 4.5,
      }));

    const r = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName,
        torobTitle: overrideTorobTitle ?? torobTitle,
        costPrice: forceCostless ? 0 : cost,
        minMarginPct: minMargin,
        colleagueListText: forceCostless ? "" : colleaguesText,
        currentFinalPrice: current ? Number(current) : null,
        totalSellerCount: sellers,
        config: {
          discount: {
            mode: ceilingMode,
            basePriceMode: ceilingMode === "markup" ? "markup" : "market_upper",
            marketUpperPercentile: upperPercentile,
            maxCeilingAboveMedianPct,
            minDiscountPct,
            maxDiscountPct,
            calibrateCeilingForExactFloor: calibrateExact,
            markupPct: 14,
          },
          supervisor: {
            enabled: true,
            rejectBelowPct,
            approveAbovePct,
            strictGateVeto: true,
            gates: {
              identity_match: { rejectBelowPct, approveAbovePct, weight: 0.3 },
              market_data_integrity: { rejectBelowPct, approveAbovePct, weight: 0.25 },
              profit_and_rank_safety: { rejectBelowPct, approveAbovePct, weight: 0.3 },
              ceiling_discount_validity: { rejectBelowPct, approveAbovePct, weight: 0.15 },
            },
          },
        },
        offers,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error ?? "خطا در شبیه‌سازی");
    } else {
      setRes(j as PricingResult);
    }
    setBusy(false);
  };

  const t = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("fa-IR"));

  const themeBadgeStyles: Record<string, string> = {
    "green-orange": "bg-gradient-to-r from-emerald-600 to-orange-500 text-white",
    "gold-red": "bg-gradient-to-r from-amber-500 to-rose-600 text-white",
    "red-purple": "bg-gradient-to-r from-rose-600 to-purple-700 text-white",
  };

  const verdictStyle: Record<string, string> = {
    approve: "bg-emerald-100 text-emerald-900 border-emerald-300",
    review: "bg-amber-100 text-amber-900 border-amber-300",
    reject: "bg-rose-100 text-rose-900 border-rose-300",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          آزمایشگاه زنده ناظر بالاسر SubQ SystemOne، کشف کف و سقف بازار و شبیه‌ساز ۳ سیستم تخفیف
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          در این محیط می‌توانید آستانه‌های ۳ بازه‌ای <b>ناظر و تصمیم‌گیرنده بالاسر (`SubQ SystemOne — subq-snap-preview`)</b> را شخصی‌سازی کنید (مثلاً <b>زیر ۴۵٪ رد کامل</b>، <b>۴۵٪ تا ۸۰٪ ارسال به ریویو</b> و <b>۸۰٪ به بالا تایید خودکار و ادامه کار</b>) و رفتار آن را روی ورودی ترب، کف و سقف بازار و هر ۳ سیستم تخفیف تست نمایید.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* ستون تنظیمات و داده‌های ورودی */}
        <div className="card space-y-4 lg:col-span-5">
          {/* پنل ناظر بالاسر SubQ SystemOne و تست گیت ورودی */}
          <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950">
                🛡️ ناظر و تصمیم‌گیرنده بالاسر (`SubQ SystemOne — noul`)
              </span>
              <span className="badge bg-indigo-200 text-indigo-900 font-mono text-[10px]">
                subq-snap-preview
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="label text-rose-700 font-bold">رد کامل زیر (٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={5}
                  max={90}
                  value={rejectBelowPct}
                  onChange={(e) => setRejectBelowPct(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label text-emerald-700 font-bold">تایید خودکار بالای (٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={20}
                  max={99}
                  value={approveAbovePct}
                  onChange={(e) => setApproveAbovePct(Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <label className="label">نام محصول در سایت ما (`sgeooole`)</label>
                <input
                  className="input text-xs"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <label className="label">عنوان کارت پیدا شده در ورودی ترب (برای تست گیت ۱)</label>
                  <button
                    type="button"
                    className="text-[11px] text-rose-600 hover:underline"
                    onClick={() => {
                      const bad = "پایه و کاور دوربین مداربسته داهوا مدل HFW1230S";
                      setTorobTitle(bad);
                      run(false, bad);
                    }}
                  >
                    تست ورودی اشتباه (پایه دوربین → رد زیر ۴۵٪)
                  </button>
                </div>
                <input
                  className="input text-xs"
                  value={torobTitle}
                  onChange={(e) => setTorobTitle(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label font-bold text-indigo-700">
                ۱. لیست قیمت همکاران (خالی = کشف خودکار کف امن از ترب)
              </label>
              <button
                type="button"
                className="text-xs text-indigo-600 hover:underline"
                onClick={() => {
                  setColleaguesText("");
                  setCost(0);
                }}
              >
                پاک کردن لیست (تست بدون قیمت خرید)
              </button>
            </div>
            <textarea
              className="input h-20 font-mono text-xs"
              dir="ltr"
              value={colleaguesText}
              onChange={(e) => setColleaguesText(e.target.value)}
              placeholder={"نام همکار, قیمت خرید (تومان), شهر, اولویت 1-10, in|out"}
            />
          </div>

          <div>
            <label className="label font-bold text-emerald-700">
              ۲. پیشنهادهای رقبا در ترب (شامل قیمت‌های پرت و رقبای مشهد/تهران/بانه)
            </label>
            <textarea
              className="input h-32 font-mono text-xs"
              dir="ltr"
              value={offersText}
              onChange={(e) => setOffersText(e.target.value)}
              placeholder={"نام فروشگاه, قیمت (تومان), شهر, روزهای گذشته از آخرین تغییر, online|in_person, امتیاز فروشگاه"}
            />
          </div>

          {/* پنل شخصی‌سازی فرمول کشف سقف و کف */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2.5">
            <div className="text-xs font-bold text-emerald-900">
              🎛️ شخصی‌سازی موتور کشف «سقف معیار تخفیف» و اعمال روی «کف»
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="label">روش کشف سقف قیمت بازار (معیار تخفیف)</label>
                <select
                  className="input text-xs font-medium"
                  value={ceilingMode}
                  onChange={(e) => setCeilingMode(e.target.value as CeilingDiscoveryMode)}
                >
                  <option value="market_percentile_ceiling">
                    صدک بالای بازار تحت رصد (حذف کامل پرت‌ها — پیشنهادی)
                  </option>
                  <option value="highest_valid_seller">
                    بالاترین فروشنده معتبر بازار (محصور در سپر ضدپرت)
                  </option>
                  <option value="trimmed_upper_cluster">
                    میانگین نیمه بالایی فروشندگان معتبر بازار
                  </option>
                  <option value="markup">افزایش درصدی ثابت روی کف هدف (Markup)</option>
                </select>
              </div>
              <div>
                <label className="label">صدک سقف بازار ({upperPercentile}٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={55}
                  max={98}
                  value={upperPercentile}
                  onChange={(e) => setUpperPercentile(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">سپر ضدپرت بالای میانه ({maxCeilingAboveMedianPct}٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={5}
                  max={50}
                  value={maxCeilingAboveMedianPct}
                  onChange={(e) => setMaxCeilingAboveMedianPct(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">حداقل تخفیف نمایشی (٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={1}
                  max={50}
                  value={minDiscountPct}
                  onChange={(e) => setMinDiscountPct(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">حداکثر تخفیف نمایشی (٪)</label>
                <input
                  className="input num"
                  type="number"
                  min={5}
                  max={80}
                  value={maxDiscountPct}
                  onChange={(e) => setMaxDiscountPct(Number(e.target.value))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-emerald-900">
              <input
                type="checkbox"
                checked={calibrateExact}
                onChange={(e) => setCalibrateExact(e.target.checked)}
              />
              کالیبراسیون دقیق سقف تا با درصد تخفیف صحیح، خروجی دقیقاً روی کف بنشیند
            </label>
          </div>

          {/* پنل شخصی‌سازی پیش‌نمایش در ۳ سیستم تخفیف */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
            <div className="text-xs font-bold text-indigo-900">
              🏷️ پیش‌نمایش کارت در ۳ سیستم تخفیف sgeooole
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">سیستم تخفیف</label>
                <select
                  className="input text-xs"
                  value={previewCampaign}
                  onChange={(e) => {
                    const next = e.target.value as SgeoooleCampaignType;
                    setPreviewCampaign(next);
                    setPreviewTheme(
                      next === "flash" ? "gold-red" : next === "featured" ? "red-purple" : "green-orange",
                    );
                  }}
                >
                  <option value="flash">پیشنهاد لحظه‌ای (صفحه اصلی)</option>
                  <option value="featured">پیشنهاد شگفت‌انگیز (صفحه اصلی)</option>
                  <option value="timed_sale">فرصت زمان‌دار (مالی و تخفیف / منتخب‌ها)</option>
                </select>
              </div>
              <div>
                <label className="label">تم رنگی نشان (Badge Theme)</label>
                <select
                  className="input text-xs"
                  value={previewTheme}
                  onChange={(e) => setPreviewTheme(e.target.value as SgeoooleBadgeTheme)}
                >
                  <option value="green-orange">سبز - نارنجی</option>
                  <option value="gold-red">طلایی - قرمز</option>
                  <option value="red-purple">قرمز - بنفش</option>
                </select>
              </div>
              <div>
                <label className="label">عنوان برچسب کمپین</label>
                <input
                  className="input text-xs"
                  value={previewCampaignName}
                  onChange={(e) => setPreviewCampaignName(e.target.value)}
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-indigo-900">
                  <input
                    type="checkbox"
                    checked={previewFeatured}
                    onChange={(e) => setPreviewFeatured(e.target.checked)}
                  />
                  نمایش در منتخب‌های صفحه اصلی
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="label">قیمت خرید دستی</label>
              <input
                className="input num"
                type="number"
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">حداقل سود (٪)</label>
              <input
                className="input num"
                type="number"
                step="0.5"
                value={minMargin}
                onChange={(e) => setMinMargin(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">قیمت فعلی</label>
              <input
                className="input num"
                type="number"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div>
              <label className="label">تعداد فروشنده</label>
              <input
                className="input num"
                type="number"
                value={sellers}
                onChange={(e) => setSellers(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1" disabled={busy} onClick={() => run(false)}>
              {busy ? "در حال بررسی ناظر و محاسبه…" : "🔍 اجرای ناظر SystemOne و محاسبه کف و سقف"}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => run(true)}>
              تست بدون قیمت خرید
            </button>
          </div>
        </div>

        {/* ستون خروجی بصری: کارت ناظر بالاسر SubQ SystemOne + نوار طیف بازار + پیش‌نمایش کارت */}
        <div className="card lg:col-span-7">
          {err && <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>}
          {!res && !err && (
            <div className="flex h-64 flex-col items-center justify-center text-center text-slate-400">
              <p className="text-sm font-medium">
                روی دکمه «اجرای ناظر SystemOne و محاسبه کف و سقف» کلیک کنید تا نتیجه تصمیم‌گیری ۴ مقیاسی و کارت محصول نمایش داده شود.
              </p>
            </div>
          )}

          {res && (
            <div className="space-y-5">
              {/* ۰. داشبورد ناظر و تصمیم‌گیرنده بالاسر SubQ SystemOne (قانون ۳ بازه‌ای ۰..۴۵..۸۰..۱۰۰٪) */}
              {res.supervisor && (
                <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-indigo-950">
                        🛡️ حکم ناظر بالاسر SubQ SystemOne (`{res.supervisor.model}`)
                      </div>
                      <div className="text-xs text-slate-600">
                        قانون ۳ بازه‌ای فعال: <b>زیر {res.supervisor.rejectBelowPct}٪ رد کامل</b> ·{" "}
                        <b>{res.supervisor.rejectBelowPct}٪ تا {res.supervisor.approveAbovePct}٪ ارسال به ریویو</b> ·{" "}
                        <b>بالای {res.supervisor.approveAbovePct}٪ تایید و ادامه خودکار</b>
                      </div>
                    </div>
                    <div className={`badge border px-3 py-1 text-xs font-bold ${verdictStyle[res.supervisor.verdict]}`}>
                      noul: {res.supervisor.overallNoul.toFixed(2)} ({res.supervisor.overallScorePct}٪) →{" "}
                      {res.supervisor.verdict === "approve"
                        ? "✅ تایید و ادامه خودکار"
                        : res.supervisor.verdict === "review"
                          ? "⏳ ارسال به بخش ریویو"
                          : "⛔ رد کامل و توقف"}
                    </div>
                  </div>

                  {/* ۴ مقیاس تصمیم‌گیری ناظر */}
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {Object.values(res.supervisor.gates).map((g) => (
                      <div key={g.key} className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">{g.title}</span>
                          <span className={`badge border font-mono ${verdictStyle[g.verdict]}`}>
                            {g.scorePct}٪ (noul={g.noul.toFixed(2)})
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full ${
                              g.verdict === "approve"
                                ? "bg-emerald-500"
                                : g.verdict === "review"
                                  ? "bg-amber-500"
                                  : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(4, g.scorePct))}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">{g.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ۱. نوار بصری کف و سقف بازار تحت رصد + پیش‌نمایش زنده کارت محصول در sgeooole */}
              <div className="grid gap-4 md:grid-cols-12">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-7 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      📊 رادار کف و سقف بازار تحت رصد (بدون قیمت‌های پرت ترب)
                    </span>
                    <span className="badge bg-emerald-100 text-emerald-800">
                      {res.floorCeiling?.monitoredSellersCount ?? res.offersUsed} فروشنده معتبر رصد شد ·{" "}
                      {res.floorCeiling?.excludedOutliersCount ?? 0} پرت حذف شد
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>خط قرمز تامین: <b className="num text-amber-800">{t(res.supply?.hardFloorPrice)}</b></span>
                      <span>میانه بازار: <b className="num text-slate-800">{t(res.floorCeiling?.monitoredMarketMedian ?? res.marketMedian)}</b></span>
                      <span>سقف واقعی رصدشده: <b className="num text-indigo-800">{t(res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice)}</b></span>
                    </div>
                    <div className="relative h-4 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-gradient-to-l from-indigo-500 via-emerald-500 to-amber-500"
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="rounded-lg bg-white p-2.5 border border-slate-200 text-xs leading-5 text-slate-700">
                      <div>
                        <b>معادله دقیق سقف به کف در sgeooole:</b>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-indigo-900" dir="ltr">
                        Math.round({res.basePrice?.toLocaleString()} × (1 - {res.discountPct}% / 100)) ={" "}
                        {res.floorCeiling?.exactFloorRestored?.toLocaleString() ?? res.finalPrice?.toLocaleString()} Toman
                      </div>
                    </div>
                  </div>
                </div>

                {/* پیش‌نمایش زنده کارت محصول در صفحه اصلی / منتخب‌های sgeooole */}
                <div className="rounded-xl border-2 border-indigo-200 bg-white p-4 shadow-sm md:col-span-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${themeBadgeStyles[previewTheme]}`}>
                      {previewCampaign === "flash"
                        ? "⚡ پیشنهاد لحظه‌ای"
                        : previewCampaign === "featured"
                          ? "🔥 پیشنهاد شگفت‌انگیز"
                          : `⏱️ ${previewCampaignName}`}
                    </span>
                    <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold text-white num">
                      {res.discountPct ?? 0}٪ تخفیف
                    </span>
                  </div>

                  <div className="my-3">
                    <div className="text-xs font-bold text-slate-800">{productName}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {campaignLabel[previewCampaign]} · تم {badgeThemeLabel[previewTheme]}
                      {previewFeatured ? " · ★ در منتخب‌های صفحه اصلی" : ""}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-2 flex items-end justify-between">
                    <div>
                      <div className="text-[11px] text-slate-400">سقف معیار بازار (خط‌خورده):</div>
                      <div className="num text-xs text-slate-400 line-through">{t(res.basePrice)} تومان</div>
                    </div>
                    <div className="text-left">
                      <div className="text-[11px] font-medium text-emerald-700">کف قطعی پس از کسر {res.discountPct}٪:</div>
                      <div className="num text-base font-extrabold text-emerald-700">{t(res.finalPrice)} تومان</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ۲. شاخص‌های ۱۲ گانه تصمیم‌گیری */}
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <K
                  k={res.supply?.usedMarketConsensusFloor ? "خرید تخمینی امن (از ترب)" : "تمام‌شده همکار منتخب"}
                  v={t(res.supply?.effectiveCostPrice)}
                />
                <K
                  k={res.supply?.usedMarketConsensusFloor ? "کف امن ضدضرر بازار" : "خط قرمز فروش (کف سود)"}
                  v={t(res.supply?.hardFloorPrice)}
                  warn
                />
                <K k="کف معتبر بازار تحت رصد" v={t(res.floorCeiling?.monitoredMarketFloor ?? res.lowestValid)} />
                <K k="سقف واقعی بازار تحت رصد" v={t(res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice)} />
                <K k="قیمت سقف معیار (خط‌خورده)" v={t(res.basePrice)} highlight />
                <K k="قیمت کف قطعی فروش ما" v={t(res.finalPrice)} strong />
                <K
                  k="رتبه ما در مشهد"
                  v={res.position?.projectedLocalRank ? `#${res.position.projectedLocalRank}` : "—"}
                  highlight
                />
                <K
                  k="رتبه ما در کل ترب"
                  v={
                    res.position?.projectedNationalRank
                      ? `#${res.position.projectedNationalRank} از ${res.position.totalNationalValidSellers}`
                      : "—"
                  }
                  highlight
                />
                <K
                  k="حاشیه سود / ایمنی"
                  v={`${t(res.position?.netProfitToman)} (${res.position?.netMarginPct ?? 0}٪)`}
                  strong
                />
                <K k="درصد تخفیف (سقف به کف)" v={res.discountPct != null ? `${res.discountPct}٪` : "—"} />
                <K k="استراتژی کشف کف" v={strategyLabel[res.strategy] ?? res.strategy} />
                <K
                  k="حکم ناظر SystemOne"
                  v={
                    res.rejectedBySupervisor
                      ? `⛔ رد کامل (${res.supervisor?.overallScorePct}٪)`
                      : res.needsReview
                        ? `⏳ ریویو (${res.supervisor?.overallScorePct}٪)`
                        : `✅ تایید خودکار (${res.supervisor?.overallScorePct}٪)`
                  }
                />
              </div>

              {/* ۳. گام‌های کامل تصمیم‌گیری */}
              <ol className="space-y-1">
                {res.steps.map((s, i) => (
                  <li
                    key={i}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      s.level === "warn" ? "bg-amber-50" : s.level === "error" ? "bg-rose-50" : "bg-slate-50"
                    }`}
                  >
                    <b>{s.title}:</b> {s.message}
                  </li>
                ))}
              </ol>

              {/* ۴. جدول پیشنهادهای ترب */}
              <table className="data">
                <thead>
                  <tr>
                    <th>فروشگاه</th>
                    <th>شهر</th>
                    <th>قیمت</th>
                    <th>امتیاز</th>
                    <th>وضعیت در رادار کف و سقف</th>
                  </tr>
                </thead>
                <tbody>
                  {[...res.offers]
                    .sort((a, b) => a.price - b.price)
                    .map((o, i) => (
                      <tr key={i} className={o.included ? "" : "text-slate-400"}>
                        <td>
                          {o.shopName}
                          {o.sellerType === "in_person" && (
                            <span className="badge mr-1 bg-sky-100 text-sky-700">حضوری</span>
                          )}
                        </td>
                        <td>
                          <span className={o.isLocalCity ? "font-bold text-indigo-700" : ""}>
                            {o.shopCity ?? "—"}
                          </span>
                        </td>
                        <td className={`num ${o.included ? "font-medium" : "line-through"}`}>{t(o.price)}</td>
                        <td className="num text-xs">{o.shopScore ?? "—"}</td>
                        <td className="text-xs">
                          {o.included ? (
                            <span className="badge bg-emerald-100 text-emerald-800">بازار معتبر تحت رصد</span>
                          ) : (
                            <span className="badge bg-rose-100 text-rose-700">حذف‌شده ({o.excludeReason})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function K({
  k,
  v,
  strong,
  warn,
  highlight,
}: {
  k: string;
  v: string;
  strong?: boolean;
  warn?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${
        highlight
          ? "bg-indigo-50 border border-indigo-200"
          : warn
            ? "bg-amber-50 border border-amber-200"
            : "bg-slate-50"
      }`}
    >
      <div className="text-xs text-slate-500">{k}</div>
      <div
        className={`num ${
          strong
            ? "font-bold text-emerald-700"
            : highlight
              ? "font-bold text-indigo-800"
              : warn
                ? "font-bold text-amber-800"
                : "font-medium"
        }`}
      >
        {v}
      </div>
    </div>
  );
}
