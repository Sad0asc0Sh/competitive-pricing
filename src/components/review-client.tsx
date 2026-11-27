"use client";

import { ListingLinks } from "./listing-links";
import type { ListingPanel } from "@/lib/pricing/listing";
import type { TorobCandidateTrace, TorobInquiryReport } from "@/lib/pricing/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
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
import { DecisionActions, RelinkTorobAction, RunButton, safeJsonFetch } from "./actions";
import { IconSearch } from "./icons";
import { EmptyState, SegmentedTabs, useToast } from "./ui";

export interface ReviewAlternativeScenario {
  finalPrice: number;
  p: number;
  lowestPrice: number;
  shopName: string;
}

export interface ReviewCompetitorItem {
  id: number;
  shopName: string;
  shopCity: string | null;
  price: number;
  sellerType: string;
  listingTitle: string | null;
  shopScore: number | null;
  isLocalCity: boolean;
  included: boolean;
  excludeReason: string | null;
}

export interface ReviewSupervisorGate {
  key: string;
  title: string;
  scorePct: number;
  verdict: string;
  reason: string;
}

export interface ReviewPendingItem {
  id: number;
  productId: number;
  name: string;
  sku: string;
  status: string;
  createdAt: string;
  cost: number;
  effectiveCost: number;
  current: number | null;
  referencePrice: number | null;
  marketMedian: number | null;
  basePrice: number | null;
  finalPrice: number | null;
  discountPct: number | null;
  campaignType: string | null;
  strategy: string | null;
  netProfitToman: number | null;
  netMarginPct: number | null;
  offersUsed: number;
  offersTotal: number;
  confidence: number;
  errorRiskPct: number;
  pRight: number | null;
  pTooHigh: number | null;
  pTooLow: number | null;
  alternative: ReviewAlternativeScenario | null;
  marketSigma: number | null;
  pAnchorOk: number | null;
  projectedNationalRank: number | null;
  rankIncludingSuspect: number | null;
  totalIncludingSuspect: number;
  marketConflict: boolean;
  isBelowFloor: boolean;
  syncFailed: boolean;
  readyForApproval: boolean;
  panels: ListingPanel[];
  inquiry: (TorobInquiryReport & { candidate?: TorobCandidateTrace }) | null;
  candidateUrl: string | null;
  effectiveFloor: number;
  reasons: string;
  supMsg: string | null;
  supOverallPct: number | null;
  supGates: ReviewSupervisorGate[];
  aiMsg: string | null;
  aiIdentityMsg: string | null;
  liquidationMsg: string | null;
  competitors: ReviewCompetitorItem[];
}

export interface ReviewRejectedItem {
  id: number;
  productId: number;
  name: string;
  sku: string;
  createdAt: string;
  finalPrice: number | null;
  basePrice: number | null;
  offersUsed: number;
  offersTotal: number;
  supMsg: string;
  supOverallPct: number | null;
  supGates: ReviewSupervisorGate[];
  torobUrl: string | null;
  panels: ListingPanel[];
  inquiry: TorobInquiryReport | null;
}

type ReviewTab = "all_pending" | "ready" | "pending_review" | "sync_issues" | "warnings" | "rejected";

function buildQuickPrices(item: ReviewPendingItem): Array<{ label: string; price: number }> {
  const seen = new Set<number>();
  const out: Array<{ label: string; price: number }> = [];
  const add = (label: string, raw: number | null | undefined) => {
    if (raw == null || !Number.isFinite(raw) || raw <= 0) return;
    const p = Math.round(raw);
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ label, price: p });
  };
  add("پیشنهاد بهینه موتور", item.finalPrice);
  add("میانه بازار ترب", item.marketMedian);
  if (item.alternative) {
    add(`سناریوی جایگزین (${Math.round(item.alternative.p * 100)}٪)`, item.alternative.finalPrice);
  }
  return out;
}

