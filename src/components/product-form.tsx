"use client";

import type { SupplierQuote } from "@/lib/pricing/types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  autoApply: true,
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

  const submit = () =>
    start(async () => {
      setErr(null);
      const res = await fetch(v.id ? `/api/products/${v.id}` : "/api/products", {
        method: v.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = await res.json();
      if (!res.ok) return setErr(j.error ?? "خطا");
      if (!v.id) setV(empty);
      onDone?.();
      router.refresh();
    });

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div>
        <label className="label">کد کالا (SKU) *</label>
        <input className="input" value={v.sku} onChange={(e) => set("sku", e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <label className="label">نام محصول *</label>
        <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div>
        <label className="label">دسته‌بندی</label>
        <input className="input" value={v.category} onChange={(e) => set("category", e.target.value)} placeholder="مثلاً دوربین مداربسته" />
      </div>
      <div>
        <label className="label">شناسه محصول در sgeooole (کد KY-XXXX یا _id)</label>
        <input className="input" value={v.storeExternalId} onChange={(e) => set("storeExternalId", e.target.value)} placeholder="KY-1234567" />
      </div>
      <div>
        <label className="label">منبع استعلام</label>
        <select className="input" value={v.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
          <option value="torob">ترب (مجهز به Torob MCP و جستجوی خودکار)</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="label">لینک محصول در ترب (اختیاری — در صورت خالی بودن با نام محصول از Torob MCP پیدا می‌شود)</label>
        <input className="input" dir="ltr" value={v.torobUrl} onChange={(e) => set("torobUrl", e.target.value)} placeholder="https://torob.com/p/xxxxxxxx/..." />
      </div>
      <div>
        <label className="label">سیستم تخفیف ترجیحی این کارت در sgeooole</label>
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
        <input className="input num" type="number" value={v.costPrice} onChange={(e) => set("costPrice", e.target.value)} />
      </div>
      <div>
        <label className="label">حداقل سود خط قرمز ٪ (خالی = پروفایل)</label>
        <input className="input num" type="number" step="0.5" value={v.minMarginPct ?? ""} onChange={(e) => set("minMarginPct", e.target.value)} />
      </div>
      <div>
        <label className="label">حداقل سود خالص تومانی (خالی = پروفایل)</label>
        <input className="input num" type="number" step="1000" value={v.minProfitAmount ?? ""} onChange={(e) => set("minProfitAmount", e.target.value)} />
      </div>
      <div className="md:col-span-3">
        <label className="label font-bold text-indigo-700">
          لیست قیمت همکاران / تامین‌کنندگان برای این محصول (اولویت اول تعیین کف قیمت فروش)
        </label>
        <p className="mb-1 text-xs text-slate-400">
          فرمت هر خط: <code dir="ltr">نام همکار, قیمت خرید (تومان یا ریال), شهر همکار (مثلاً مشهد), اولویت (1-10), [in|out]</code>
        </p>
        <textarea
          className="input h-24 font-mono text-xs"
          dir="ltr"
          value={v.colleagueListText}
          onChange={(e) => set("colleagueListText", e.target.value)}
          placeholder={"پخش شرق مشهد, 2320000, مشهد, 9, in\nهمکار تهران, 2290000, تهران, 7, in"}
        />
      </div>
      <div className="flex items-end gap-2 pb-2 md:col-span-3">
        <input id={`auto-${v.id ?? "new"}`} type="checkbox" checked={v.autoApply} onChange={(e) => set("autoApply", e.target.checked)} />
        <label htmlFor={`auto-${v.id ?? "new"}`} className="text-sm">
          اعمال خودکار بدون تأیید انسانی (با تضمین قطعی عدم فروش زیر قیمت خرید همکار)
        </label>
      </div>
      <div className="flex items-center gap-3 md:col-span-3">
        <button className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? "در حال ذخیره…" : v.id ? "ذخیره تغییرات" : "افزودن محصول"}
        </button>
        {err && <span className="text-sm text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
