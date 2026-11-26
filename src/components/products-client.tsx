"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  campaignColor,
  campaignLabel,
  campaignShortLabel,
  faDate,
  faNum,
  pct,
  statusColor,
  statusLabel,
  toman,
} from "@/lib/format";
import { CardRangeRunner, RunButton } from "./actions";
import { IconGrid, IconPlus, IconSearch, IconTable } from "./icons";
import { ProductForm } from "./product-form";
import { EmptyState, ModalSheet } from "./ui";

export interface ProductListItem {
  id: number;
  cardIndex: number;
  sku: string;
  name: string;
  category: string | null;
  sourceType: string;
  costPrice: number;
  currentHardFloorPrice: number | null;
  currentBasePrice: number | null;
  currentFinalPrice: number | null;
  currentDiscountPct: number | null;
  currentCampaign: string | null;
  currentCampaignName: string | null;
  currentShowInFeatured: boolean | null;
  status: string;
  lastCheckedAt: string | null;
}

type StatusFilter = "all" | "active" | "paused" | "needs_review";
type SortBy = "card" | "price_asc" | "price_desc" | "discount_desc" | "recent";

export function ProductsClient({ products }: { products: ProductListItem[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("card");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category?.trim()) set.add(p.category.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fa"));
  }, [products]);

  const counts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let needsReview = 0;
    for (const p of products) {
      if (p.status === "active") active++;
      else if (p.status === "paused") paused++;
      else if (p.status === "needs_review") needsReview++;
    }
    return { all: products.length, active, paused, needsReview };
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (campaignFilter !== "all" && (p.currentCampaign ?? "none") !== campaignFilter) return false;
      if (categoryFilter !== "all" && (p.category?.trim() ?? "") !== categoryFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.sku} ${p.category ?? ""} #${p.cardIndex}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "price_asc") return (a.currentFinalPrice ?? Infinity) - (b.currentFinalPrice ?? Infinity);
      if (sortBy === "price_desc") return (b.currentFinalPrice ?? -1) - (a.currentFinalPrice ?? -1);
      if (sortBy === "discount_desc") return (b.currentDiscountPct ?? -1) - (a.currentDiscountPct ?? -1);
      if (sortBy === "recent") {
        const ta = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
        const tb = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
        return tb - ta;
      }
      return a.cardIndex - b.cardIndex;
    });
  }, [products, query, statusFilter, campaignFilter, categoryFilter, sortBy]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAllFiltered = () => setSelectedIds(filtered.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const statusChips: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "همه", count: counts.all },
    { key: "active", label: "فعال", count: counts.active },
    { key: "needs_review", label: "نیاز به بازبینی", count: counts.needsReview },
    { key: "paused", label: "متوقف", count: counts.paused },
  ];

  return (
    <div className="space-y-5">
      {/* هدر */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-extrabold text-slate-900 sm:text-2xl">
              مدیریت کارت‌های محصول و رنج‌های تخفیف
            </h1>
            <span className="badge bg-indigo-50 text-indigo-700 num">{faNum(products.length)} کارت</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            هر محصول دارای یک شماره کارت است که می‌توانید استعلام سقف و کف و اعمال تخفیف را تکی، انتخابی یا در بازه دلخواه اجرا کنید.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onClick={() => setAddOpen(true)} className="btn-primary flex-1 sm:flex-initial">
            <IconPlus className="h-4 w-4" />
            <span>افزودن محصول جدید</span>
          </button>
          <div className="flex-1 sm:flex-initial">
            <RunButton label="استعلام ۵ کارت اول" className="btn-secondary w-full sm:w-auto" />
          </div>
        </div>
      </div>

      {/* ابزار اجرای رنج کارت‌ها */}
      <CardRangeRunner totalCards={products.length} defaultCollapsedOnMobile />

      {/* نوار جستجو، فیلتر و مرتب‌سازی */}
      <div className="card space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {statusChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatusFilter(c.key)}
                className={`chip ${statusFilter === c.key ? "chip-active" : ""}`}
              >
                <span>{c.label}</span>
                <span className={`num text-[11px] ${statusFilter === c.key ? "text-indigo-100" : "text-slate-400"}`}>
                  ({faNum(c.count)})
                </span>
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 lg:inline-flex">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-label="نمای جدول"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${
                viewMode === "table" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <IconTable className="h-3.5 w-3.5" />
              <span>جدول</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label="نمای کارتی"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${
                viewMode === "grid" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <IconGrid className="h-3.5 w-3.5" />
              <span>کارتی</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pr-9 text-xs"
              placeholder="جستجو در نام، SKU، دسته یا #کارت…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <select
            className="input text-xs"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            aria-label="فیلتر کمپین"
          >
            <option value="all">همه سیستم‌های تخفیف</option>
            <option value="flash">پیشنهاد لحظه‌ای</option>
            <option value="featured">پیشنهاد شگفت‌انگیز</option>
            <option value="timed_sale">فرصت زمان‌دار</option>
            <option value="none">بدون کمپین</option>
          </select>

          <select
            className="input text-xs"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="فیلتر دسته‌بندی"
          >
            <option value="all">همه دسته‌بندی‌ها</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            className="input text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="مرتب‌سازی"
          >
            <option value="card">مرتب‌سازی: شماره کارت</option>
            <option value="price_asc">ارزان‌ترین قیمت فروش</option>
            <option value="price_desc">گران‌ترین قیمت فروش</option>
            <option value="discount_desc">بیشترین درصد تخفیف</option>
            <option value="recent">جدیدترین استعلام</option>
          </select>
        </div>
      </div>

      {/* نوار عملیات گروهی هنگام انتخاب چند محصول */}
      {selectedIds.length > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-300 bg-indigo-50 px-4 py-3 shadow-md">
          <div className="text-xs font-bold text-indigo-950 sm:text-sm">
            <span className="num">{faNum(selectedIds.length)}</span> کارت انتخاب شده است
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RunButton
              productIds={selectedIds}
              label={`⚡ استعلام ${faNum(selectedIds.length)} کارت انتخابی`}
              className="btn-primary btn-sm"
              onDone={clearSelection}
            />
            <button type="button" onClick={selectAllFiltered} className="btn-secondary btn-sm">
              انتخاب همه فیلترشده‌ها ({faNum(filtered.length)})
            </button>
            <button type="button" onClick={clearSelection} className="btn-ghost btn-sm">
              لغو انتخاب
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title="محصولی مطابق فیلترها پیدا نشد"
          description="می‌توانید جستجو را پاک کنید یا یک کارت محصول جدید اضافه نمایید."
          action={
            <button type="button" onClick={() => setAddOpen(true)} className="btn-primary btn-sm">
              <IconPlus className="h-4 w-4" />
              <span>افزودن محصول</span>
            </button>
          }
        />
      ) : (
        <>
          {/* نمای کارتی: همیشه در موبایل/تبلت، و در دسکتاپ وقتی نمای کارتی انتخاب شده */}
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 ${viewMode === "grid" ? "" : "lg:hidden"}`}>
            {filtered.map((p) => {
              const checked = selectedSet.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`m-row flex flex-col justify-between gap-3 transition ${
                    checked ? "border-indigo-400 ring-2 ring-indigo-100" : ""
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(p.id)}
                          aria-label={`انتخاب ${p.name}`}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600"
                        />
                        <span className="min-w-0 flex-1">
                          <Link href={`/products/${p.id}`} className="block truncate font-bold text-indigo-700 hover:underline">
                            {p.name}
                          </Link>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            کارت #{faNum(p.cardIndex)} · {p.sku}
                            {p.category ? ` · ${p.category}` : ""}
                          </span>
                        </span>
                      </label>
                      <span className={`badge shrink-0 ${statusColor[p.status] ?? "bg-slate-100"}`}>
                        {statusLabel[p.status] ?? p.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                      <div>
                        <div className="text-[11px] text-slate-500">کف قطعی فروش</div>
                        <div className="num text-base font-extrabold text-emerald-700">{toman(p.currentFinalPrice)}</div>
                      </div>
                      <div className="text-left">
                        <div className="num text-xs text-slate-400 line-through">{toman(p.currentBasePrice)}</div>
                        <span className="num mt-0.5 inline-block rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                          {pct(p.currentDiscountPct, 0)} تخفیف
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="m-row-kv">
                        <span>تمام‌شده / کف امن</span>
                        <span className="num text-xs">{toman(p.costPrice || p.currentHardFloorPrice)}</span>
                      </div>
                      <div className="m-row-kv">
                        <span>سیستم تخفیف</span>
                        <span className="flex items-center gap-1">
                          <span className={`badge border text-[11px] ${campaignColor[p.currentCampaign ?? "none"] ?? "bg-slate-100"}`}>
                            {p.currentCampaignName || campaignShortLabel[p.currentCampaign ?? "none"] || "عادی"}
                          </span>
                          {p.currentShowInFeatured && <span className="text-[11px] text-indigo-700">★</span>}
                        </span>
                      </div>
                      <div className="m-row-kv">
                        <span>آخرین استعلام</span>
                        <span className="text-xs">{faDate(p.lastCheckedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t border-slate-100 pt-2.5">
                    <Link href={`/products/${p.id}`} className="btn-secondary btn-sm flex-1">
                      جزئیات و ویرایش
                    </Link>
                    <div className="flex-1">
                      <RunButton productIds={[p.id]} label="استعلام کارت" className="btn-primary btn-sm w-full" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* نمای جدولی دسکتاپ */}
          {viewMode === "table" && (
            <div className="card hidden p-0 lg:block">
              <div className="table-scroll border-0">
                <table className="data min-w-[1040px]">
                  <thead>
                    <tr>
                      <th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="انتخاب همه"
                          checked={filtered.length > 0 && filtered.every((p) => selectedSet.has(p.id))}
                          onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                      </th>
                      <th># کارت</th>
                      <th>محصول</th>
                      <th>منبع</th>
                      <th>تمام‌شده / کف امن</th>
                      <th>سقف معیار (خط‌خورده)</th>
                      <th>کف قطعی فروش</th>
                      <th>درصد تخفیف</th>
                      <th>سیستم تخفیف فعال</th>
                      <th>آخرین استعلام</th>
                      <th>وضعیت</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => {
                      const checked = selectedSet.has(p.id);
                      return (
                        <tr key={p.id} className={checked ? "bg-indigo-50/50" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(p.id)}
                              aria-label={`انتخاب ${p.name}`}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                            />
                          </td>
                          <td className="num">
                            <span className="badge bg-slate-100 font-bold text-slate-700">کارت #{faNum(p.cardIndex)}</span>
                          </td>
                          <td className="max-w-[260px]">
                            <Link href={`/products/${p.id}`} className="block truncate font-medium text-indigo-700 hover:underline">
                              {p.name}
                            </Link>
                            <div className="truncate text-xs text-slate-400">
                              {p.sku}
                              {p.category ? ` · ${p.category}` : ""}
                            </div>
                          </td>
                          <td>{p.sourceType === "torob" ? "ترب" : p.sourceType}</td>
                          <td className="num">{toman(p.costPrice || p.currentHardFloorPrice)}</td>
                          <td className="num line-through decoration-slate-400">{toman(p.currentBasePrice)}</td>
                          <td className="num font-bold text-emerald-700">{toman(p.currentFinalPrice)}</td>
                          <td className="num font-bold text-rose-600">{pct(p.currentDiscountPct, 0)}</td>
                          <td>
                            <div className="flex flex-col gap-1">
                              <span className={`badge border ${campaignColor[p.currentCampaign ?? "none"] ?? "bg-slate-100"}`}>
                                {p.currentCampaignName || campaignLabel[p.currentCampaign ?? "none"]}
                              </span>
                              {p.currentShowInFeatured && (
                                <span className="text-[10px] font-medium text-indigo-700">★ در منتخب‌های صفحه اصلی</span>
                              )}
                            </div>
                          </td>
                          <td className="text-xs whitespace-nowrap">{faDate(p.lastCheckedAt)}</td>
                          <td>
                            <span className={`badge ${statusColor[p.status] ?? "bg-slate-100"}`}>
                              {statusLabel[p.status] ?? p.status}
                            </span>
                          </td>
                          <td>
                            <RunButton productIds={[p.id]} label="استعلام" className="btn-secondary btn-sm" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* پنجره افزودن محصول جدید */}
      <ModalSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="افزودن کارت محصول جدید"
        subtitle="اطلاعات پایه، قیمت خرید و لیست همکاران را ثبت کنید"
        maxWidth="lg"
      >
        <ProductForm onDone={() => setAddOpen(false)} />
      </ModalSheet>
    </div>
  );
}