export function ReviewClient({
  pendingItems,
  rejectedItems,
}: {
  pendingItems: ReviewPendingItem[];
  rejectedItems: ReviewRejectedItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<ReviewTab>("all_pending");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkPending, startBulk] = useTransition();
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const readyCount = pendingItems.filter((x) => x.readyForApproval).length;

  const counts = useMemo(
    () => ({
      all_pending: pendingItems.length,
      ready: readyCount,
      pending_review: pendingItems.filter((x) => x.status === "pending_review" && !x.syncFailed).length,
      sync_issues: pendingItems.filter((x) => x.syncFailed).length,
      warnings: pendingItems.filter((x) => x.marketConflict || x.isBelowFloor).length,
      rejected: rejectedItems.length,
    }),
    [pendingItems, rejectedItems, readyCount],
  );

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pendingItems.filter((item) => {
      if (tab === "ready" && (!item.readyForApproval || item.syncFailed)) return false;
      if (tab === "pending_review" && (item.status !== "pending_review" || item.syncFailed)) return false;
      if (tab === "sync_issues" && !item.syncFailed) return false;
      if (tab === "warnings" && !item.marketConflict && !item.isBelowFloor) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pendingItems, tab, query]);

  const filteredRejected = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rejectedItems;
    return rejectedItems.filter(
      (item) => item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q),
    );
  }, [rejectedItems, query]);

  const selectableIds = useMemo(
    () =>
      filteredPending
        .filter((x) => x.readyForApproval)
        .map((x) => x.id),
    [filteredPending],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedVisibleIds = useMemo(
    () => selectableIds.filter((id) => selectedSet.has(id)),
    [selectableIds, selectedSet],
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBulkApprove = () => {
    const targets = selectedVisibleIds;
    if (!targets.length) return;
    startBulk(async () => {
      let okCount = 0;
      let errCount = 0;
      for (let i = 0; i < targets.length; i++) {
        setBulkProgress(`${i + 1}/${targets.length}`);
        const { ok } = await safeJsonFetch(`/api/decisions/${targets[i]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", force: true }),
        });
        if (ok) okCount++;
        else errCount++;
      }
      setBulkProgress(null);
      setSelectedIds([]);
      if (errCount === 0) toast.success(`${faNum(okCount)} تصمیم با موفقیت تأیید و ارسال شد`);
      else toast.info(`${faNum(okCount)} تأیید شد · ${faNum(errCount)} مورد با خطا متوقف ماند`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">صف بررسی قیمت‌ها</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <RunButton label="استعلام ۵ محصول اول" className="btn-primary btn-sm" />
          <div className="relative w-full sm:w-56">
            <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pr-9 text-xs"
              placeholder="جستجو (نام یا SKU)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <SegmentedTabs<ReviewTab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "all_pending", label: "همه صف قیمت‌گذاری", count: counts.all_pending },
          { key: "ready", label: "آماده تأیید سریع", count: counts.ready },
          { key: "pending_review", label: "در انتظار بررسی", count: counts.pending_review },
          { key: "sync_issues", label: "خطای همگام‌سازی", count: counts.sync_issues },
          { key: "warnings", label: "تعارض / زیر کف", count: counts.warnings },
          { key: "rejected", label: "ردشده‌های ناظر", count: counts.rejected },
        ]}
      />

      {tab !== "rejected" && selectableIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-indigo-950">
            <button
              type="button"
              onClick={() => setSelectedIds(selectableIds)}
              className="btn-secondary btn-sm text-xs"
              disabled={bulkPending}
            >
              انتخاب همهٔ موارد مجاز ({faNum(selectableIds.length)})
            </button>
            {selectedVisibleIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs font-medium text-slate-600 hover:underline"
                disabled={bulkPending}
              >
                لغو انتخاب ({faNum(selectedVisibleIds.length)})
              </button>
            )}
          </div>
          {selectedVisibleIds.length > 0 && (
            <button
              type="button"
              onClick={runBulkApprove}
              disabled={bulkPending}
              className="btn-success btn-sm text-xs"
            >
              {bulkPending
                ? `در حال تأیید ${bulkProgress ?? ""}…`
                : `✅ تأیید گروهی ${faNum(selectedVisibleIds.length)} مورد انتخاب‌شده`}
            </button>
          )}
        </div>
      )}

      {tab !== "rejected" ? (
        <div className="space-y-4">
          {filteredPending.map((item) => {
            const blocked = item.inquiry && item.inquiry.status !== "MATCH_CONFIRMED";
            const canBulkSelect = item.readyForApproval;
            const confPct = Math.round((item.confidence ?? 0) * 100);
            const quickPrices = buildQuickPrices(item);
            return (
              <div key={item.id} className="card space-y-3.5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {canBulkSelect && (
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          aria-label={`انتخاب ${item.name}`}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                      )}
                      <Link
                        href={`/products/${item.productId}`}
                        className="text-base font-bold text-indigo-700 hover:underline sm:text-lg"
                      >
                        {item.name}
                      </Link>
                      <span className={`badge ${statusColor[item.status] ?? "bg-slate-100"}`}>
                        {statusLabel[item.status] ?? item.status}
                      </span>
                      {item.readyForApproval && !item.syncFailed && (
                        <span className="badge bg-emerald-100 text-emerald-800">✅ آماده تأیید سریع</span>
                      )}
                      {item.isBelowFloor && (
                        <span className="badge bg-rose-100 text-rose-800">⚠️ زیر کف سود</span>
                      )}
                      {item.effectiveCost <= 0 && <Link className="text-xs text-amber-800 underline" href={`/products/${item.productId}`}>ثبت بهای خرید</Link>}
                      {item.marketConflict && (
                        <span className="badge bg-amber-100 text-amber-900">تعارض بازار</span>
                      )}
                      {item.supOverallPct != null && (
                        <span className="badge bg-slate-100 text-slate-700">
                          امتیاز کل ناظر: {faNum(item.supOverallPct)}٪
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>
                        {item.sku} · تصمیم #{faNum(item.id)} · {faDate(item.createdAt)} ·{" "}
                        <OfferCounts inquiry={item.inquiry} used={item.offersUsed} total={item.offersTotal} />
                      </span>
                      <ListingLinks panels={item.panels} />
                      {item.strategy === "hold_own_price" && <span>تنها فروشندهٔ مشاهده‌شده خودمان هستیم</span>}
                    </div>
                  </div>

                  {!blocked && <DecisionActions
                    decisionId={item.id}
                    force
                    hardFloor={item.effectiveFloor}
                    isBelowFloor={item.isBelowFloor || item.effectiveCost <= 0}
                    syncFailed={item.syncFailed}
                    initialFinalPrice={item.finalPrice}
                    initialBasePrice={item.basePrice}
                    initialDiscountPct={item.discountPct}
                    initialCampaignType={item.campaignType}
                    effectiveCost={item.effectiveCost}
                    quickPrices={quickPrices}
                  />}
                </div>

                {blocked && item.inquiry && (
                  <>
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
                      <strong>{torobStatusLabel[item.inquiry.status]}</strong> · {item.inquiry.reason}
                      {item.inquiry.candidate?.titleFa && <span> · {item.inquiry.candidate.titleFa}</span>}
                    </p>
                    <RelinkTorobAction decisionId={item.id} initialTorobUrl={item.candidateUrl}
                      canConfirmCurrent={item.inquiry.status === "REVIEW_REQUIRED" && Boolean(item.inquiry.candidate)} />
                  </>
                )}
                {!blocked && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Item k="قیمت پیشنهادی" v={toman(item.finalPrice)} strong />
                  <Item k="کف مجاز فروش" v={toman(item.effectiveFloor || null)} />
                  <Item k="میانهٔ رقبا" v={toman(item.marketMedian)} />
                  <Item k="تخفیف و کمپین" v={item.discountPct ? `${pct(item.discountPct)} · ${campaignLabel[item.campaignType ?? "none"]}` : "بدون تخفیف"} />
                </div>}
                <details className="space-y-3">
                  <summary className="cursor-pointer py-1 text-xs font-semibold text-slate-700">فروشندگان و جزئیات استعلام</summary>
                {!blocked && <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-indigo-950">📊 تحلیل آماری و ضریب خطا:</span>
                      <span
                        className={`badge ${
                          item.errorRiskPct <= 15
                            ? "bg-emerald-100 text-emerald-800"
                            : item.errorRiskPct <= 30
                              ? "bg-amber-100 text-amber-900"
                              : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        اعتماد: {faNum(confPct)}٪ · ضریب خطای تخمینی: {faNum(item.errorRiskPct)}٪
                      </span>
                      {item.pRight != null && (
                        <span className="text-[11px] text-slate-600">
                          احتمال صحت قیمت: <strong className="num">{faNum(Math.round(item.pRight * 100))}٪</strong>
                        </span>
                      )}
                      {item.pTooHigh != null && item.pTooLow != null && (
                        <span className="text-[11px] text-slate-600">
                          (ریسک گران‌بودن: <strong className="num">{faNum(Math.round(item.pTooHigh * 100))}٪</strong> · ریسک ارزان‌بودن:{" "}
                          <strong className="num">{faNum(Math.round(item.pTooLow * 100))}٪</strong>)
                        </span>
                      )}
                    </div>
                    {item.strategy && (
                      <span className="text-[11px] font-medium text-indigo-800">
                        استراتژی: {strategyLabel[item.strategy] ?? item.strategy}
                      </span>
                    )}
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${
                        confPct >= 80 ? "bg-emerald-500" : confPct >= 60 ? "bg-amber-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.max(4, Math.min(100, confPct))}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                    {item.marketSigma != null && (
                      <span>
                        پراکندگی بازار (σ):{" "}
                        <strong className="num text-slate-800">{faNum(item.marketSigma * 100, 1)}٪</strong>
                      </span>
                    )}
                    {item.pAnchorOk != null && (
                      <span>
                        اطمینان به کف بازار:{" "}
                        <strong className="num text-slate-800">{faNum(Math.round(item.pAnchorOk * 100))}٪</strong>
                      </span>
                    )}
                    {item.netProfitToman != null && item.effectiveCost > 0 && (
                      <span>
                        سود خالص روی قیمت همکار:{" "}
                        <strong className={`num ${item.netProfitToman > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {toman(item.netProfitToman)}
                          {item.netMarginPct != null ? ` (${faNum(item.netMarginPct, 1)}٪)` : ""}
                        </strong>
                      </span>
                    )}
                  </div>

                  {item.alternative && (
                    <div className="rounded-lg border border-indigo-200/80 bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-700">
                      🔄 <strong>سناریوی جایگزین احتمالی:</strong>{" "}
                      <span className="num font-semibold text-indigo-800">{toman(item.alternative.finalPrice)}</span>{" "}
                      (احتمال <span className="num">{faNum(Math.round(item.alternative.p * 100))}٪</span> — اگر کف واقعی متعلق به «
                      {item.alternative.shopName}» با {toman(item.alternative.lowestPrice)} باشد)
                    </div>
                  )}
                </div>}

                {!blocked && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Item k="بهای خرید" v={toman(item.effectiveCost || item.cost)} />
                  <Item k="قیمت فعلی سایت" v={toman(item.current)} />
                  {(item.discountPct ?? 0) > 0 && <Item k="قیمت پیش از تخفیف" v={toman(item.basePrice)} />}
                  <Item k="رتبهٔ کشوری" v={item.projectedNationalRank ? faNum(item.projectedNationalRank) : "—"} />
                </div>}

                <SupervisorGateChips gates={item.supGates} />

                {item.competitors.length > 0 && (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
                    <div className="mb-1.5 text-[11px] font-semibold text-slate-600">
                      پیشنهادهای مشاهده‌شده در ترب
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {item.competitors.map((c) => (
                        <div
                          key={c.id}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                            c.included
                              ? "border-slate-200 bg-white text-slate-800"
                              : "border-amber-200 bg-amber-50/70 text-amber-900"
                          }`}
                        >
                          <div className="min-w-0 truncate">
                            <span className="font-medium">{c.shopName}</span>
                            <span className="mr-1 text-[10px] text-slate-500">{c.sellerType === "in_person" ? "حضوری" : "اینترنتی"}</span>
                            {c.listingTitle && <div className="truncate" title={c.listingTitle}>{c.listingTitle}</div>}
                            {c.shopCity && (
                              <span className={`mr-1 text-[10px] ${c.isLocalCity ? "font-bold text-indigo-700" : "text-slate-400"}`}>
                                ({c.shopCity})
                              </span>
                            )}
                            {!c.included && c.excludeReason && (
                              <div className="truncate text-[10px] text-amber-700">حذف: {c.excludeReason}</div>
                            )}
                          </div>
                          <div className="num shrink-0 font-semibold">{toman(c.price)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {item.marketConflict && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-6 text-rose-800">
                    ⚠️ تعارض بازار: فروشنده‌ی «مشکوک پایین» زیر قیمت پیشنهادی ما هست — پیش از تأیید، رتبه‌ی ستون
                    «با مشکوک» را با رتبه‌ی رسمی مقایسه کنید.
                  </p>
                )}

                {item.liquidationMsg && (
                  <p className="rounded-xl border border-cyan-200 bg-cyan-50 px-3.5 py-2.5 text-xs leading-6 text-cyan-900">
                    🧮 فیلتر فروشنده منفرد نقدکننده انبار: {item.liquidationMsg}
                  </p>
                )}

                {item.aiIdentityMsg && (
                  <p className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-xs leading-6 text-violet-900">
                    🔎 تطابق پنل ترب (AI): {item.aiIdentityMsg}
                  </p>
                )}

                {item.reasons && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-900 sm:text-sm">
                    {item.reasons}
                  </p>
                )}

                {item.supMsg && (
                  <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs leading-6 text-indigo-900">
                    🛡️ ناظر: {item.supMsg}
                  </p>
                )}

                {item.aiMsg && (
                  <p className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs leading-6 text-slate-700">
                    🤖 هوش مصنوعی: {item.aiMsg}
                  </p>
                )}
                </details>
              </div>
            );
          })}

          {filteredPending.length === 0 && (
            <EmptyState
              title={pendingItems.length === 0 ? "صف قیمت‌گذاری خالی است ✅" : "موردی مطابق فیلتر انتخاب‌شده یافت نشد"}
              description={
                pendingItems.length === 0
                  ? "در حال حاضر همه تصمیم‌ها بررسی شده‌اند یا منتظر اجرای بعدی هستند."
                  : "فیلتر یا عبارت جستجو را تغییر دهید."
              }
            />
          )}

        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">
              ردشده‌های اخیر ناظر (وارد فروشگاه نمی‌شوند)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              این تصمیم‌ها به‌خاطر امتیاز کل پایین‌تر از ۴۵٪ یا رد شدن در یکی از مقیاس‌های حیاتی متوقف شده‌اند؛ اگر پنل ترب انتخاب‌شده صحیح است با یک کلیک تأیید و استعلام مجدد بگیرید یا لینک دیگری ثبت کنید.
            </p>
          </div>
          {filteredRejected.map((r) => (
            <RejectedCard key={r.id} item={r} />
          ))}
          {filteredRejected.length === 0 && (
            <EmptyState title="مورد ردشده‌ای ثبت نشده است" />
          )}
        </div>
      )}
    </div>
  );
}

