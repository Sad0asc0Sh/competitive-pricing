"use client";

import type { PricingProfile, Schedule, StoreConnector } from "@/db/schema";
import type { PricingProfileConfig } from "@/lib/pricing/types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/* ---------------- پروفایل موتور ---------------- */
type Section = keyof PricingProfileConfig;

const labels: Record<string, string> = {
  filters: "فیلترهای اعتبار داده",
  minSellerCount: "حداقل تعداد فروشنده (لیستینگ ادغام‌شده)",
  maxOfferAgeDays: "حداکثر قدمت قیمت (روز)",
  excludeAds: "حذف آگهی‌های تبلیغاتی",
  excludeOutOfStock: "حذف ناموجودها",
  shopBlacklist: "لیست سیاه فروشگاه‌ها (کاما)",
  ownShopNames: "نام فروشگاه خودمان در ترب (کاما)",
  outliers: "حذف داده‌های پرت",
  method: "روش",
  iqrK: "ضریب IQR",
  madK: "ضریب MAD",
  hardBandPct: "باند سخت حول میانه ٪",
  minSamples: "حداقل نمونه برای روش آماری",
  aggregation: "تجمیع (قیمت مرجع)",
  trimPct: "درصد برش (trimmed mean)",
  recencyHalfLifeDays: "نیمه‌عمر وزن تازگی (روز)",
  rank1: "استراتژی رتبه اول",
  enabled: "فعال",
  maxGapPct: "حداکثر اختلاف کف با مرجع ٪ برای رقابت",
  undercutAmount: "کاهش زیر کف (تومان)",
  undercutPct: "کاهش زیر کف ٪",
  fallbackToReference: "در اختلاف زیاد، روی مرجع بمان",
  margin: "حاشیه سود",
  minPct: "حداقل سود ٪",
  targetPct: "سود هدف ٪ (بدون داده بازار)",
  guards: "محافظ‌ها",
  maxChangePctPerRun: "حداکثر تغییر قیمت در هر اجرا ٪",
  minConfidenceAutoApply: "حداقل اعتماد برای اعمال خودکار (0-1)",
  minValidOffers: "حداقل پیشنهاد معتبر",
  discount: "سیستم تخفیف",
  basePriceMode: "روش قیمت اصلی",
  marketUpperPercentile: "صدک بازار برای قیمت اصلی",
  markupPct: "درصد افزایش (حالت markup)",
  minDiscountPct: "حداقل تخفیف نمایشی ٪",
  maxDiscountPct: "حداکثر تخفیف نمایشی ٪",
  rounding: "گرد کردن",
  finalStep: "گام گرد کردن قیمت نهایی",
  baseStep: "گام گرد کردن قیمت اصلی",
  psychological: "قیمت روانی",
  ai: "هوش مصنوعی",
  reviewBelowConfidence: "بازبینی AI وقتی اعتماد کمتر از",
};

const selectOptions: Record<string, string[]> = {
  method: ["iqr", "mad", "band"],
  basePriceMode: ["market_upper", "markup"],
  psychological: ["none", "x900", "x000"],
};

