"use client";

import { IconSpinner } from "@/components/icons";
import { CollapsibleSection, SegmentedTabs, Switch, useToast } from "@/components/ui";
import { badgeThemeLabel, campaignLabel, faNum, strategyLabel } from "@/lib/format";
import type { CeilingDiscoveryMode, PricingResult, SgeoooleBadgeTheme, SgeoooleCampaignType } from "@/lib/pricing/types";
import { useEffect, useMemo, useState } from "react";

const SAMPLE_COLLEAGUES = [
  "پخش شرق مشهد, 2320000, مشهد, 9, in",
  "همکار لاله‌زار تهران, 2295000, تهران, 7, in",
].join("\n");

const SAMPLE_OFFERS = [
  "شرق دیجیتال مشهد, 2460000, مشهد, 0, online, 4.9",
  "پاساژ تک مشهد, 2475000, مشهد, 1, in_person, 4.8",
  "تکنولایف, 2480000, تهران, 0, online, 4.9",
  "کالاتیک, 2520000, تهران, 1, online, 4.8",
  "دیجی‌کالا, 2650000, تهران, 0, online, 4.8",
  "گران‌فروش پرت ترب, 3850000, تهران, 5, online, 4.1",
].join("\n");

interface StoreProductItem {
  id: number;
  sku: string;
  name: string;
  costPrice: number;
  currentFinalPrice: number | null;
}

type SimTab = "inputs" | "results";

