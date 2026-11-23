"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

async function safeJsonFetch(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, init);
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      return { ok: false, status: 401, data: { error: "نشست شما منقضی شده است — در حال انتقال به صفحه ورود…" } };
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { error: text ? text.slice(0, 180) : `پاسخ نامعتبر سرور (HTTP ${res.status})` };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { error: `خطا در ارسال درخواست به سرور: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}

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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            // برای جلوگیری از تایم‌اوت مرورگر، اگر دکمه کلی زده شد و هیچ رنجی مشخص نبود، ۵ کارت اول استعلام می‌شود
            const bodyPayload =
              !productIds?.length && cardRangeFrom == null && cardRangeTo == null
                ? { cardRangeFrom: 1, cardRangeTo: 5 }
                : { productIds, cardRangeFrom, cardRangeTo };
            const { ok, data } = await safeJsonFetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bodyPayload),
            });
            if (ok) {
              const lastErr = typeof data.lastError === "string" && data.lastError ? ` (${data.lastError})` : "";
              setMsg({
                ok: Number(data.failed ?? 0) === 0 || Number(data.applied ?? 0) + Number(data.pendingReview ?? 0) > 0,
                text: `اعمال: ${data.applied ?? 0} | بازبینی: ${data.pendingReview ?? 0} | رد/خطا: ${data.failed ?? 0}${lastErr}`,
              });
            } else {
              setMsg({ ok: false, text: String(data.error ?? "خطا در اجرای استعلام") });
            }
            router.refresh();
          })
        }
      >
        {pending ? "در حال استعلام…" : label}
      </button>
      {msg && (
        <span className={`text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}

/**
 * نوار ابزار اجرای هوشمند روی یک رنج دلخواه از کارت‌ها + دکمه پاک‌سازی فوری دسته ۳ و ریست قفل ترب
 */
