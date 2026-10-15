"use client";

import type { DiscountCampaign } from "@/db/schema";
import { badgeThemeLabel, campaignColor, campaignLabel } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Draft = {
  id?: number;
  name: string;
  type: string;
  active: boolean;
  priority: number;
  minDiscountPct: number;
  maxDiscountPct: number;
  activeHours: string;
  activeDays: string;
  categories: string;
  durationHours: number;
  badgeTheme: string;
  showInFeatured: boolean;
  cardRangeFrom: number;
  cardRangeTo: number;
  maxCards: number;
  minPriceToman: number;
  maxPriceToman: number;
  onlyTopRanked: boolean;
  targetProductIds: string;
};

const toDraft = (c?: DiscountCampaign): Draft => ({
  id: c?.id,
  name: c?.name ?? "",
  type: c?.type ?? "timed_sale",
  active: c?.active ?? true,
  priority: c?.priority ?? 10,
  minDiscountPct: c?.minDiscountPct ?? 5,
  maxDiscountPct: c?.maxDiscountPct ?? 45,
  activeHours: (c?.activeHours ?? []).join(","),
  activeDays: (c?.activeDays ?? []).join(","),
  categories: (c?.categories ?? []).join(","),
  durationHours: c?.durationHours ?? 48,
  badgeTheme: c?.badgeTheme ?? (c?.type === "flash" ? "gold-red" : c?.type === "featured" ? "red-purple" : "green-orange"),
  showInFeatured: c?.showInFeatured ?? (c?.type !== "flash"),
  cardRangeFrom: c?.cardRangeFrom ?? 1,
  cardRangeTo: c?.cardRangeTo ?? 50,
  maxCards: c?.maxCards ?? 0,
  minPriceToman: c?.minPriceToman ?? 0,
  maxPriceToman: c?.maxPriceToman ?? 0,
  onlyTopRanked: c?.onlyTopRanked ?? false,
  targetProductIds: (c?.targetProductIds ?? []).join(","),
});

