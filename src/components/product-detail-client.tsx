"use client";

import { ListingLinks } from "./listing-links";
import { decisionPanels } from "@/lib/pricing/listing";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DecisionStep } from "@/db/schema";
import type { SupplierQuote, TorobCandidateTrace, TorobInquiryReport, TorobLinkConfirmation, TorobOfferEvidence } from "@/lib/pricing/types";
import {
  badgeThemeLabel,
  campaignLabel,
  faDate,
  faNum,
  pct,
  statusColor,
  statusLabel,
  strategyLabel,
  torobStatusLabel,
  toman,
} from "@/lib/format";
import { DecisionActions, DeleteProductButton, ProductStatusToggle, RunButton } from "./actions";
import { IconArrowRight, IconExternalLink, IconSearch } from "./icons";
import { ProductForm } from "./product-form";
import { EmptyState, SegmentedTabs } from "./ui";

export interface SerializedProductDetail {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  storeExternalId: string | null;
  sourceType: string;
  torobUrl: string | null;
  torobLinkConfirmation: TorobLinkConfirmation | null;
  costPrice: number;
  minMarginPct: number | null;
  minProfitAmount: number | null;
  preferredCampaignType: string;
  showInFeatured: boolean;
  status: string;
  selectedSupplierName: string | null;
  currentHardFloorPrice: number | null;
  currentBasePrice: number | null;
  currentFinalPrice: number | null;
  currentDiscountPct: number | null;
  currentCampaign: string | null;
  currentCampaignName: string | null;
  currentBadgeTheme: string | null;
  currentShowInFeatured: boolean | null;
  supplierQuotes: SupplierQuote[];
}

export interface SerializedDecision {
  id: number;
  status: string;
  createdAt: string;
  offersUsed: number;
  offersTotal: number;
  effectiveCostPrice: number | null;
  hardFloorPrice: number | null;
  localLowestValid: number | null;
  lowestValid: number | null;
  marketMedian: number | null;
  monitoredMarketCeiling: number | null;
  basePrice: number | null;
  finalPrice: number | null;
  discountPct: number | null;
  campaignType: string | null;
  campaignName: string | null;
  projectedLocalRank: number | null;
  projectedNationalRank: number | null;
  netProfitToman: number | null;
  strategy: string | null;
  confidence: number;
  steps: DecisionStep[];
  pushStatus: string | null;
  pushError: string | null;
}

export interface SerializedOffer {
  id: number;
  shopName: string;
  shopCity: string | null;
  sellerType: string;
  isAd: boolean;
  inStock: boolean;
  priceUnreliable: boolean;
  isLocalCity: boolean;
  shopScore: number | null;
  price: number;
  torobEvidence: TorobOfferEvidence | null;
  url: string | null;
  lastChangedDaysAgo: number | null;
  weight: number;
  included: boolean;
  excludeReason: string | null;
}

type DetailTab = "overview" | "offers" | "history" | "edit";
type OfferFilter = "all" | "included" | "excluded" | "local";

function inquiryFor(decision?: SerializedDecision) {
  return decision?.steps.find((step) => step.step === "torob_inquiry")?.data as
    (TorobInquiryReport & { candidate?: TorobCandidateTrace }) | undefined;
}

