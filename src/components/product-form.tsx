"use client";

import type { SupplierQuote } from "@/lib/pricing/types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconSpinner } from "./icons";
import { Switch, useToast } from "./ui";

type Values = {
  id?: number;
  sku: string;
  name: string;
  category: string;
  storeExternalId: string;
  sourceType: string;
  torobUrl: string;
  costPrice: number | string;
  minMarginPct: number | string | null;
  minProfitAmount: number | string | null;
  preferredCampaignType: string;
  colleagueListText: string;
  autoApply: boolean;
  showInFeatured?: boolean;
};

function quotesToText(quotes?: SupplierQuote[]): string {
  if (!quotes?.length) return "";
  return quotes
    .map(
      (q) =>
        `${q.supplierName}, ${q.buyPriceToman ?? q.rawPrice}, ${q.supplierCity ?? "مشهد"}, ${q.priority ?? 5}, ${q.inStock === false ? "out" : "in"}`,
    )
    .join("\n");
}

const empty: Values = {
  sku: "",
  name: "",
  category: "",
  storeExternalId: "",
  sourceType: "torob",
  torobUrl: "",
  costPrice: "",
  minMarginPct: "",
  minProfitAmount: "",
  preferredCampaignType: "auto",
  colleagueListText: "",
  autoApply: false,
  showInFeatured: false,
};