export function ProfileEditor({ profiles }: { profiles: PricingProfile[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id);
  const prof = profiles.find((p) => p.id === selected) ?? profiles[0];
  const [cfg, setCfg] = useState<PricingProfileConfig>(prof.config);
  const [name, setName] = useState(prof.name);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const pick = (id: number) => {
    const p = profiles.find((x) => x.id === id)!;
    setSelected(id);
    setCfg(p.config);
    setName(p.name);
  };
  const setField = (sec: Section, key: string, val: unknown) => setCfg((c) => ({ ...c, [sec]: { ...c[sec], [key]: val } }));

  const save = (asNew = false) =>
    start(async () => {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asNew ? undefined : selected, name: asNew ? `${name} (کپی)` : name, config: cfg, isDefault: !asNew && prof.isDefault }),
      });
      setMsg(res.ok ? "ذخیره شد" : "خطا در ذخیره");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">پروفایل</label>
          <select className="input" value={selected} onChange={(e) => pick(Number(e.target.value))}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (پیش‌فرض)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label">نام</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={pending} onClick={() => save(false)}>
          ذخیره پروفایل
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => save(true)}>
          ذخیره به‌عنوان جدید
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(cfg) as Section[]).map((sec) => (
          <div key={sec} className="card">
            <h3 className="mb-3 font-bold">{labels[sec] ?? sec}</h3>
            <div className="space-y-2">
              {Object.entries(cfg[sec]).map(([k, v]) => (
                <div key={k}>
                  <label className="label">{labels[k] ?? k}</label>
                  {typeof v === "boolean" ? (
                    <input type="checkbox" checked={v} onChange={(e) => setField(sec, k, e.target.checked)} />
                  ) : Array.isArray(v) ? (
                    <input className="input" value={v.join(",")} onChange={(e) => setField(sec, k, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                  ) : selectOptions[k] ? (
                    <select className="input" value={String(v)} onChange={(e) => setField(sec, k, e.target.value)}>
                      {selectOptions[k].map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input num" type="number" step="any" value={v as number} onChange={(e) => setField(sec, k, Number(e.target.value))} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- زمان‌بندی ---------------- */
export function ScheduleEditor({ items }: { items: Schedule[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", intervalMinutes: 360, category: "" });
  const call = (body: unknown, method = "POST") =>
    start(async () => {
      await fetch("/api/schedules", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <table className="data">
        <thead>
          <tr>
            <th>نام</th>
            <th>بازه (دقیقه)</th>
            <th>فیلتر</th>
            <th>آخرین اجرا</th>
            <th>اجرای بعدی</th>
            <th>فعال</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="num">{s.intervalMinutes}</td>
              <td className="text-xs">{s.filter?.category ? `دسته: ${s.filter.category}` : "همه محصولات"}</td>
              <td className="text-xs">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString("fa-IR") : "—"}</td>
              <td className="text-xs">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("fa-IR") : "—"}</td>
              <td>
                <input type="checkbox" checked={s.active} onChange={(e) => call({ id: s.id, name: s.name, intervalMinutes: s.intervalMinutes, category: s.filter?.category, active: e.target.checked })} />
              </td>
              <td>
                <button className="btn-danger" disabled={pending} onClick={() => call({ id: s.id }, "DELETE")}>
                  حذف
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">نام</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label className="label">هر چند دقیقه</label>
          <input className="input num" type="number" value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">فقط دسته (اختیاری)</label>
          <input className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
        </div>
        <button className="btn-primary" disabled={pending || !draft.name} onClick={() => call(draft)}>
          افزودن زمان‌بندی
        </button>
      </div>
      <p className="text-xs text-slate-500">
        زمان‌بند داخلی هر ۶۰ ثانیه بررسی می‌کند. برای محیط‌های serverless از cron خارجی به <code dir="ltr">GET /api/scheduler/tick</code> (با هدر <code dir="ltr">Authorization: Bearer $CRON_SECRET</code>) استفاده کنید.
      </p>
    </div>
  );
}

/* ---------------- کانکتور فروشگاه ---------------- */
export function ConnectorEditor({ items }: { items: StoreConnector[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState(items.map((c) => ({ ...c })));
  const save = (c: StoreConnector, active?: boolean) =>
    start(async () => {
      await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, config: c.config, active: active ?? c.active }) });
      router.refresh();
    });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {drafts.map((c, i) => (
        <div key={c.id} className={`card ${c.active ? "border-emerald-300" : ""}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-bold">{c.name}</h3>
            {c.active ? <span className="badge bg-emerald-100 text-emerald-700">فعال</span> : <span className="badge bg-slate-100 text-slate-600">غیرفعال</span>}
          </div>
          <div className="space-y-2">
            {Object.entries(c.config).map(([k, v]) => (
              <div key={k}>
                <label className="label">{k}</label>
                <input className="input" dir="ltr" value={v} onChange={(e) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, config: { ...x.config, [k]: e.target.value } } : x)))} />
              </div>
            ))}
          </div>
          {c.lastError && <p className="mt-2 text-xs text-rose-600">آخرین خطا: {c.lastError}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" disabled={pending} onClick={() => save(c)}>
              ذخیره
            </button>
            <button className="btn-secondary" disabled={pending} onClick={() => save(c, !c.active)}>
              {c.active ? "غیرفعال کردن" : "فعال کردن"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