export function ProductDetailClient({
  product,
  decisions,
  offers,
}: {
  product: SerializedProductDetail;
  decisions: SerializedDecision[];
  offers: SerializedOffer[];
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [offerFilter, setOfferFilter] = useState<OfferFilter>("all");
  const [offerQuery, setOfferQuery] = useState("");
  const [showAllSteps, setShowAllSteps] = useState(false);

  const latest = decisions[0];
  const latestInquiry = inquiryFor(latest);

  function actionProps(d: SerializedDecision) {
    const effectiveCost = Math.max(d.effectiveCostPrice ?? 0, product.costPrice);
    const hardFloor = Math.max(d.hardFloorPrice ?? 0, product.currentHardFloorPrice ?? 0);
    return {
      effectiveCost, hardFloor,
      isBelowFloor: effectiveCost <= 0 || (d.finalPrice ?? 0) <= effectiveCost || (d.finalPrice ?? 0) < hardFloor,
      initialFinalPrice: d.finalPrice, initialBasePrice: d.basePrice,
      initialCampaignType: d.campaignType, initialDiscountPct: d.discountPct,
    };
  }
  const latestPanels = latest ? decisionPanels(latest.steps) : [];

  const isDecisionSyncFailed = (d: SerializedDecision) =>
    d.status === "sync_failed" || d.status === "pending_sync" || d.pushStatus === "failed";

  const isActionable = (d: SerializedDecision) => {
    const inquiry = inquiryFor(d);
    return (!inquiry || inquiry.status === "MATCH_CONFIRMED") &&
      (d.status === "pending_review" || d.status === "sync_failed" || d.status === "pending_sync");
  };

  const filteredOffers = useMemo(() => {
    const q = offerQuery.trim().toLowerCase();
    return offers.filter((o) => {
      if (offerFilter === "included" && !o.included) return false;
      if (offerFilter === "excluded" && o.included) return false;
      if (offerFilter === "local" && !o.isLocalCity) return false;
      if (q && !o.shopName.toLowerCase().includes(q) && !(o.shopCity ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [offers, offerFilter, offerQuery]);

  const offerCounts = useMemo(
    () => ({
      all: offers.length,
      included: offers.filter((o) => o.included).length,
      excluded: offers.filter((o) => !o.included).length,
      local: offers.filter((o) => o.isLocalCity).length,
    }),
    [offers],
  );

  const stepsToShow = latest ? (showAllSteps ? latest.steps : latest.steps.slice(0, 6)) : [];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* مسیر بازگشت + هدر محصول */}
      <div className="space-y-3">
        <Link
          href="/products"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:underline"
        >
          <IconArrowRight className="h-3.5 w-3.5" />
          <span>بازگشت به فهرست محصولات</span>
        </Link>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-lg font-extrabold leading-snug text-slate-900 sm:text-2xl">{product.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{product.sku}</span>
              <span className={`badge ${statusColor[product.status] ?? "bg-slate-100"}`}>
                {statusLabel[product.status] ?? product.status}
              </span>
              {product.selectedSupplierName && (
                <span className="badge bg-indigo-50 text-indigo-700">
                  منبع کف قیمت: {product.selectedSupplierName}
                </span>
              )}
              {product.currentShowInFeatured && (
                <span className="badge bg-indigo-100 text-indigo-800">★ منتخب صفحه اصلی</span>
              )}
              <ListingLinks panels={latestPanels} />
              {product.torobLinkConfirmation && (
                <span className="text-emerald-800">
                  تأیید مدیر · {faDate(product.torobLinkConfirmation.confirmedAt)} · تصمیم #{faNum(product.torobLinkConfirmation.decisionId)}
                </span>
              )}
              {product.torobUrl && !latestPanels.length && (
                <a
                  href={product.torobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
                >
                  <span>لینک ثبت‌شدهٔ محصول</span>
                  <IconExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-full sm:w-auto">
              <RunButton
                productIds={[product.id]}
                label="استعلام سقف و کف و قیمت‌گذاری اکنون"
                className="btn-primary w-full sm:w-auto"
              />
            </div>
            <ProductStatusToggle id={product.id} status={product.status} />
            <DeleteProductButton id={product.id} name={product.name} />
          </div>
        </div>
      </div>

      {/* ۶ کارت KPI کلیدی */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Box title="قیمت تمام‌شده همکار" value={toman(product.costPrice)} sub={product.selectedSupplierName ?? "تامین پایه"} />
        <Box
          title="خط قرمز فروش (کف سود)"
          value={toman(product.currentHardFloorPrice ?? latest?.hardFloorPrice)}
          sub="هرگز زیر این قیمت"
        />
        <Box
          title="سقف معیار تخفیف (خط‌خورده)"
          value={toman(product.currentBasePrice)}
          sub="سقف واقعی بازار بدون پرت"
        />
        <Box
          title="کف قطعی فروش"
          value={toman(product.currentFinalPrice)}
          strong
          sub="پس از اعمال درصد تخفیف روی سقف"
        />
        <Box
          title="تخفیف / سیستم فعال"
          value={pct(product.currentDiscountPct, 0)}
          sub={`${product.currentCampaignName || campaignLabel[product.currentCampaign ?? "none"]} (${
            badgeThemeLabel[product.currentBadgeTheme ?? "green-orange"] ?? ""
          })`}
        />
        <Box
          title="سود خالص فعلی"
          value={
            product.currentFinalPrice && product.costPrice
              ? `${toman(product.currentFinalPrice - product.costPrice)} (${pct(
                  ((product.currentFinalPrice - product.costPrice) / product.costPrice) * 100,
                )})`
              : "—"
          }
        />
      </div>

      {/* تب‌های سازمان‌یافته */}
      <SegmentedTabs<DetailTab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "نمای کلی و آخرین تصمیم" },
          { key: "offers", label: "رقبای ترب", count: offers.length },
          { key: "history", label: "تاریخچه تصمیم‌ها", count: decisions.length },
          { key: "edit", label: "ویرایش و همکاران" },
        ]}
      />

      {tab === "overview" && (
        <div className="space-y-4">
          {latest ? (
            <div className="card space-y-5">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    آخرین تصمیم #{latest.id}
                  </h2>
                  <span className="text-xs text-slate-500">{faDate(latest.createdAt)}</span>
                  <span className={`badge ${statusColor[latest.status] ?? "bg-slate-100"}`}>
                    {statusLabel[latest.status] ?? latest.status}
                  </span>
                </div>
                {isActionable(latest) && (
                  <DecisionActions
                    decisionId={latest.id}
                    force
                    {...actionProps(latest)}
                    syncFailed={isDecisionSyncFailed(latest)}
                  />
                )}
              </div>

              {latestInquiry && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <strong>{torobStatusLabel[latestInquiry.status]}</strong> · {latestInquiry.reason}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                <Mini k="پیشنهادهای استخراج‌شده" v={faNum(latestInquiry?.extractedOffers ?? latest.offersTotal)} />
                <Mini k="پیشنهاد معتبر برای قیمت‌گذاری" v={latestInquiry?.validOffers === null ? "نامشخص" : faNum(latestInquiry?.validOffers ?? latest.offersUsed)} />
                {latestInquiry?.validOnlineOffers != null && <Mini k="پیشنهاد معتبر اینترنتی" v={faNum(latestInquiry.validOnlineOffers)} />}
                {latestInquiry?.validLocalInPersonOffers != null && <Mini k="پیشنهاد معتبر حضوری در شهر هدف" v={faNum(latestInquiry.validLocalInPersonOffers)} />}
                <Mini k="تمام‌شده همکار" v={toman(latest.effectiveCostPrice)} />
                <Mini k="خط قرمز فروش" v={toman(latest.hardFloorPrice)} />
                <Mini k="کف معتبر مشهد" v={toman(latest.localLowestValid)} />
                <Mini k="کف معتبر کل ترب" v={toman(latest.lowestValid)} />
                <Mini k="میانه بازار" v={toman(latest.marketMedian)} />
                <Mini k="سقف رصدشده بازار" v={toman(latest.monitoredMarketCeiling ?? latest.basePrice)} />
                <Mini k="رتبه در مشهد" v={latest.projectedLocalRank ? `#${faNum(latest.projectedLocalRank)}` : "—"} />
                <Mini k="رتبه در کل ترب" v={latest.projectedNationalRank ? `#${faNum(latest.projectedNationalRank)}` : "—"} />
                <Mini k="استراتژی" v={strategyLabel[latest.strategy ?? ""] ?? latest.strategy ?? "—"} />
                <Mini k="اعتماد" v={pct(latest.confidence * 100, 0)} />
              </div>

              <div>
                <h3 className="mb-2.5 text-sm font-bold text-slate-800">
                  مراحل تصمیم‌گیری (کشف کف، سقف واقعی و سیستم تخفیف)
                </h3>
                <ol className="space-y-2">
                  {stepsToShow.map((s, i) => (
                    <li
                      key={i}
                      className={`rounded-xl border px-3.5 py-2.5 text-xs leading-6 sm:text-sm ${
                        s.level === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-950"
                          : s.level === "warn"
                            ? "border-amber-200 bg-amber-50 text-amber-950"
                            : "border-slate-200 bg-slate-50 text-slate-800"
                      }`}
                    >
                      <span className="num ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-500">
                        {faNum(i + 1)}
                      </span>
                      <b>{s.title}:</b> <span className="break-words text-slate-700">{s.message}</span>
                    </li>
                  ))}
                </ol>

                {latest.steps.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSteps((v) => !v)}
                    className="btn-secondary btn-sm mt-3"
                  >
                    {showAllSteps
                      ? "نمایش خلاصه مراحل"
                      : `نمایش همه ${faNum(latest.steps.length)} مرحله`}
                  </button>
                )}
              </div>

              {latest.pushStatus && (
                <div
                  className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                    latest.pushStatus === "pushed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : latest.pushStatus === "skipped"
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}
                >
                  ارسال به فروشگاه:{" "}
                  {latest.pushStatus === "pushed"
                    ? "موفق"
                    : latest.pushStatus === "skipped"
                      ? "کانکتور غیرفعال"
                      : `ناموفق — ${latest.pushError}`}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="هنوز تصمیمی برای این محصول ثبت نشده است"
              description="برای تحلیل بازار ترب و محاسبه قیمت، دکمه استعلام را بزنید."
            />
          )}
        </div>
      )}

      {tab === "offers" && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-bold text-slate-900">پیشنهادهای رقبا در ترب ({faNum(offers.length)})</h2>
            <div className="relative w-full sm:w-64">
              <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pr-9 text-xs"
                placeholder="جستجوی فروشگاه یا شهر…"
                value={offerQuery}
                onChange={(e) => setOfferQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                { key: "all", label: "همه", count: offerCounts.all },
                { key: "included", label: "معتبر", count: offerCounts.included },
                { key: "excluded", label: "حذف‌شده", count: offerCounts.excluded },
                { key: "local", label: "فروشندگان مشهد", count: offerCounts.local },
              ] as const
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setOfferFilter(c.key)}
                className={`chip ${offerFilter === c.key ? "chip-active" : ""}`}
              >
                <span>{c.label}</span>
                <span className={`num text-[11px] ${offerFilter === c.key ? "text-indigo-100" : "text-slate-400"}`}>
                  ({faNum(c.count)})
                </span>
              </button>
            ))}
          </div>

          {filteredOffers.length === 0 ? (
            <EmptyState title="پیشنهادی یافت نشد" description="فیلتر فعلی هیچ فروشنده‌ای را نشان نمی‌دهد." />
          ) : (
            <>
              {/* موبایل */}
              <div className="space-y-3 lg:hidden">
                {filteredOffers.map((o, i) => (
                  <div key={o.id} className={`m-row space-y-2 ${o.included ? "" : "opacity-75"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 break-words">
                          <span className="num ml-1.5 text-xs text-slate-400">#{faNum(i + 1)}</span>
                          {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.shopName}</a> : o.shopName}
                        </div>
                        {o.torobEvidence?.listingTitle && <div className="text-xs text-slate-600">{o.torobEvidence.listingTitle}</div>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.shopCity && (
                            <span className={`badge text-[11px] ${o.isLocalCity ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>
                              {o.shopCity}
                            </span>
                          )}
                          <span className="badge bg-sky-100 text-sky-700 text-[11px]">{o.sellerType === "in_person" ? "حضوری" : "اینترنتی"}</span>
                          {o.isAd && <span className="badge bg-purple-100 text-purple-700 text-[11px]">آگهی</span>}
                          {!o.inStock && <span className="badge bg-slate-200 text-slate-600 text-[11px]">ناموجود</span>}
                          {o.priceUnreliable && (
                            <span className="badge bg-rose-100 text-rose-700 text-[11px]">غیرقابل اعتماد ترب</span>
                          )}
                        </div>
                      </div>
                      <div className={`num shrink-0 text-sm font-extrabold ${o.included ? "text-slate-900" : "line-through text-slate-400"}`}>
                        {toman(o.price)}
                      </div>
                    </div>
                    {o.torobEvidence && <div className="text-xs text-slate-500">مشاهده‌شده در {faDate(o.torobEvidence.observedAt)}</div>}

                    <div className="m-row-kv">
                      <span>امتیاز / تازگی / وزن</span>
                      <span className="num text-xs">
                        {o.shopScore ? faNum(o.shopScore, 1) : "—"} ·{" "}
                        {o.lastChangedDaysAgo != null ? `${faNum(o.lastChangedDaysAgo)} روز پیش` : "—"} ·{" "}
                        {o.included ? faNum(o.weight, 2) : "—"}
                      </span>
                    </div>
                    <div className="pt-1">
                      {o.included ? (
                        <span className="badge bg-emerald-100 text-emerald-700">بازار معتبر تحت رصد</span>
                      ) : (
                        <span className="badge bg-rose-100 text-rose-700">حذف‌شده ({o.excludeReason})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* دسکتاپ */}
              <div className="table-scroll hidden lg:block">
                <table className="data min-w-[780px]">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>فروشگاه</th>
                      <th>شهر</th>
                      <th>امتیاز</th>
                      <th>قیمت</th>
                      <th>آخرین تغییر</th>
                      <th>وزن</th>
                      <th>وضعیت در رادار بازار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOffers.map((o, i) => (
                      <tr key={o.id} className={o.included ? "" : "text-slate-400"}>
                        <td className="num">{faNum(i + 1)}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.shopName}</a> : <span>{o.shopName}</span>}
                            <span className="badge bg-sky-100 text-sky-700">{o.sellerType === "in_person" ? "حضوری" : "اینترنتی"}</span>
                            {o.isAd && <span className="badge bg-purple-100 text-purple-700">آگهی</span>}
                            {!o.inStock && <span className="badge bg-slate-200 text-slate-600">ناموجود</span>}
                            {o.priceUnreliable && <span className="badge bg-rose-100 text-rose-700">غیرقابل اعتماد ترب</span>}
                          </div>
                          {o.torobEvidence?.listingTitle && <div className="text-xs text-slate-600">{o.torobEvidence.listingTitle}</div>}
                        </td>
                        <td>
                          {o.shopCity ? (
                            <span className={o.isLocalCity ? "badge bg-indigo-100 font-bold text-indigo-800" : "text-xs"}>
                              {o.shopCity}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num text-xs">{o.shopScore ? faNum(o.shopScore, 1) : "—"}</td>
                        <td className={`num ${o.included ? "font-medium" : "line-through"}`}>{toman(o.price)}</td>
                        <td className="text-xs">
                          {o.lastChangedDaysAgo != null ? `${faNum(o.lastChangedDaysAgo)} روز پیش` : "—"}
                          {o.torobEvidence && <div className="text-slate-500">مشاهده‌شده در {faDate(o.torobEvidence.observedAt)}</div>}
                        </td>
                        <td className="num text-xs">{o.included ? faNum(o.weight, 2) : "—"}</td>
                        <td>
                          {o.included ? (
                            <span className="badge bg-emerald-100 text-emerald-700">بازار معتبر تحت رصد</span>
                          ) : (
                            <span className="badge bg-rose-100 text-rose-700">حذف‌شده ({o.excludeReason})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="card space-y-4">
          <h2 className="font-bold text-slate-900">تاریخچه تصمیم‌ها ({faNum(decisions.length)})</h2>
          {decisions.length === 0 ? (
            <EmptyState title="هنوز استعلامی انجام نشده است" />
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {decisions.map((d) => (
                  <div key={d.id} className="m-row space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-sm font-bold text-slate-900">
                        تصمیم #{faNum(d.id)} · <span className="text-xs font-normal text-slate-500">{faDate(d.createdAt)}</span>
                      </span>
                      <span className={`badge ${statusColor[d.status] ?? "bg-slate-100"}`}>
                        {statusLabel[d.status] ?? d.status}
                      </span>
                    </div>
                    <ListingLinks panels={decisionPanels(d.steps)} />
                    <div className="m-row-kv">
                      <span>کف نهایی / سقف معیار</span>
                      <span className="num">
                        <b className="text-emerald-700">{toman(d.finalPrice)}</b>{" "}
                        <span className="text-xs text-slate-400 line-through">{toman(d.basePrice)}</span>
                      </span>
                    </div>
                    <div className="m-row-kv">
                      <span>کف همکار</span>
                      <span className="num text-xs">{toman(d.hardFloorPrice ?? d.effectiveCostPrice)}</span>
                    </div>
                    <div className="m-row-kv">
                      <span>تخفیف / کمپین</span>
                      <span className="num text-xs">
                        <b className="text-rose-600">{pct(d.discountPct, 0)}</b> · {d.campaignName || campaignLabel[d.campaignType ?? "none"]}
                      </span>
                    </div>
                    <div className="m-row-kv">
                      <span>رتبه مشهد / ترب</span>
                      <span className="num text-xs">
                        {d.projectedLocalRank ? `#${faNum(d.projectedLocalRank)}` : "—"} /{" "}
                        {d.projectedNationalRank ? `#${faNum(d.projectedNationalRank)}` : "—"}
                      </span>
                    </div>
                    <div className="m-row-kv">
                      <span>سود خالص</span>
                      <span className="num text-xs">{toman(d.netProfitToman)}</span>
                    </div>
                    {isActionable(d) && (
                      <div className="border-t border-slate-100 pt-2">
                        <DecisionActions
                          decisionId={d.id}
                          force
                          {...actionProps(d)}
                          syncFailed={isDecisionSyncFailed(d)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="table-scroll hidden lg:block">
                <table className="data min-w-[940px]">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>زمان</th>
                      <th>کف همکار</th>
                      <th>سقف معیار</th>
                      <th>کف نهایی</th>
                      <th>تخفیف / کمپین</th>
                      <th>رتبه مشهد</th>
                      <th>رتبه ترب</th>
                      <th>سود خالص</th>
                      <th>وضعیت</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d) => (
                      <tr key={d.id}>
                        <td className="num">{d.id}</td>
                        <td className="text-xs whitespace-nowrap">{faDate(d.createdAt)}<ListingLinks panels={decisionPanels(d.steps)} /></td>
                        <td className="num">{toman(d.hardFloorPrice ?? d.effectiveCostPrice)}</td>
                        <td className="num text-slate-400 line-through">{toman(d.basePrice)}</td>
                        <td className="num font-medium text-emerald-700">{toman(d.finalPrice)}</td>
                        <td className="text-xs">
                          <span className="font-bold text-rose-600">{pct(d.discountPct, 0)}</span> ·{" "}
                          {d.campaignName || campaignLabel[d.campaignType ?? "none"]}
                        </td>
                        <td className="num font-bold text-indigo-700">
                          {d.projectedLocalRank ? `#${faNum(d.projectedLocalRank)}` : "—"}
                        </td>
                        <td className="num">{d.projectedNationalRank ? `#${faNum(d.projectedNationalRank)}` : "—"}</td>
                        <td className="num">{toman(d.netProfitToman)}</td>
                        <td>
                          <span className={`badge ${statusColor[d.status] ?? "bg-slate-100"}`}>
                            {statusLabel[d.status] ?? d.status}
                          </span>
                        </td>
                        <td>
                          {isActionable(d) && (
                            <DecisionActions
                              decisionId={d.id}
                              force
                              {...actionProps(d)}
                              syncFailed={isDecisionSyncFailed(d)}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "edit" && (
        <div className="card">
          <h2 className="mb-4 font-bold text-slate-900">ویرایش محصول، لیست قیمت همکاران و سیستم تخفیف ترجیحی</h2>
          <ProductForm
            initial={{
              id: product.id,
              sku: product.sku,
              name: product.name,
              category: product.category ?? "",
              storeExternalId: product.storeExternalId ?? "",
              sourceType: product.sourceType,
              torobUrl: product.torobUrl ?? "",
              costPrice: product.costPrice,
              minMarginPct: product.minMarginPct ?? "",
              minProfitAmount: product.minProfitAmount ?? "",
              preferredCampaignType: product.preferredCampaignType ?? "auto",
              showInFeatured: product.showInFeatured,
            }}
            initialQuotes={product.supplierQuotes}
          />
        </div>
      )}
    </div>
  );
}

function Box({ title, value, sub, strong }: { title: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`num mt-1.5 break-words ${strong ? "text-xl font-extrabold text-emerald-700" : "text-lg font-bold text-slate-900"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] leading-4 text-slate-400">{sub}</div>}
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{k}</div>
      <div className="num mt-0.5 text-sm font-semibold text-slate-900">{v}</div>
    </div>
  );
}
