"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { campaignLabel, faDate, faNum, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { DecisionActions } from "./actions";
import { IconSearch } from "./icons";
import { EmptyState, SegmentedTabs } from "./ui";

export interface ReviewPendingItem {
  id: number;
  productId: number;
  name: string;
  sku: string;
  status: string;
  createdAt: string;
  cost: number;
  current: number | null;
  referencePrice: number | null;
  basePrice: number | null;
  finalPrice: number | null;
  discountPct: number | null;
  campaignType: string | null;
  projectedNationalRank: number | null;
  rankIncludingSuspect: number | null;
  totalIncludingSuspect: number;
  marketConflict: boolean;
  isBelowFloor: boolean;
  syncFailed: boolean;
  reasons: string;
  supMsg: string | null;
  aiMsg: string | null;
}

export interface ReviewRejectedItem {
  id: number;
  productId: number;
  name: string;
  sku: string;
  createdAt: string;
  supMsg: string;
}

type ReviewTab = "all_pending" | "pending_review" | "sync_issues" | "warnings" | "rejected";

export function ReviewClient({
  pendingItems,
  rejectedItems,
}: {
  pendingItems: ReviewPendingItem[];
  rejectedItems: ReviewRejectedItem[];
}) {
  const [tab, setTab] = useState<ReviewTab>("all_pending");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => ({
      all_pending: pendingItems.length,
      pending_review: pendingItems.filter((x) => x.status === "pending_review" && !x.syncFailed).length,
      sync_issues: pendingItems.filter((x) => x.syncFailed).length,
      warnings: pendingItems.filter((x) => x.marketConflict || x.isBelowFloor).length,
      rejected: rejectedItems.length,
    }),
    [pendingItems, rejectedItems],
  );

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pendingItems.filter((item) => {
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

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-900 sm:text-2xl">صف بازبینی انسانی</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
            تصمیم‌هایی که موتور به دلیل اعتماد پایین، کمبود داده، جهش قیمت یا برخورد با کف سود، برای تأیید نگه داشته است.
          </p>
        </div>

        <div className="relative w-full sm:w-64 shrink-0">
          <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pr-9 text-xs"
            placeholder="جستجو در صف بازبینی (نام یا SKU)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <SegmentedTabs<ReviewTab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "all_pending", label: "همه صف بازبینی", count: counts.all_pending },
          { key: "pending_review", label: "در انتظار تأیید", count: counts.pending_review },
          { key: "sync_issues", label: "خطای همگام‌سازی", count: counts.sync_issues },
          { key: "warnings", label: "تعارض / زیر کف", count: counts.warnings },
          { key: "rejected", label: "ردشده‌های ناظر", count: counts.rejected },
        ]}
      />

      {tab !== "rejected" ? (
        <div className="space-y-4">
          {filteredPending.map((item) => (
            <div key={item.id} className="card space-y-3.5">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/products/${item.productId}`}
                      className="text-base font-bold text-indigo-700 hover:underline sm:text-lg"
                    >
                      {item.name}
                    </Link>
                    <span className={`badge ${statusColor[item.status] ?? "bg-slate-100"}`}>
                      {statusLabel[item.status] ?? item.status}
                    </span>
                    {item.isBelowFloor && (
                      <span className="badge bg-rose-100 text-rose-800">⚠️ زیر کف سود</span>
                    )}
                    {item.marketConflict && (
                      <span className="badge bg-amber-100 text-amber-900">تعارض بازار</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {item.sku} · تصمیم #{faNum(item.id)} · {faDate(item.createdAt)}
                  </div>
                </div>

                <DecisionActions
                  decisionId={item.id}
                  force
                  isBelowFloor={item.isBelowFloor}
                  syncFailed={item.syncFailed}
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                <Item k="تمام‌شده" v={toman(item.cost)} />
                <Item k="قیمت فعلی" v={toman(item.current)} />
                <Item k="مرجع بازار" v={toman(item.referencePrice)} />
                <Item k="پیشنهاد: اصلی" v={toman(item.basePrice)} />
                <Item k="پیشنهاد: نهایی" v={toman(item.finalPrice)} strong />
                <Item k="تخفیف / کمپین" v={`${pct(item.discountPct)} · ${campaignLabel[item.campaignType ?? "none"]}`} />
                <Item
                  k="رتبه ملی / با مشکوک"
                  v={`${item.projectedNationalRank != null ? `#${faNum(item.projectedNationalRank)}` : "—"} / ${
                    item.rankIncludingSuspect != null ? `#${faNum(item.rankIncludingSuspect)}` : "—"
                  } از ${item.totalIncludingSuspect ? faNum(item.totalIncludingSuspect) : "—"}`}
                />
              </div>

              {item.marketConflict && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-6 text-rose-800">
                  ⚠️ تعارض بازار: فروشنده‌ی «مشکوک پایین» زیر قیمت پیشنهادی ما هست — پیش از تأیید، رتبه‌ی ستون
                  «با مشکوک» را با رتبه‌ی رسمی مقایسه کنید.
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
            </div>
          ))}

          {filteredPending.length === 0 && (
            <EmptyState
              title={pendingItems.length === 0 ? "صف بازبینی خالی است ✅" : "موردی مطابق فیلتر انتخاب‌شده یافت نشد"}
              description={
                pendingItems.length === 0
                  ? "در حال حاضر همه تصمیم‌ها یا خودکار اعمال شده‌اند یا منتظر اجرای بعدی هستند."
                  : "فیلتر یا عبارت جستجو را تغییر دهید."
              }
            />
          )}

          {/* نمایش خلاصه ردشده‌ها در پایین تب اصلی در موبایل و دسکتاپ */}
          {tab === "all_pending" && rejectedItems.length > 0 && (
            <div className="pt-2">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                    ردشده‌های اخیر ناظر (وارد فروشگاه نمی‌شوند)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    تصمیم‌های زیر امتیاز آستانه رد گرفته‌اند و به‌صورت خودکار متوقف شده‌اند؛ دکمه «تأیید و اعمال» برای آن‌ها قفل است.
                  </p>
                </div>
                <button type="button" onClick={() => setTab("rejected")} className="btn-secondary btn-sm shrink-0">
                  مشاهده همه ({faNum(rejectedItems.length)})
                </button>
              </div>
              <div className="space-y-2.5">
                {filteredRejected.slice(0, 5).map((r) => (
                  <RejectedCard key={r.id} item={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">
              ردشده‌های اخیر ناظر (وارد فروشگاه نمی‌شوند)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              تصمیم‌های زیر امتیاز آستانه رد گرفته‌اند و به‌صورت خودکار متوقف شده‌اند؛ دکمه «تأیید و اعمال» برای آن‌ها قفل است.
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

function RejectedCard({ item }: { item: ReviewRejectedItem }) {
  return (
    <div className="card border-rose-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/products/${item.productId}`} className="font-bold text-rose-700 hover:underline">
            {item.name}
          </Link>
          <div className="mt-0.5 text-xs text-slate-400">
            {item.sku} · تصمیم #{faNum(item.id)} · {faDate(item.createdAt)}
          </div>
        </div>
        <span className="badge bg-rose-100 text-rose-700">⛔ ردشده — غیرقابل اعمال</span>
      </div>
      <p className="mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-800">{item.supMsg}</p>
    </div>
  );
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