export default function SimulatePage() {
  const toast = useToast();
  const [mobileTab, setMobileTab] = useState<SimTab>("inputs");
  const [storeProducts, setStoreProducts] = useState<StoreProductItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productName, setProductName] = useState("دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل");
  const [torobTitle, setTorobTitle] = useState("دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5 ظرفیت 2 مگاپیکسل");
  const [colleaguesText, setColleaguesText] = useState(SAMPLE_COLLEAGUES);
  const [offersText, setOffersText] = useState(SAMPLE_OFFERS);
  const [cost, setCost] = useState(2320000);
  const [minMargin, setMinMargin] = useState(3);
  const [current, setCurrent] = useState<string>("2490000");
  const [sellers, setSellers] = useState(14);

  // آستانه‌های ناظر بالاسر SubQ SystemOne
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
  const [previewCampaign, setPreviewCampaign] = useState<SgeoooleCampaignType>("featured");
  const [previewCampaignName, setPreviewCampaignName] = useState("پیشنهاد شگفت‌انگیز مشهد");
  const [previewTheme, setPreviewTheme] = useState<SgeoooleBadgeTheme>("red-purple");
  const [previewFeatured, setPreviewFeatured] = useState(true);

  const [res, setRes] = useState<PricingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) setStoreProducts(rows);
      })
      .catch(() => undefined);
  }, []);

  const parseOffersFromText = (txt: string) =>
    txt
      .split("\n")
      .map((l) => l.split(",").map((s) => s.trim()))
      .filter((p) => p.length >= 2 && Number(p[1]) > 0)
      .map((p) => {
        const days = p[3] ? Number(p[3]) : NaN;
        const score = p[5] ? Number(p[5]) : NaN;
        return {
          shopName: p[0],
          price: Number(p[1]),
          shopCity: p[2] || null,
          lastChangedDaysAgo: Number.isFinite(days) ? days : null,
          sellerType: p[4] === "in_person" ? ("in_person" as const) : ("online" as const),
          isAd: p[4] === "ad",
          inStock: p[4] !== "out",
          priceUnreliable: p[4] === "unreliable",
          shopScore: Number.isFinite(score) ? score : null,
        };
      });

  const run = async (forceCostless = false, overrideTorobTitle?: string) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    const effectiveProductName = productName.trim() || "دوربین مداربسته تحت شبکه داهوا مدل DH-IPC-HFW1230S-S5";
    if (!productName.trim()) {
      setProductName(effectiveProductName);
    }

    let offers = parseOffersFromText(offersText);
    if (offers.length < 2) {
      const baseAnchor = Number(current) > 0 ? Number(current) : cost > 0 ? Math.round(cost * 1.08) : 2460000;
      const autoOffersText = [
        `شرق دیجیتال مشهد, ${Math.round(baseAnchor)}, مشهد, 0, online, 4.9`,
        `پاساژ تک مشهد, ${Math.round(baseAnchor * 1.01)}, مشهد, 1, in_person, 4.8`,
        `تکنولایف, ${Math.round(baseAnchor * 1.015)}, تهران, 0, online, 4.9`,
        `کالاتیک, ${Math.round(baseAnchor * 1.03)}, تهران, 1, online, 4.8`,
        `دیجی‌کالا, ${Math.round(baseAnchor * 1.08)}, تهران, 0, online, 4.8`,
        `گران‌فروش پرت ترب, ${Math.round(baseAnchor * 1.55)}, تهران, 5, online, 4.1`,
      ].join("\n");
      setOffersText(autoOffersText);
      offers = parseOffersFromText(autoOffersText);
    }

    try {
      const r = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: effectiveProductName,
          torobTitle: overrideTorobTitle ?? (torobTitle.trim() || effectiveProductName),
          costPrice: forceCostless ? 0 : cost,
          minMarginPct: minMargin,
          colleagueListText: forceCostless ? "" : colleaguesText,
          currentFinalPrice: current ? Number(current) : null,
          totalSellerCount: sellers || offers.length,
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
      if (r.status === 401 && typeof window !== "undefined") {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const j = await r.json().catch(() => ({ error: `خطای سرور (HTTP ${r.status})` }));
      if (!r.ok) {
        const errorText = String(j.error ?? "خطا در شبیه‌سازی");
        setErr(errorText);
        toast.error(errorText);
        setMobileTab("results");
      } else {
        setRes(j as PricingResult);
        setMobileTab("results");
        if (typeof window !== "undefined" && window.innerWidth < 1280) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        toast.success("شبیه‌سازی با موفقیت انجام شد");
      }
    } catch (e) {
      const errorText = `خطا در ارسال درخواست: ${e instanceof Error ? e.message : String(e)}`;
      setErr(errorText);
      toast.error(errorText);
      setMobileTab("results");
    } finally {
      setBusy(false);
    }
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

  // محاسبه موقعیت واقعی شاخص‌ها روی نوار طیف قیمت بازار
  const spectrumPoints = useMemo(() => {
    if (!res) return null;
    const hardFloor = res.supply?.hardFloorPrice ?? null;
    const median = res.floorCeiling?.monitoredMarketMedian ?? res.marketMedian ?? null;
    const ceiling = res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice ?? null;
    const finalPrice = res.finalPrice ?? null;
    const vals = [hardFloor, median, ceiling, finalPrice].filter((v): v is number => v != null && v > 0);
    if (vals.length < 2) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1, max - min);
    const pctPos = (v: number | null) =>
      v == null || v <= 0 ? null : Math.min(98, Math.max(2, ((v - min) / span) * 96 + 2));

    return {
      hardFloorPos: pctPos(hardFloor),
      medianPos: pctPos(median),
      ceilingPos: pctPos(ceiling),
      finalPos: pctPos(finalPrice),
      hardFloor,
      median,
      ceiling,
      finalPrice,
    };
  }, [res]);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold leading-snug text-slate-900 sm:text-2xl">
          آزمایشگاه زنده ناظر بالاسر SubQ SystemOne، کشف کف و سقف بازار و شبیه‌ساز ۳ سیستم تخفیف
        </h1>
        <p className="mt-1 text-xs leading-6 text-slate-600 sm:text-sm">
          در این محیط می‌توانید آستانه‌های ۳ بازه‌ای ناظر بالاسر (<code dir="ltr">SubQ SystemOne — subq-snap-preview</code>) را شخصی‌سازی کنید و رفتار آن را روی ورودی ترب، کف و سقف بازار و هر ۳ سیستم تخفیف تست نمایید.
        </p>
      </div>

      {/* تب سوئیچر مخصوص موبایل و تبلت (< xl) */}
      <div className="xl:hidden">
        <SegmentedTabs<SimTab>
          value={mobileTab}
          onChange={setMobileTab}
          items={[
            { key: "inputs", label: "تنظیمات ورودی" },
            { key: "results", label: res ? "نتیجه و پیش‌نمایش ✅" : "نتیجه و پیش‌نمایش" },
          ]}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,470px)_minmax(0,1fr)] xl:items-start">
        {/* ستون تنظیمات و داده‌های ورودی */}
        <div className={`min-w-0 space-y-3.5 ${mobileTab === "inputs" ? "block" : "hidden xl:block"}`}>
          {storeProducts.length > 0 && (
            <div className="card space-y-2 border-slate-200 bg-slate-50/70">
              <label className="label font-bold text-slate-800">
                📦 انتخاب سریع از کارت‌های واقعی فروشگاه ({faNum(storeProducts.length)} محصول)
              </label>
              <select
                className="input text-xs"
                value={selectedProductId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSelectedProductId(pid);
                  const found = storeProducts.find((x) => String(x.id) === pid);
                  if (found) {
                    setProductName(found.name);
                    setTorobTitle(found.name);
                    const pPrice = found.currentFinalPrice && found.currentFinalPrice > 0 ? found.currentFinalPrice : 2450000;
                    setCurrent(String(pPrice));
                    setCost(found.costPrice > 0 ? found.costPrice : Math.round(pPrice * 0.9));
                    setOffersText(
                      [
                        `شرق دیجیتال مشهد, ${Math.round(pPrice)}, مشهد, 0, online, 4.9`,
                        `پاساژ تک مشهد, ${Math.round(pPrice * 1.01)}, مشهد, 1, in_person, 4.8`,
                        `تکنولایف, ${Math.round(pPrice * 1.02)}, تهران, 0, online, 4.9`,
                        `کالاتیک, ${Math.round(pPrice * 1.04)}, تهران, 1, online, 4.8`,
                        `دیجی‌کالا, ${Math.round(pPrice * 1.09)}, تهران, 0, online, 4.8`,
                        `گران‌فروش پرت ترب, ${Math.round(pPrice * 1.55)}, تهران, 5, online, 4.1`,
                      ].join("\n"),
                    );
                  }
                }}
              >
                <option value="">-- انتخاب محصول از دیتابیس برای بارگذاری در آزمایشگاه --</option>
                {storeProducts.map((p, idx) => (
                  <option key={p.id} value={p.id}>
                    کارت #{idx + 1}: {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ۱. محصول و ناظر SubQ */}
          <CollapsibleSection
            title="۱. محصول و ناظر بالاسر SubQ SystemOne"
            badge={<span className="badge bg-indigo-100 font-mono text-[10px] text-indigo-900">subq-snap-preview</span>}
            defaultOpen={true}
            className="border-indigo-200"
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="label mb-0 font-bold text-rose-700">رد کامل زیر (٪)</label>
                    <span className="num text-xs font-bold text-rose-700">{faNum(rejectBelowPct)}٪</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={90}
                    value={rejectBelowPct}
                    onChange={(e) => setRejectBelowPct(Number(e.target.value))}
                    className="mb-1.5 w-full accent-rose-600"
                  />
                  <input
                    className="input num text-xs"
                    type="number"
                    min={5}
                    max={90}
                    value={rejectBelowPct}
                    onChange={(e) => setRejectBelowPct(Number(e.target.value))}
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="label mb-0 font-bold text-emerald-700">تایید خودکار بالای (٪)</label>
                    <span className="num text-xs font-bold text-emerald-700">{faNum(approveAbovePct)}٪</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={99}
                    value={approveAbovePct}
                    onChange={(e) => setApproveAbovePct(Number(e.target.value))}
                    className="mb-1.5 w-full accent-emerald-600"
                  />
                  <input
                    className="input num text-xs"
                    type="number"
                    min={20}
                    max={99}
                    value={approveAbovePct}
                    onChange={(e) => setApproveAbovePct(Number(e.target.value))}
                  />
                </div>
              </div>

              <div>
                <label className="label">نام محصول در سایت ما (sgeooole)</label>
                <input
                  className="input text-xs"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="label mb-0">عنوان کارت در ورودی ترب (تست گیت ۱)</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-emerald-700 hover:underline"
                      onClick={() => {
                        setTorobTitle(productName);
                        run(false, productName);
                      }}
                    >
                      ✅ تست کارت منطبق
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-rose-600 hover:underline"
                      onClick={() => {
                        const bad = "پایه و کاور لوازم جانبی نامرتبط (کالای تستی گیت هویت)";
                        setTorobTitle(bad);
                        run(false, bad);
                      }}
                    >
                      ⛔ تست کارت اشتباه
                    </button>
                  </div>
                </div>
                <input
                  className="input text-xs"
                  value={torobTitle}
                  onChange={(e) => setTorobTitle(e.target.value)}
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* ۲. لیست همکاران و رقبا */}
          <CollapsibleSection title="۲. لیست همکاران و پیشنهادهای رقبا" defaultOpen={true}>
            <div className="space-y-3.5">
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <label className="label mb-0 font-bold text-indigo-700">
                    لیست قیمت همکاران (خالی = کشف کف امن)
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium text-indigo-600 hover:underline"
                    onClick={() => {
                      setColleaguesText("");
                      setCost(0);
                    }}
                  >
                    پاک کردن (تست بدون قیمت خرید)
                  </button>
                </div>
                <textarea
                  className="input min-h-20 font-mono text-xs"
                  dir="ltr"
                  value={colleaguesText}
                  onChange={(e) => setColleaguesText(e.target.value)}
                  placeholder="نام همکار, قیمت خرید (تومان), شهر, اولویت 1-10, in|out"
                />
              </div>

              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <label className="label mb-0 font-bold text-emerald-700">
                    پیشنهادهای رقبا در ترب
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium text-emerald-700 hover:underline"
                    onClick={() => {
                      setColleaguesText(SAMPLE_COLLEAGUES);
                      setOffersText(SAMPLE_OFFERS);
                      setCost(2320000);
                    }}
                  >
                    بارگذاری نمونه استاندارد
                  </button>
                </div>
                <textarea
                  className="input min-h-28 font-mono text-xs"
                  dir="ltr"
                  value={offersText}
                  onChange={(e) => setOffersText(e.target.value)}
                  placeholder="نام فروشگاه, قیمت (تومان), شهر, روزهای گذشته, online|in_person, امتیاز"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* ۳. فرمول کشف سقف و کف */}
          <CollapsibleSection
            title="۳. فرمول کشف «سقف معیار» و «کف»"
            defaultOpen={false}
            className="border-emerald-200"
          >
            <div className="space-y-3">
              <div>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">صدک سقف ({faNum(upperPercentile)}٪)</label>
                  <input
                    type="range"
                    min={55}
                    max={98}
                    value={upperPercentile}
                    onChange={(e) => setUpperPercentile(Number(e.target.value))}
                    className="mb-1 w-full accent-indigo-600"
                  />
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
                  <label className="label">سپر ضدپرت ({faNum(maxCeilingAboveMedianPct)}٪)</label>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={maxCeilingAboveMedianPct}
                    onChange={(e) => setMaxCeilingAboveMedianPct(Number(e.target.value))}
                    className="mb-1 w-full accent-indigo-600"
                  />
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
                  <label className="label">حداقل تخفیف (٪)</label>
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
                  <label className="label">حداکثر تخفیف (٪)</label>
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

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                <Switch
                  checked={calibrateExact}
                  onChange={setCalibrateExact}
                  label="کالیبراسیون دقیق سقف به کف"
                  description="خروجی با درصد تخفیف صحیح دقیقاً روی کف هدف بنشیند"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* ۴. پیش‌نمایش کمپین و ورودی پایه */}
          <CollapsibleSection title="۴. پیش‌نمایش کارت و پارامترهای پایه" defaultOpen={false}>
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-slate-200 p-2.5">
                    <Switch
                      checked={previewFeatured}
                      onChange={setPreviewFeatured}
                      label="نمایش در منتخب‌ها"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
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
            </div>
          </CollapsibleSection>

          {/* دکمه‌های اجرا */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => run(false)}>
              {busy && <IconSpinner className="h-4 w-4" />}
              <span>{busy ? "در حال بررسی ناظر و محاسبه…" : "🔍 اجرای ناظر SystemOne و محاسبه کف و سقف"}</span>
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(true)}>
              تست بدون قیمت خرید
            </button>
          </div>
        </div>

        {/* ستون خروجی بصری */}
        <div className={`card min-w-0 ${mobileTab === "results" ? "block" : "hidden xl:block"}`}>
          {err && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>
          )}
          {!res && !err && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
              <p className="max-w-md text-sm leading-7">
                روی دکمه «🔍 اجرای ناظر SystemOne و محاسبه کف و سقف» کلیک کنید تا نتیجه تصمیم‌گیری ۴ مقیاسی و پیش‌نمایش کارت محصول بلافاصله نمایش داده شود.
              </p>
              <button
                type="button"
                className="btn-primary xl:hidden"
                disabled={busy}
                onClick={() => run(false)}
              >
                {busy && <IconSpinner className="h-4 w-4" />}
                <span>اجرای سریع شبیه‌سازی با نمونه پیش‌فرض</span>
              </button>
            </div>
          )}

          {res && (
            <div className="space-y-5">
              {/* ۰. حکم ناظر بالاسر SubQ SystemOne */}
              {res.supervisor && (
                <div className="space-y-3 rounded-2xl border-2 border-indigo-300 bg-indigo-50/30 p-3.5 sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-indigo-950">
                        🛡️ حکم ناظر بالاسر SubQ SystemOne (<code dir="ltr">{res.supervisor.model}</code>)
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-600">
                        قانون ۳ بازه‌ای: <b>زیر {res.supervisor.rejectBelowPct}٪ رد کامل</b> ·{" "}
                        <b>{res.supervisor.rejectBelowPct}٪ تا {res.supervisor.approveAbovePct}٪ ریویو</b> ·{" "}
                        <b>بالای {res.supervisor.approveAbovePct}٪ تایید خودکار</b>
                      </div>
                    </div>
                    <div className={`badge self-start border px-3 py-1 text-xs font-bold sm:self-auto ${verdictStyle[res.supervisor.verdict]}`}>
                      noul: {res.supervisor.overallNoul.toFixed(2)} ({res.supervisor.overallScorePct}٪) →{" "}
                      {res.supervisor.verdict === "approve"
                        ? "✅ تایید و ادامه خودکار"
                        : res.supervisor.verdict === "review"
                          ? "⏳ ارسال به ریویو"
                          : "⛔ رد کامل"}
                    </div>
                  </div>

                  {/* ۴ مقیاس ناظر */}
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {Object.values(res.supervisor.gates).map((g) => (
                      <div key={g.key} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                          <span className="font-bold text-slate-800">{g.title}</span>
                          <span className={`badge border font-mono text-[11px] ${verdictStyle[g.verdict]}`}>
                            {g.scorePct}٪ ({g.noul.toFixed(2)})
                          </span>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full transition-all ${
                              g.verdict === "approve"
                                ? "bg-emerald-500"
                                : g.verdict === "review"
                                  ? "bg-amber-500"
                                  : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(4, g.scorePct))}%` }}
                          />
                        </div>
                        <div className="mt-1.5 text-[11px] leading-5 text-slate-600">{g.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ۱. رادار کف و سقف + پیش‌نمایش کارت */}
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 sm:p-4 lg:col-span-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">
                      📊 رادار کف و سقف بازار تحت رصد
                    </span>
                    <span className="badge bg-emerald-100 text-emerald-800 text-[11px]">
                      {faNum(res.floorCeiling?.monitoredSellersCount ?? res.offersUsed)} معتبر ·{" "}
                      {faNum(res.floorCeiling?.excludedOutliersCount ?? 0)} پرت حذف شد
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-3">
                    <div className="rounded-lg bg-white px-2.5 py-1.5">
                      <span className="block text-[10px] text-slate-400">خط قرمز تامین</span>
                      <b className="num text-amber-800">{t(res.supply?.hardFloorPrice)}</b>
                    </div>
                    <div className="rounded-lg bg-white px-2.5 py-1.5">
                      <span className="block text-[10px] text-slate-400">میانه بازار</span>
                      <b className="num text-slate-800">{t(res.floorCeiling?.monitoredMarketMedian ?? res.marketMedian)}</b>
                    </div>
                    <div className="rounded-lg bg-white px-2.5 py-1.5">
                      <span className="block text-[10px] text-slate-400">سقف واقعی رصدشده</span>
                      <b className="num text-indigo-800">{t(res.floorCeiling?.monitoredMarketCeiling ?? res.basePrice)}</b>
                    </div>
                  </div>

                  {/* نوار طیف واقعی با نقطه‌های موقعیت قیمت‌ها */}
                  <div className="space-y-1.5">
                    <div className="relative h-5 w-full rounded-full bg-gradient-to-l from-indigo-500 via-emerald-500 to-amber-500 p-0.5 shadow-inner" dir="ltr">
                      {spectrumPoints?.hardFloorPos != null && (
                        <span
                          title={`خط قرمز: ${t(spectrumPoints.hardFloor)}`}
                          style={{ left: `${spectrumPoints.hardFloorPos}%` }}
                          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-600 shadow"
                        />
                      )}
                      {spectrumPoints?.finalPos != null && (
                        <span
                          title={`قیمت نهایی ما: ${t(spectrumPoints.finalPrice)}`}
                          style={{ left: `${spectrumPoints.finalPos}%` }}
                          className="absolute top-1/2 z-10 h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-700 ring-2 ring-emerald-300 shadow"
                        />
                      )}
                      {spectrumPoints?.medianPos != null && (
                        <span
                          title={`میانه بازار: ${t(spectrumPoints.median)}`}
                          style={{ left: `${spectrumPoints.medianPos}%` }}
                          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-slate-800 shadow"
                        />
                      )}
                      {spectrumPoints?.ceilingPos != null && (
                        <span
                          title={`سقف بازار: ${t(spectrumPoints.ceiling)}`}
                          style={{ left: `${spectrumPoints.ceilingPos}%` }}
                          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-700 shadow"
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-600" /> خط قرمز</span>
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><i className="h-2.5 w-2.5 rounded-full bg-emerald-700" /> قیمت نهایی ما</span>
                      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-slate-800" /> میانه</span>
                      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-700" /> سقف بازار</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs leading-5 text-slate-700">
                    <div className="font-bold">معادله دقیق سقف به کف در sgeooole:</div>
                    <div className="mt-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-indigo-900" dir="ltr">
                      Math.round({res.basePrice?.toLocaleString()} × (1 - {res.discountPct}% / 100)) ={" "}
                      {res.floorCeiling?.exactFloorRestored?.toLocaleString() ?? res.finalPrice?.toLocaleString()} Toman
                    </div>
                  </div>
                </div>

                {/* پیش‌نمایش کارت محصول */}
                <div className="flex flex-col justify-between rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-sm lg:col-span-5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${themeBadgeStyles[previewTheme]}`}>
                      {previewCampaign === "flash"
                        ? "⚡ پیشنهاد لحظه‌ای"
                        : previewCampaign === "featured"
                          ? "🔥 پیشنهاد شگفت‌انگیز"
                          : `⏱️ ${previewCampaignName}`}
                    </span>
                    <span className="num rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
                      {res.discountPct ?? 0}٪ تخفیف
                    </span>
                  </div>

                  <div className="my-3.5">
                    <div className="text-xs font-bold leading-5 text-slate-800">{productName}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {campaignLabel[previewCampaign]} · تم {badgeThemeLabel[previewTheme]}
                      {previewFeatured ? " · ★ در منتخب‌های صفحه اصلی" : ""}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-2.5">
                    <div>
                      <div className="text-[11px] text-slate-400">سقف معیار بازار:</div>
                      <div className="num text-xs text-slate-400 line-through">{t(res.basePrice)} تومان</div>
                    </div>
                    <div className="text-left">
                      <div className="text-[11px] font-medium text-emerald-700">کف قطعی پس از کسر {res.discountPct}٪:</div>
                      <div className="num text-base font-extrabold text-emerald-700">{t(res.finalPrice)} تومان</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ۲. شاخص‌های ۱۲ گانه */}
              <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3 md:grid-cols-4">
                <K k="تمام‌شده همکار منتخب" v={t(res.supply?.effectiveCostPrice)} />
                <K k="خط قرمز فروش (کف سود)" v={t(res.supply?.hardFloorPrice)} warn />
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

              {/* ۳. گام‌های تصمیم‌گیری */}
              <ol className="space-y-1.5">
                {res.steps.map((s, i) => (
                  <li
                    key={i}
                    className={`rounded-xl px-3.5 py-2 text-xs leading-6 ${
                      s.level === "warn" ? "bg-amber-50 text-amber-900" : s.level === "error" ? "bg-rose-50 text-rose-900" : "bg-slate-50 text-slate-700"
                    }`}
                  >
                    <b>{s.title}:</b> {s.message}
                  </li>
                ))}
              </ol>

              {/* ۴. پیشنهادهای ترب: کارت موبایل + جدول اسکرول‌دار دسکتاپ */}
              <div className="space-y-2.5 md:hidden">
                <h3 className="text-sm font-bold text-slate-900">پیشنهادهای ترب ({faNum(res.offers.length)})</h3>
                {[...res.offers]
                  .sort((a, b) => a.price - b.price)
                  .map((o, i) => (
                    <div key={i} className={`m-row space-y-1.5 ${o.included ? "" : "opacity-75"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">{o.shopName}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500">
                            <span className={o.isLocalCity ? "font-bold text-indigo-700" : ""}>{o.shopCity ?? "—"}</span>
                            {o.sellerType === "in_person" && <span className="badge bg-sky-100 text-sky-700">حضوری</span>}
                            <span>· امتیاز {o.shopScore ?? "—"}</span>
                          </div>
                        </div>
                        <div className={`num font-bold ${o.included ? "text-slate-900" : "line-through text-slate-400"}`}>
                          {t(o.price)}
                        </div>
                      </div>
                      <div>
                        {o.included ? (
                          <span className="badge bg-emerald-100 text-emerald-800">بازار معتبر تحت رصد</span>
                        ) : (
                          <span className="badge bg-rose-100 text-rose-700">حذف‌شده ({o.excludeReason})</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="table-scroll hidden md:block">
                <table className="data min-w-[600px]">
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
      className={`rounded-xl px-3 py-2 ${
        highlight
          ? "border border-indigo-200 bg-indigo-50"
          : warn
            ? "border border-amber-200 bg-amber-50"
            : "border border-slate-100 bg-slate-50"
      }`}
    >
      <div className="text-[11px] text-slate-500">{k}</div>
      <div
        className={`num mt-0.5 break-words ${
          strong
            ? "font-bold text-emerald-700"
            : highlight
              ? "font-bold text-indigo-800"
              : warn
                ? "font-bold text-amber-800"
                : "font-medium text-slate-800"
        }`}
      >
        {v}
      </div>
    </div>
  );
}