export function CardRangeRunner({ totalCards }: { totalCards: number }) {
  const router = useRouter();
  const [fromCard, setFromCard] = useState(1);
  const [toCard, setToCard] = useState(Math.max(1, Math.min(3, totalCards || 3)));
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs font-bold text-indigo-900">
            🎯 اجرای هدفمند کف و سقف + تخفیف روی رنجی از کارت‌ها
          </div>
          <div className="text-xs text-slate-500">
            برای جلوگیری از چالش کپچای ترب (HTTP 490)، استعلام را در دسته‌های ۳ تا ۵ کارتی اجرا کنید
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
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const { ok, data } = await safeJsonFetch("/api/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  cardRangeFrom: fromCard,
                  cardRangeTo: toCard,
                  category: category.trim() || undefined,
                }),
              });
              if (ok) {
                const lastErr = typeof data.lastError === "string" && data.lastError ? ` — علت خطا: ${data.lastError}` : "";
                setMsg({
                  ok: Number(data.failed ?? 0) === 0 || Number(data.applied ?? 0) + Number(data.pendingReview ?? 0) > 0,
                  text: `کارت #${fromCard} تا #${toCard} بررسی شد → اعمال: ${data.applied ?? 0} | صف بازبینی: ${data.pendingReview ?? 0} | رد/خطا: ${data.failed ?? 0}${lastErr}`,
                });
              } else {
                setMsg({ ok: false, text: String(data.error ?? "خطا در اجرای رنج کارت‌ها") });
              }
              router.refresh();
            })
          }
        >
          {pending ? "در حال اجرای رنج کارت‌ها…" : `⚡ اعمال روی کارت #${fromCard} تا #${toCard}`}
        </button>

        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const { ok, data } = await safeJsonFetch("/api/campaigns/cleanup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              setMsg({
                ok,
                text: String(data.message ?? data.error ?? "پاک‌سازی انجام شد"),
              });
              router.refresh();
            })
          }
        >
          🧹 پاک‌سازی کارت اشتباه دسته ۳ (فرصت زمان‌دار) + ریست قفل ترب
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs font-medium ${
            msg.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-rose-300 bg-rose-50 text-rose-900"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

export function DecisionActions({
  decisionId,
  id,
  force = false,
  isBelowFloor = false,
  syncFailed = false,
}: {
  decisionId?: number;
  id?: number;
  force?: boolean;
  isBelowFloor?: boolean;
  syncFailed?: boolean;
}) {
  const targetId = decisionId ?? id ?? 0;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [belowCostReason, setBelowCostReason] = useState("");

  const act = (
    action: "approve" | "reject" | "retry_sync",
    overrideOpts?: { allowBelowCost: boolean; belowCostReason: string; authorizedBy: string }
  ) => {
    if (action === "approve" && isBelowFloor && !overrideOpts?.allowBelowCost) {
      setShowOverrideForm(true);
      setMsg({
        ok: false,
        text: "این تصمیم زیر کف هزینه/سود است؛ برای تایید، مجوز صریح مدیریت (Override) را ثبت کنید.",
      });
      return;
    }

    start(async () => {
      setMsg(null);
      const { ok, data } = await safeJsonFetch(`/api/decisions/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          force,
          ...(overrideOpts?.allowBelowCost
            ? {
                allowBelowCost: true,
                belowCostReason: overrideOpts.belowCostReason,
                authorizedBy: overrideOpts.authorizedBy,
              }
            : {}),
        }),
      });
      if (
        !ok &&
        (data.belowCostBlocked === true ||
          data.code === "BELOW_FLOOR_BLOCKED" ||
          data.code === "BELOW_COST_BLOCKED")
      ) {
        setShowOverrideForm(true);
      } else if (ok) {
        setShowOverrideForm(false);
      }
      setMsg({
        ok,
        text: String(data.message ?? (ok ? "انجام شد" : data.error ?? "خطا")),
      });
      router.refresh();
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-2">
      <span className="inline-flex flex-wrap items-center gap-2">
        {syncFailed ? (
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={pending}
            onClick={() => act("retry_sync")}
          >
            🔄 تلاش مجدد ارسال به فروشگاه
          </button>
        ) : (
          <button
            type="button"
            className={isBelowFloor ? "btn-danger text-xs" : "btn-success"}
            disabled={pending}
            onClick={() => act("approve")}
          >
            {isBelowFloor ? "⚠️ تایید با مجوز زیر کف…" : "تأیید و اعمال"}
          </button>
        )}
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => act("reject")}>
          رد
        </button>
        {msg && (
          <span className={`text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {msg.text}
          </span>
        )}
      </span>

      {showOverrideForm && (
        <div className="w-72 space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-right">
          <div className="text-xs font-bold text-rose-900">
            🛡️ مجوز صریح فروش زیر کف قیمت خرید / سود
          </div>
          <input
            className="input text-xs"
            placeholder="نام تأییدکننده (مثلاً مدیر بازرگانی)"
            value={authorizedBy}
            onChange={(e) => setAuthorizedBy(e.target.value)}
          />
          <input
            className="input text-xs"
            placeholder="علت مجوز (حداقل ۵ کاراکتر)"
            value={belowCostReason}
            onChange={(e) => setBelowCostReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-danger text-xs"
              disabled={pending || authorizedBy.trim().length < 2 || belowCostReason.trim().length < 5}
              onClick={() =>
                act("approve", {
                  allowBelowCost: true,
                  authorizedBy: authorizedBy.trim(),
                  belowCostReason: belowCostReason.trim(),
                })
              }
            >
              ثبت مجوز و اعمال
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setShowOverrideForm(false)}
            >
              انصراف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductStatusToggle({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = status === "paused" ? "active" : "paused";
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await safeJsonFetch(`/api/products/${id}`, {
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
      type="button"
      className="btn-danger"
      disabled={pending}
      onClick={() => {
        if (!confirm("حذف محصول؟")) return;
        start(async () => {
          await safeJsonFetch(`/api/products/${id}`, { method: "DELETE" });
          router.push("/products");
          router.refresh();
        });
      }}
    >
      حذف
    </button>
  );
}