export function CampaignEditor({ campaigns }: { campaigns: DiscountCampaign[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([...campaigns.map((c) => toDraft(c)), toDraft()]);
  const [pending, start] = useTransition();
  const [runMsg, setRunMsg] = useState<Record<string, string>>({});

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = (d: Draft) =>
    start(async () => {
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      router.refresh();
      if (!d.id) setDrafts((ds) => ds.map((x) => (x === d ? toDraft() : x)));
    });

  const remove = (id: number) =>
    start(async () => {
      await fetch("/api/campaigns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setDrafts((ds) => ds.filter((x) => x.id !== id));
      router.refresh();
    });

  const runOnCardRange = (d: Draft, key: string) =>
    start(async () => {
      setRunMsg((m) => ({ ...m, [key]: "در حال استعلام سقف و کف و اعمال تخفیف روی رنج کارت‌ها…" }));
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardRangeFrom: d.cardRangeFrom,
          cardRangeTo: d.cardRangeTo,
          category: d.categories.split(",")[0]?.trim() || undefined,
        }),
      });
      const j = await res.json();
      setRunMsg((m) => ({
        ...m,
        [key]: res.ok
          ? `انجام شد: ${j.applied} کارت اعمال شد | ${j.pendingReview} بازبینی | ${j.failed} خطا`
          : j.error ?? "خطا در اجرا",
      }));
      router.refresh();
    });

  return (
    <div className="space-y-5">
      {/* راهنمای بصری ۳ سیستم تخفیف فروشگاه sgeooole */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-900">۱. پیشنهاد لحظه‌ای (Flash Deal)</span>
            <span className="badge bg-amber-200 text-amber-900">صفحه اصلی</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            نمایش در ریل «پیشنهادهای لحظه‌ای» صفحه اصلی (`isFlashDeal = true`) با تم طلایی-قرمز. مناسب کارت‌های رتبه ۱ مشهد/ترب با درصد تخفیف جذاب (سقف بازار به کف رقابتی).
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-rose-900">۲. پیشنهاد شگفت‌انگیز (Special Offer)</span>
            <span className="badge bg-rose-200 text-rose-900">صفحه اصلی</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-rose-800">
            نمایش در بخش «شگفت‌انگیزها / منتخب‌ها» صفحه اصلی (`isSpecialOffer = true`). سقف قیمت بازار را خط زده و درصد تخفیف را دقیق روی کف هدف اعمال می‌کند.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-emerald-900">۳. فرصت‌های زمان‌دار (مالی و تخفیف)</span>
            <span className="badge bg-emerald-200 text-emerald-900">پنل مدیریت + منتخب‌ها</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            مدیریت خودکار کمپین‌های `Sale` در بخش «مالی و تخفیف» پنل ادمین با قابلیت انتخاب نام دلخواه، تم رنگی (`green-orange`, `gold-red`, `red-purple`) و تیک <b>«نمایش در منتخب‌های صفحه اصلی»</b>.
          </p>
        </div>
      </div>

      {drafts.map((d, i) => {
        const key = String(d.id ?? `new-${i}`);
        return (
          <div
            key={key}
            className={`card space-y-4 transition ${
              d.id ? "border-slate-200" : "border-2 border-dashed border-indigo-300 bg-indigo-50/20"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">{d.id ? d.name : "➕ تعریف قانون و کمپین تخفیف جدید"}</h2>
                <span className={`badge border ${campaignColor[d.type] ?? "bg-slate-100"}`}>
                  {campaignLabel[d.type] ?? d.type}
                </span>
                {d.type === "timed_sale" && (
                  <span className="badge bg-slate-100 text-slate-700">
                    تم: {badgeThemeLabel[d.badgeTheme] ?? d.badgeTheme}
                  </span>
                )}
                {d.showInFeatured && (
                  <span className="badge bg-indigo-100 text-indigo-800">★ نمایش در منتخب‌های صفحه اصلی</span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                بازه کارت‌ها: <b>کارت #{d.cardRangeFrom}</b> تا <b>کارت #{d.cardRangeTo}</b>
                {d.maxCards > 0 ? ` (حداکثر ${d.maxCards} کارت)` : " (بدون محدودیت تعداد)"}
              </div>
            </div>

            {/* ردیف اول: مشخصات اصلی سیستم تخفیف */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <div className="md:col-span-2">
                <label className="label">نام کمپین / برچسب روی کارت محصول</label>
                <input
                  className="input"
                  value={d.name}
                  placeholder="مثلاً جشنواره ویژه مشهد یا پیشنهاد لحظه‌ای"
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">سیستم تخفیف هدف در sgeooole</label>
                <select
                  className="input font-medium"
                  value={d.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    update(i, {
                      type: nextType,
                      badgeTheme:
                        nextType === "flash"
                          ? "gold-red"
                          : nextType === "featured"
                            ? "red-purple"
                            : "green-orange",
                      showInFeatured: nextType !== "flash",
                    });
                  }}
                >
                  <option value="flash">۱) پیشنهاد لحظه‌ای (صفحه اصلی — isFlashDeal)</option>
                  <option value="featured">۲) پیشنهاد شگفت‌انگیز (صفحه اصلی — isSpecialOffer)</option>
                  <option value="timed_sale">۳) فرصت زمان‌دار (بخش مالی و تخفیف — Sale + منتخب‌ها)</option>
                </select>
              </div>
              <div>
                <label className="label">اولویت بررسی (عدد بالاتر = اولویت اول)</label>
                <input
                  className="input num"
                  type="number"
                  value={d.priority}
                  onChange={(e) => update(i, { priority: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">مدت تایمر کمپین (ساعت)</label>
                <input
                  className="input num"
                  type="number"
                  value={d.durationHours}
                  onChange={(e) => update(i, { durationHours: Number(e.target.value) })}
                />
              </div>
            </div>

            {/* ردیف دوم: شخصی‌سازی رنج کارت‌ها و بازه تخفیف سقف به کف */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  🎯 هدف‌گیری رنج کارت‌ها و شرایط اعمال تخفیف (سقف معیار به کف رقابتی)
                </span>
                <span className="text-xs text-slate-500">
                  می‌توانید این کمپین را دقیقاً روی یک بازه از کارت‌های محصول (مثلاً کارت ۱ تا ۱۰) محدود کنید
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                <div>
                  <label className="label">از کارت شماره</label>
                  <input
                    className="input num"
                    type="number"
                    min={1}
                    value={d.cardRangeFrom}
                    onChange={(e) => update(i, { cardRangeFrom: Math.max(1, Number(e.target.value)) })}
                  />
                </div>
                <div>
                  <label className="label">تا کارت شماره</label>
                  <input
                    className="input num"
                    type="number"
                    min={1}
                    value={d.cardRangeTo}
                    onChange={(e) => update(i, { cardRangeTo: Math.max(1, Number(e.target.value)) })}
                  />
                </div>
                <div>
                  <label className="label">سقف تعداد کارت (۰=نامحدود)</label>
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    value={d.maxCards}
                    onChange={(e) => update(i, { maxCards: Math.max(0, Number(e.target.value)) })}
                  />
                </div>
                <div>
                  <label className="label">حداقل تخفیف (سقف به کف) ٪</label>
                  <input
                    className="input num"
                    type="number"
                    value={d.minDiscountPct}
                    onChange={(e) => update(i, { minDiscountPct: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">حداکثر تخفیف ٪</label>
                  <input
                    className="input num"
                    type="number"
                    value={d.maxDiscountPct}
                    onChange={(e) => update(i, { maxDiscountPct: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">حداقل قیمت کف (تومان)</label>
                  <input
                    className="input num"
                    type="number"
                    step={50000}
                    value={d.minPriceToman}
                    onChange={(e) => update(i, { minPriceToman: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">حداکثر قیمت کف (۰=نامحدود)</label>
                  <input
                    className="input num"
                    type="number"
                    step={50000}
                    value={d.maxPriceToman}
                    onChange={(e) => update(i, { maxPriceToman: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            {/* ردیف سوم: شخصی‌سازی ظاهر، نمایش در منتخب‌های صفحه اصلی و زمان‌بندی */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <div>
                <label className="label">تم رنگی نشان تخفیف روی کارت</label>
                <select
                  className="input"
                  value={d.badgeTheme}
                  onChange={(e) => update(i, { badgeTheme: e.target.value })}
                >
                  <option value="green-orange">سبز - نارنجی (فروش ویژه)</option>
                  <option value="gold-red">طلایی - قرمز (پیشنهاد لحظه‌ای)</option>
                  <option value="red-purple">قرمز - بنفش (شگفت‌انگیز)</option>
                </select>
              </div>
              <div>
                <label className="label">دسته‌بندی‌های مجاز (کاما؛ خالی=همه)</label>
                <input
                  className="input"
                  value={d.categories}
                  placeholder="دوربین مداربسته, دزدگیر"
                  onChange={(e) => update(i, { categories: e.target.value })}
                />
              </div>
              <div>
                <label className="label">ساعات فعال (0-23؛ خالی=همه)</label>
                <input
                  className="input"
                  dir="ltr"
                  value={d.activeHours}
                  onChange={(e) => update(i, { activeHours: e.target.value })}
                  placeholder="9,10,11,20,21,22"
                />
              </div>
              <div>
                <label className="label">روزهای فعال (0=یکشنبه…6=شنبه)</label>
                <input
                  className="input"
                  dir="ltr"
                  value={d.activeDays}
                  onChange={(e) => update(i, { activeDays: e.target.value })}
                  placeholder="6,0,1,2,3"
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">شناسه کارت‌های خاص (ID محصولات با کاما؛ خالی = بر اساس رنج کارت)</label>
                <input
                  className="input"
                  dir="ltr"
                  value={d.targetProductIds}
                  onChange={(e) => update(i, { targetProductIds: e.target.value })}
                  placeholder="1, 2, 5, 12"
                />
              </div>
            </div>

            {/* ردیف چهارم: سوئیچ‌های کنترلی و دکمه‌های ذخیره/اعمال */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={d.active}
                    onChange={(e) => update(i, { active: e.target.checked })}
                  />
                  کمپین فعال باشد
                </label>
                <label className="flex items-center gap-2 font-medium text-indigo-800">
                  <input
                    type="checkbox"
                    checked={d.showInFeatured}
                    onChange={(e) => update(i, { showInFeatured: e.target.checked })}
                  />
                  نمایش در بخش «منتخب‌ها» در صفحه اصلی سایت (`showInFeatured`)
                </label>
                <label className="flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={d.onlyTopRanked}
                    onChange={(e) => update(i, { onlyTopRanked: e.target.checked })}
                  />
                  فقط کارت‌های دارای رتبه ۱ تا ۳ در مشهد یا ترب
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary" disabled={pending || !d.name} onClick={() => save(d)}>
                  {d.id ? "💾 ذخیره تنظیمات کمپین" : "➕ افزودن کمپین جدید"}
                </button>
                {d.id && (
                  <button
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => runOnCardRange(d, key)}
                    title="استعلام بازار ترب و اعمال فوری این کمپین روی رنج کارت‌های انتخابی"
                  >
                    ⚡ اعمال فوری روی کارت #{d.cardRangeFrom} تا #{d.cardRangeTo}
                  </button>
                )}
                {d.id && (
                  <button className="btn-danger" disabled={pending} onClick={() => remove(d.id!)}>
                    حذف
                  </button>
                )}
              </div>
            </div>

            {runMsg[key] && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800">
                {runMsg[key]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
