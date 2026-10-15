"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RunButton({
  productIds,
  cardRangeFrom,
  cardRangeTo,
  label = "اجرای استعلام",
  className = "btn-primary",
}: {
  productIds?: number[];
  cardRangeFrom?: number;
  cardRangeTo?: number;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productIds, cardRangeFrom, cardRangeTo }),
            });
            const j = await res.json();
            setMsg(
              res.ok
                ? `اعمال: ${j.applied} | بازبینی: ${j.pendingReview} | خطا: ${j.failed}`
                : j.error ?? "خطا",
            );
            router.refresh();
          })
        }
      >
        {pending ? "در حال استعلام…" : label}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

/**
 * نوار ابزار اجرای هوشمند روی یک رنج دلخواه از کارت‌ها (مثلاً از کارت ۱ تا ۱۵)
 */
export function CardRangeRunner({ totalCards }: { totalCards: number }) {
  const router = useRouter();
  const [fromCard, setFromCard] = useState(1);
  const [toCard, setToCard] = useState(Math.max(1, Math.min(20, totalCards || 20)));
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
      <div>
        <div className="text-xs font-bold text-indigo-900">
          🎯 اجرای هدفمند کف و سقف + تخفیف روی رنجی از کارت‌ها
        </div>
        <div className="text-xs text-slate-500">
          انتخاب بازه کارت‌ها برای کشف سقف معیار، اعمال درصد تخفیف روی کف و بروزرسانی در sgeooole
        </div>
      </div>
      <div>
        <label className="label">از کارت #</label>
        <input
          className="input num w-24"
          type="number"
          min={1}
          value={fromCard}
          onChange={(e) => setFromCard(Math.max(1, Number(e.target.value)))}
        />
      </div>
      <div>
        <label className="label">تا کارت #</label>
        <input
          className="input num w-24"
          type="number"
          min={1}
          value={toCard}
          onChange={(e) => setToCard(Math.max(1, Number(e.target.value)))}
        />
      </div>
      <div>
        <label className="label">فیلتر دسته (اختیاری)</label>
        <input
          className="input w-40"
          placeholder="همه دسته‌ها"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                cardRangeFrom: fromCard,
                cardRangeTo: toCard,
                category: category.trim() || undefined,
              }),
            });
            const j = await res.json();
            setMsg(
              res.ok
                ? `کارت #${fromCard} تا #${toCard} بروز شد → اعمال: ${j.applied} | بازبینی: ${j.pendingReview} | خطا: ${j.failed}`
                : j.error ?? "خطا",
            );
            router.refresh();
          })
        }
      >
        {pending ? "در حال اجرای رنج کارت‌ها…" : `⚡ اعمال روی کارت #${fromCard} تا #${toCard}`}
      </button>
      {msg && <span className="text-xs font-medium text-indigo-800">{msg}</span>}
    </div>
  );
}

export function DecisionActions({ decisionId }: { decisionId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (action: "approve" | "reject") =>
    start(async () => {
      const res = await fetch(`/api/decisions/${decisionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      setMsg(j.message ?? (res.ok ? "انجام شد" : j.error ?? "خطا"));
      router.refresh();
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className="btn-success" disabled={pending} onClick={() => act("approve")}>
        تأیید و اعمال
      </button>
      <button className="btn-secondary" disabled={pending} onClick={() => act("reject")}>
        رد
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

export function ProductStatusToggle({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = status === "paused" ? "active" : "paused";
  return (
    <button
      className="btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await fetch(`/api/products/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
          });
          router.refresh();
        })
      }
    >
      {status === "paused" ? "فعال‌سازی" : "توقف قیمت‌گذاری"}
    </button>
  );
}

export function DeleteProductButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-danger"
      disabled={pending}
      onClick={() => {
        if (!confirm("حذف محصول؟")) return;
        start(async () => {
          await fetch(`/api/products/${id}`, { method: "DELETE" });
          router.push("/products");
          router.refresh();
        });
      }}
    >
      حذف
    </button>
  );
}
