"use client";

import type { PricingResult } from "@/lib/pricing/types";
import { useState } from "react";

const sample = `دیجی‌کالا, 2450000, 1
تکنولایف, 2470000, 0
موبایل کمک, 2100000, 25
زنبیل, 2150000, 18
ایران‌بین, 2120000, 30
کالاپلاس, 2490000, 2
مقداد, 2440000, 1
سناتور, 2460000, 3
بانه, 3200000, 1
کالاتیک, 2455000, 0
پلازا, 2480000, 1
همراه سنتر, 2500000, 2
نوین‌کالا, 2445000, 1
تیمچه, 2475000, 0
شهر لوازم, 1900000, 1`;

export default function SimulatePage() {
  const [text, setText] = useState(sample);
  const [cost, setCost] = useState(2100000);
  const [current, setCurrent] = useState<string>("");
  const [sellers, setSellers] = useState(28);
  const [res, setRes] = useState<PricingResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const offers = text
      .split("\n")
      .map((l) => l.split(",").map((s) => s.trim()))
      .filter((p) => p.length >= 2 && Number(p[1]) > 0)
      .map((p) => ({ shopName: p[0], price: Number(p[1]), lastChangedDaysAgo: p[2] ? Number(p[2]) : undefined, isAd: p[3] === "ad", inStock: p[3] !== "out" }));
    const r = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costPrice: cost, currentFinalPrice: current ? Number(current) : null, totalSellerCount: sellers, offers }),
    });
    setRes(await r.json());
    setBusy(false);
  };

  const t = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("fa-IR"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">شبیه‌ساز موتور قیمت (اجرای خشک)</h1>
        <p className="mt-1 text-sm text-slate-500">
          قیمت‌های رقبا را وارد کنید تا ببینید موتور دقیقاً چه تصمیمی می‌گیرد و چرا. فرمت هر خط: <code dir="ltr">نام, قیمت, روز از آخرین تغییر, [ad|out]</code>
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <textarea className="input h-72 font-mono text-xs" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">قیمت تمام‌شده</label>
              <input className="input num" type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">قیمت فعلی ما (اختیاری)</label>
              <input className="input num" type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div>
              <label className="label">تعداد کل فروشنده در لیستینگ</label>
              <input className="input num" type="number" value={sellers} onChange={(e) => setSellers(Number(e.target.value))} />
            </div>
          </div>
          <button className="btn-primary" disabled={busy} onClick={run}>
            {busy ? "در حال محاسبه…" : "محاسبه"}
          </button>
        </div>
        <div className="card">
          {!res && <p className="text-sm text-slate-400">نتیجه این‌جا نمایش داده می‌شود.</p>}
          {res && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                <K k="کف خام" v={t(res.lowestRaw)} />
                <K k="کف معتبر" v={t(res.lowestValid)} />
                <K k="مرجع بازار" v={t(res.referencePrice)} />
                <K k="قیمت اصلی" v={t(res.basePrice)} />
                <K k="قیمت نهایی" v={t(res.finalPrice)} strong />
                <K k="تخفیف" v={res.discountPct != null ? `${res.discountPct}٪` : "—"} />
                <K k="استراتژی" v={res.strategy} />
                <K k="اعتماد" v={`${Math.round(res.confidence * 100)}٪`} />
                <K k="نتیجه" v={res.needsReview ? "نیاز به بازبینی" : "اعمال خودکار"} />
              </div>
              <ol className="space-y-1">
                {res.steps.map((s, i) => (
                  <li key={i} className={`rounded-lg px-3 py-2 text-xs ${s.level === "warn" ? "bg-amber-50" : s.level === "error" ? "bg-rose-50" : "bg-slate-50"}`}>
                    <b>{s.title}:</b> {s.message}
                  </li>
                ))}
              </ol>
              <table className="data">
                <thead>
                  <tr>
                    <th>فروشگاه</th>
                    <th>قیمت</th>
                    <th>وزن</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {[...res.offers]
                    .sort((a, b) => a.price - b.price)
                    .map((o, i) => (
                      <tr key={i} className={o.included ? "" : "text-slate-400"}>
                        <td>{o.shopName}</td>
                        <td className={`num ${o.included ? "" : "line-through"}`}>{t(o.price)}</td>
                        <td className="num text-xs">{o.included ? o.weight.toFixed(2) : "—"}</td>
                        <td className="text-xs">{o.included ? "در محاسبه" : o.excludeReason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function K({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className={`num ${strong ? "font-bold text-emerald-700" : "font-medium"}`}>{v}</div>
    </div>
  );
}