export function ProductForm({
  initial,
  initialQuotes,
  onDone,
}: {
  initial?: Partial<Values>;
  initialQuotes?: SupplierQuote[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<Values>({
    ...empty,
    ...initial,
    minMarginPct: initial?.minMarginPct ?? "",
    minProfitAmount: initial?.minProfitAmount ?? "",
    preferredCampaignType: initial?.preferredCampaignType ?? "auto",
    colleagueListText: initial?.colleagueListText ?? quotesToText(initialQuotes),
  });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Values, val: unknown) => setV((s) => ({ ...s, [k]: val }));

  const numericCost = Number(v.costPrice);

  const submit = () =>
    start(async () => {
      setErr(null);
      try {
        const res = await fetch(v.id ? `/api/products/${v.id}` : "/api/products", {
          method: v.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = String(j.error ?? "خطا در ذخیره محصول");
          setErr(message);
          toast.error(message);
          return;
        }
        toast.success(v.id ? "تغییرات محصول ذخیره شد" : "محصول جدید با موفقیت ثبت شد");
        if (!v.id) setV(empty);
        onDone?.();
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "خطا در ارتباط با سرور";
        setErr(message);
        toast.error(message);
      }
    });

  return (
    <div className="space-y-4">
      {/* بخش ۱: مشخصات اصلی */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 sm:p-4">
        <div className="mb-3 text-xs font-bold text-slate-700">۱. مشخصات پایه کارت محصول</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">کد کالا (SKU) *</label>
            <input className="input" value={v.sku} onChange={(e) => set("sku", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">نام محصول *</label>
            <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className="label">دسته‌بندی</label>
            <input
              className="input"
              value={v.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="مثلاً دوربین مداربسته"
            />
          </div>
          <div>
            <label className="label">شناسه محصول در sgeooole (کد KY-XXXX یا _id)</label>
            <input
              className="input"
              dir="ltr"
              value={v.storeExternalId}
              onChange={(e) => set("storeExternalId", e.target.value)}
              placeholder="KY-1234567"
            />
          </div>
          <div>
            <label className="label">منبع استعلام</label>
            <select className="input" value={v.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
              <option value="torob">ترب (مجهز به Torob MCP و جستجوی خودکار)</option>
            </select>
          </div>
        </div>
      </div>

      {/* بخش ۲: منبع ترب، قیمت خرید و تخفیف */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 sm:p-4">
        <div className="mb-3 text-xs font-bold text-slate-700">۲. قیمت تمام‌شده، خط قرمز و اتصال ترب</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">لینک محصول در ترب (اختیاری — در صورت خالی بودن با نام محصول پیدا می‌شود)</label>
            <input
              className="input"
              dir="ltr"
              value={v.torobUrl}
              onChange={(e) => set("torobUrl", e.target.value)}
              placeholder="https://torob.com/p/xxxxxxxx/..."
            />
          </div>
          <div>
            <label className="label">سیستم تخفیف ترجیحی در sgeooole</label>
            <select
              className="input font-medium"
              value={v.preferredCampaignType}
              onChange={(e) => set("preferredCampaignType", e.target.value)}
            >
              <option value="auto">تشخیص خودکار بر اساس قوانین و رنج کارت‌ها</option>
              <option value="flash">۱) پیشنهاد لحظه‌ای (صفحه اصلی)</option>
              <option value="featured">۲) پیشنهاد شگفت‌انگیز (صفحه اصلی)</option>
              <option value="timed_sale">۳) فرصت زمان‌دار (مالی و تخفیف / منتخب‌ها)</option>
              <option value="none">بدون کمپین تخفیف</option>
            </select>
          </div>
          <div>
            <label className="label">قیمت خرید پایه / انبار (تومان؛ ۰ = کشف از ترب)</label>
            <input
              className="input num"
              type="number"
              value={v.costPrice}
              onChange={(e) => set("costPrice", e.target.value)}
            />
            {Number.isFinite(numericCost) && numericCost > 0 && (
              <div className="num mt-1 text-[11px] text-indigo-700">
                معادل {Math.round(numericCost).toLocaleString("fa-IR")} تومان
              </div>
            )}
          </div>
          <div>
            <label className="label">حداقل سود خط قرمز ٪ (خالی = پروفایل)</label>
            <input
              className="input num"
              type="number"
              step="0.5"
              value={v.minMarginPct ?? ""}
              onChange={(e) => set("minMarginPct", e.target.value)}
            />
          </div>
          <div>
            <label className="label">حداقل سود خالص تومانی (خالی = پروفایل)</label>
            <input
              className="input num"
              type="number"
              step="1000"
              value={v.minProfitAmount ?? ""}
              onChange={(e) => set("minProfitAmount", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* بخش ۳: لیست همکاران */}
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/30 p-3.5 sm:p-4">
        <label className="label font-bold text-indigo-900">
          ۳. لیست قیمت همکاران / تامین‌کنندگان برای این محصول (اولویت اول تعیین کف قیمت فروش)
        </label>
        <p className="mb-2 text-xs leading-5 text-slate-500">
          فرمت هر خط:{" "}
          <code dir="ltr" className="rounded bg-white px-1.5 py-0.5 text-[11px] text-indigo-700">
            نام همکار, قیمت خرید (تومان یا ریال), شهر (مثلاً مشهد), اولویت (1-10), [in|out]
          </code>
        </p>
        <textarea
          className="input min-h-24 font-mono text-xs"
          dir="ltr"
          value={v.colleagueListText}
          onChange={(e) => set("colleagueListText", e.target.value)}
          placeholder={"پخش شرق مشهد, 2320000, مشهد, 9, in\nهمکار تهران, 2290000, تهران, 7, in"}
        />
      </div>

      {/* بخش ۴: سوئیچ‌های کنترلی */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 sm:grid-cols-2 sm:p-4">
        <Switch
          id={`auto-${v.id ?? "new"}`}
          checked={v.autoApply}
          onChange={(next) => set("autoApply", next)}
          label="اعمال خودکار بدون تأیید انسانی"
          description="با تضمین قطعی عدم فروش زیر قیمت خرید همکار"
        />
        <Switch
          id={`feat-${v.id ?? "new"}`}
          checked={Boolean(v.showInFeatured)}
          onChange={(next) => set("showInFeatured", next)}
          label="★ مجاز برای باکس «منتخب‌های صفحه اصلی»"
          description="در زمان فعال‌شدن کمپین در فروشگاه نمایش داده شود"
        />
      </div>

      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{err}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={pending} onClick={submit}>
          {pending && <IconSpinner className="h-4 w-4" />}
          <span>{pending ? "در حال ذخیره…" : v.id ? "💾 ذخیره تغییرات" : "➕ افزودن محصول"}</span>
        </button>
      </div>
    </div>
  );
}