function SupervisorGateChips({ gates }: { gates: ReviewSupervisorGate[] }) {
  if (!gates.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {gates.map((g) => {
        const cls =
          g.verdict === "reject"
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : g.verdict === "approve"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800";
        return (
          <span
            key={g.key || g.title}
            title={g.reason}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${cls}`}
          >
            <span>{g.title || g.key}:</span>
            <strong className="num">{faNum(g.scorePct)}٪</strong>
            <span>({g.verdict === "reject" ? "رد" : g.verdict === "approve" ? "تأیید" : "بازبینی"})</span>
          </span>
        );
      })}
    </div>
  );
}

function RejectedCard({ item }: { item: ReviewRejectedItem }) {
  return (
    <div className="card border-rose-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/products/${item.productId}`} className="font-bold text-rose-700 hover:underline">
              {item.name}
            </Link>
            {item.supOverallPct != null && (
              <span className="badge bg-rose-100 text-rose-800">
                میانگین کل: {faNum(item.supOverallPct)}٪
              </span>
            )}
            {item.finalPrice != null && item.finalPrice > 0 && (
              <span className="badge bg-slate-100 text-slate-700 num">
                پیشنهاد موقت: {toman(item.finalPrice)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>
              {item.sku} · تصمیم #{faNum(item.id)} · {faDate(item.createdAt)} ·{" "}
              <OfferCounts inquiry={item.inquiry} used={item.offersUsed} total={item.offersTotal} />
            </span>
            <ListingLinks panels={item.panels} />
          </div>
        </div>
        <span className="badge bg-rose-100 text-rose-700">⛔ ردشده — غیرقابل اعمال</span>
      </div>
      <div className="mt-2">
        <SupervisorGateChips gates={item.supGates} />
      </div>
      <p className="mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-800">{item.supMsg}</p>
      <RelinkTorobAction
        decisionId={item.id}
        initialTorobUrl={item.torobUrl}
        canConfirmCurrent={!item.inquiry && item.panels.length > 0}
      />
    </div>
  );
}

function OfferCounts({ inquiry, used, total }: { inquiry: TorobInquiryReport | null; used: number; total: number }) {
  if (!inquiry) return <>{faNum(used)}/{faNum(total)} پیشنهاد معتبر</>;
  return <>{faNum(inquiry.extractedOffers)} استخراج‌شده · {inquiry.validOffers == null
    ? "اعتبار برای قیمت‌گذاری نامشخص" : `${faNum(inquiry.validOffers)} معتبر`}</>;
}

function Item({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{k}</div>
      <div className={`num mt-0.5 break-words ${strong ? "font-bold text-emerald-700" : "font-medium text-slate-800"}`}>
        {v}
      </div>
    </div>
  );
}
