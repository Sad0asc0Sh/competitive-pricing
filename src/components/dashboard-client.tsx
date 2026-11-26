"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  campaignLabel,
  campaignShortLabel,
  campaignColor,
  faNum,
  pct,
  statusColor,
  statusLabel,
  toman,
} from "@/lib/format";
import { IconChevronDown, IconSearch } from "./icons";
import { EmptyState } from "./ui";

export interface DashboardDecisionItem {
  id: number;
  productId: number;
  name: string;
  sku: string;
  status: string;
  finalPrice: number | null;
  basePrice: number | null;
  discountPct: number | null;
  campaignType: string | null;
  campaignName: string | null;
  showInFeatured: boolean;
  localLowestValid: number | null;
  lowestValid: number | null;
  hardFloorPrice: number | null;
  effectiveCostPrice: number | null;
  projectedLocalRank: number | null;
  projectedNationalRank: number | null;
  netProfitToman: number | null;
  netMarginPct: number | null;
  createdAt: string;
}

type StatusFilter = "all" | "applied" | "pending_review" | "issues";

export function DashboardDecisionsSection({ decisions }: { decisions: DashboardDecisionItem[] }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const counts = useMemo(() => {
    let applied = 0;
    let pending = 0;
    let issues = 0;
    for (const d of decisions) {
      if (d.status === "applied") applied++;
      else if (d.status === "pending_review") pending++;
      else if (["rejected", "failed", "sync_failed", "pending_sync"].includes(d.status)) issues++;
    }
    return { all: decisions.length, applied, pending, issues };
  }, [decisions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decisions.filter((d) => {
      if (filter === "applied" && d.status !== "applied") return false;
      if (filter === "pending_review" && d.status !== "pending_review") return false;
      if (filter === "issues" && !["rejected", "failed", "sync_failed", "pending_sync"].includes(d.status)) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [decisions, filter, query]);

  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "همه", count: counts.all },
    { key: "applied", label: "اعمال‌شده", count: counts.applied },
    { key: "pending_review", label: "در انتظار بازبینی", count: counts.pending },
    { key: "issues", label: "رد / خطا", count: counts.issues },
  ];

  return (
    <section className="card space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">آخرین تصمیم‌های موتور</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            کشف سقف واقعی بازار بدون پرت → اعمال درصد تخفیف روی کف رقابتی
          </p>
        </div>
        <Link href="/runs" className="btn-secondary btn-sm self-start sm:self-auto">
          همه اجراها ←
        </Link>
      </div>

      {/* فیلتر چیپی + جستجو */}
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`chip ${filter === c.key ? "chip-active" : ""}`}
            >
              <span>{c.label}</span>
              <span className={`num text-[11px] ${filter === c.key ? "text-indigo-100" : "text-slate-400"}`}>
                ({faNum(c.count)})
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pr-9 text-xs"
            placeholder="جستجوی نام محصول یا SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="تصمیمی مطابق فیلتر فعلی یافت نشد"
          description="فیلتر را تغییر دهید یا از صفحه محصولات یک استعلام جدید اجرا کنید."
        />
      ) : (
        <>
          {/* نمای موبایل و تبلت */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((d) => {
              const isExpanded = expandedId === d.id;
              return (
                <div key={d.id} className="m-row space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/products/${d.productId}`} className="block truncate font-bold text-indigo-700">
                        {d.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-400">{d.sku}</div>
                    </div>
                    <span className={`badge shrink-0 ${statusColor[d.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {statusLabel[d.status] ?? d.status}
                    </span>
                  </div>

                  {/* باکس قیمت برجسته */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <div>
                      <div className="text-[11px] text-slate-500">کف قطعی ما</div>
                      <div className="num text-base font-extrabold text-emerald-700">{toman(d.finalPrice)}</div>
                    </div>
                    <div className="text-left">
                      <div className="num text-xs text-slate-400 line-through">{toman(d.basePrice)}</div>
                      <div className="mt-0.5 flex items-center justify-end gap-1.5">
                        <span className="num rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                          {pct(d.discountPct, 0)}
                        </span>
                        <span
                          className={`badge border text-[11px] ${campaignColor[d.campaignType ?? "none"] ?? "bg-slate-100"}`}
                        >
                          {d.campaignName || campaignShortLabel[d.campaignType ?? "none"] || "عادی"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50/60"
                  >
                    <span>{isExpanded ? "بستن جزئیات بازار و سود" : "نمایش کف مشهد/ترب، رتبه و سود"}</span>
                    <IconChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>

                  {isExpanded && (
                    <div className="space-y-1 border-t border-slate-100 pt-2">
                      <div className="m-row-kv">
                        <span>خط قرمز همکار</span>
                        <span className="num text-amber-700">{toman(d.hardFloorPrice ?? d.effectiveCostPrice)}</span>
                      </div>
                      <div className="m-row-kv">
                        <span>کف مشهد / ترب</span>
                        <span className="num text-xs">
                          {toman(d.localLowestValid)} / {toman(d.lowestValid)}
                        </span>
                      </div>
                      <div className="m-row-kv">
                        <span>رتبه مشهد / ترب</span>
                        <span className="num text-xs">
                          مشهد {d.projectedLocalRank != null ? `#${faNum(d.projectedLocalRank)}` : "—"} | ترب{" "}
                          {d.projectedNationalRank != null ? `#${faNum(d.projectedNationalRank)}` : "—"}
                        </span>
                      </div>
                      <div className="m-row-kv">
                        <span>سود خالص</span>
                        <span className="num text-xs">
                          {toman(d.netProfitToman)} ({pct(d.netMarginPct)})
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* جدول دسکتاپ با اسکرول ایمن */}
          <div className="table-scroll hidden lg:block">
            <table className="data min-w-[960px]">
              <thead>
                <tr>
                  <th>محصول</th>
                  <th>خط قرمز همکار</th>
                  <th>کف مشهد / ترب</th>
                  <th>سقف معیار (خط‌خورده)</th>
                  <th>تخفیف</th>
                  <th>کف قطعی ما</th>
                  <th>سیستم تخفیف</th>
                  <th>رتبه مشهد / ترب</th>
                  <th>سود خالص</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td className="max-w-[240px]">
                      <Link href={`/products/${d.productId}`} className="block truncate font-medium text-indigo-700 hover:underline">
                        {d.name}
                      </Link>
                      <div className="text-xs text-slate-400">{d.sku}</div>
                    </td>
                    <td className="num font-medium text-amber-700">{toman(d.hardFloorPrice ?? d.effectiveCostPrice)}</td>
                    <td className="num text-xs">
                      مشهد: {toman(d.localLowestValid)}
                      <br />
                      ترب: {toman(d.lowestValid)}
                    </td>
                    <td className="num line-through decoration-slate-400">{toman(d.basePrice)}</td>
                    <td className="num font-bold text-rose-600">{pct(d.discountPct, 0)}</td>
                    <td className="num font-bold text-emerald-700">{toman(d.finalPrice)}</td>
                    <td>
                      <span className={`badge border ${campaignColor[d.campaignType ?? "none"] ?? "bg-slate-100"}`}>
                        {d.campaignName || campaignLabel[d.campaignType ?? "none"]}
                      </span>
                      {d.showInFeatured && (
                        <div className="mt-0.5 text-[10px] font-medium text-indigo-700">★ منتخب صفحه اصلی</div>
                      )}
                    </td>
                    <td className="num">
                      <span className="badge bg-indigo-50 text-indigo-800">
                        مشهد {d.projectedLocalRank != null ? `#${faNum(d.projectedLocalRank)}` : "—"} | ترب{" "}
                        {d.projectedNationalRank != null ? `#${faNum(d.projectedNationalRank)}` : "—"}
                      </span>
                    </td>
                    <td className="num text-xs font-medium">
                      {toman(d.netProfitToman)} ({pct(d.netMarginPct)})
                    </td>
                    <td>
                      <span className={`badge ${statusColor[d.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {statusLabel[d.status] ?? d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
