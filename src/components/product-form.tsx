"use client";

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
  autoApply: boolean;
};

const empty: Values = { sku: "", name: "", category: "", storeExternalId: "", sourceType: "torob", torobUrl: "", costPrice: "", minMarginPct: "", autoApply: true };

export function ProductForm({ initial, onDone }: { initial?: Partial<Values>; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<Values>({ ...empty, ...initial, minMarginPct: initial?.minMarginPct ?? "" });
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
        <input className="input" value={v.category} onChange={(e) => set("category", e.target.value)} placeholder="مثلاً موبایل" />
      </div>
      <div>
        <label className="label">شناسه محصول در فروشگاه (ID ووکامرس)</label>
        <input className="input" value={v.storeExternalId} onChange={(e) => set("storeExternalId", e.target.value)} />
      </div>
      <div>
        <label className="label">منبع استعلام</label>
        <select className="input" value={v.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
          <option value="torob">ترب (خزش واقعی)</option>
          <option value="mock">شبیه‌ساز بازار (تست)</option>
        </select>
      </div>
      <div className="md:col-span-3">
        <label className="label">لینک محصول در ترب</label>
        <input className="input" dir="ltr" value={v.torobUrl} onChange={(e) => set("torobUrl", e.target.value)} placeholder="https://torob.com/p/xxxxxxxx/..." />
      </div>
      <div>
        <label className="label">قیمت تمام‌شده (تومان)</label>
        <input className="input num" type="number" value={v.costPrice} onChange={(e) => set("costPrice", e.target.value)} />
      </div>
      <div>
        <label className="label">حداقل سود ٪ (خالی = پروفایل)</label>
        <input className="input num" type="number" step="0.5" value={v.minMarginPct ?? ""} onChange={(e) => set("minMarginPct", e.target.value)} />
      </div>
      <div className="flex items-end gap-2 pb-2">
        <input id={`auto-${v.id ?? "new"}`} type="checkbox" checked={v.autoApply} onChange={(e) => set("autoApply", e.target.checked)} />
        <label htmlFor={`auto-${v.id ?? "new"}`} className="text-sm">
          اعمال خودکار بدون تأیید انسانی
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
