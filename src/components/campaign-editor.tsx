"use client";

import type { DiscountCampaign } from "@/db/schema";
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
};

const toDraft = (c?: DiscountCampaign): Draft => ({
  id: c?.id,
  name: c?.name ?? "",
  type: c?.type ?? "featured",
  active: c?.active ?? true,
  priority: c?.priority ?? 0,
  minDiscountPct: c?.minDiscountPct ?? 0,
  maxDiscountPct: c?.maxDiscountPct ?? 100,
  activeHours: (c?.activeHours ?? []).join(","),
  activeDays: (c?.activeDays ?? []).join(","),
  categories: (c?.categories ?? []).join(","),
  durationHours: c?.durationHours ?? 24,
});

export function CampaignEditor({ campaigns }: { campaigns: DiscountCampaign[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([...campaigns.map((c) => toDraft(c)), toDraft()]);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = (d: Draft) =>
    start(async () => {
      await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
      router.refresh();
      if (!d.id) setDrafts((ds) => ds.map((x) => (x === d ? toDraft() : x)));
    });
  const remove = (id: number) =>
    start(async () => {
      await fetch("/api/campaigns", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setDrafts((ds) => ds.filter((x) => x.id !== id));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {drafts.map((d, i) => (
        <div key={d.id ?? "new"} className={`card ${d.id ? "" : "border-dashed"}`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">{d.id ? d.name : "کمپین جدید"}</h2>
            {d.id && (
              <span className={`badge ${d.type === "flash" ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"}`}>{d.type === "flash" ? "لحظه‌ای" : "منتخب / شگفت‌انگیز"}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2">
              <label className="label">نام</label>
              <input className="input" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
            </div>
            <div>
              <label className="label">نوع</label>
              <select className="input" value={d.type} onChange={(e) => update(i, { type: e.target.value })}>
                <option value="flash">لحظه‌ای</option>
                <option value="featured">منتخب / شگفت‌انگیز</option>
              </select>
            </div>
            <div>
              <label className="label">اولویت</label>
              <input className="input num" type="number" value={d.priority} onChange={(e) => update(i, { priority: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">حداقل تخفیف ٪</label>
              <input className="input num" type="number" value={d.minDiscountPct} onChange={(e) => update(i, { minDiscountPct: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">حداکثر تخفیف ٪</label>
              <input className="input num" type="number" value={d.maxDiscountPct} onChange={(e) => update(i, { maxDiscountPct: Number(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <label className="label">ساعات فعال (0-23، با کاما؛ خالی = همه)</label>
              <input className="input" dir="ltr" value={d.activeHours} onChange={(e) => update(i, { activeHours: e.target.value })} placeholder="9,10,11,20,21,22" />
            </div>
            <div className="col-span-2">
              <label className="label">روزهای فعال (0=یکشنبه … 6=شنبه؛ خالی = همه)</label>
              <input className="input" dir="ltr" value={d.activeDays} onChange={(e) => update(i, { activeDays: e.target.value })} placeholder="6,0,1,2,3" />
            </div>
            <div>
              <label className="label">دسته‌ها (کاما)</label>
              <input className="input" value={d.categories} onChange={(e) => update(i, { categories: e.target.value })} />
            </div>
            <div>
              <label className="label">مدت اعتبار (ساعت)</label>
              <input className="input num" type="number" value={d.durationHours} onChange={(e) => update(i, { durationHours: Number(e.target.value) })} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.active} onChange={(e) => update(i, { active: e.target.checked })} /> فعال
            </label>
            <button className="btn-primary" disabled={pending || !d.name} onClick={() => save(d)}>
              {d.id ? "ذخیره" : "افزودن"}
            </button>
            {d.id && (
              <button className="btn-danger" disabled={pending} onClick={() => remove(d.id!)}>
                حذف
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
