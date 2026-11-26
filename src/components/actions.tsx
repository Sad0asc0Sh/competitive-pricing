"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconChevronDown, IconSliders, IconSpinner } from "./icons";
import { ConfirmDialog, useToast } from "./ui";

async function safeJsonFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
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
  onDone,
}: {
  productIds?: number[];
  cardRangeFrom?: number;
  cardRangeTo?: number;
  label?: string;
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
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
              const text = `اعمال: ${data.applied ?? 0} | بازبینی: ${data.pendingReview ?? 0} | رد/خطا: ${data.failed ?? 0}${lastErr}`;
              const isSuccess = Number(data.failed ?? 0) === 0 || Number(data.applied ?? 0) + Number(data.pendingReview ?? 0) > 0;
              setMsg({ ok: isSuccess, text });
              if (isSuccess) toast.success(text);
              else toast.error(text);
              onDone?.();
            } else {
              const errText = String(data.error ?? "خطا در اجرای استعلام");
              setMsg({ ok: false, text: errText });
              toast.error(errText);
            }
            router.refresh();
          })
        }
      >
        {pending && <IconSpinner className="h-4 w-4 shrink-0" />}
        <span>{pending ? "در حال استعلام…" : label}</span>
      </button>
      {msg && (
        <span className={`text-xs font-medium break-words ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}

/**
 * نوار ابزار اجرای هوشمند روی یک رنج دلخواه از کارت‌ها + دکمه پاک‌سازی فوری دسته ۳ و ریست قفل ترب
 */
export function CardRangeRunner({
  totalCards,
  defaultCollapsedOnMobile = false,
}: {
  totalCards: number;
  defaultCollapsedOnMobile?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fromCard, setFromCard] = useState(1);
  const [toCard, setToCard] = useState(Math.max(1, Math.min(3, totalCards || 3)));
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(!defaultCollapsedOnMobile);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  const presets: Array<[number, number]> = [
    [1, 3],
    [1, 5],
    [6, 10],
    [11, 15],
  ];

  const runCleanup = () =>
    start(async () => {
      setMsg(null);
      const { ok, data } = await safeJsonFetch("/api/campaigns/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = String(data.message ?? data.error ?? "پاک‌سازی انجام شد");
      setMsg({ ok, text });
      if (ok) toast.success(text);
      else toast.error(text);
      setCleanupConfirmOpen(false);
      router.refresh();
    });

  return (
    <>
      <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-indigo-950 sm:text-sm">
              🎯 اجرای هدفمند کف و سقف + تخفیف روی رنجی از کارت‌ها
            </div>
            <div className="mt-0.5 text-[11px] leading-5 text-slate-600 sm:text-xs">
              برای جلوگیری از چالش کپچای ترب (HTTP 490)، استعلام را در دسته‌های ۳ تا ۵ کارتی اجرا کنید
            </div>
          </div>

          {defaultCollapsedOnMobile && (
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-expanded={mobileOpen}
              className="btn-secondary btn-sm md:hidden"
            >
              <IconSliders className="h-3.5 w-3.5" />
              <span>{mobileOpen ? "بستن ابزار" : "تنظیم و اجرا"}</span>
              <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        <div className={`mt-3 space-y-3 ${mobileOpen ? "block" : "hidden md:block"}`}>
          {/* میانبرهای سریع رنج کارت */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[11px] font-medium text-slate-500">رنج سریع:</span>
            {presets.map(([f, t]) => {
              const clampedTo = totalCards > 0 ? Math.min(t, totalCards) : t;
              if (totalCards > 0 && f > totalCards) return null;
              const isCurrent = fromCard === f && toCard === clampedTo;
              return (
                <button
                  key={`${f}-${t}`}
                  type="button"
                  onClick={() => {
                    setFromCard(f);
                    setToCard(clampedTo);
                  }}
                  className={`chip num min-h-8 text-[11px] ${isCurrent ? "chip-active" : ""}`}
                >
                  کارت #{f.toLocaleString("fa-IR")} تا #{clampedTo.toLocaleString("fa-IR")}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-[110px_110px_minmax(150px,1fr)_auto_auto] lg:items-end">
            <div>
              <label className="label">از کارت #</label>
              <input
                className="input num"
                type="number"
                min={1}
                value={fromCard}
                onChange={(e) => setFromCard(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div>
              <label className="label">تا کارت #</label>
              <input
                className="input num"
                type="number"
                min={1}
                value={toCard}
                onChange={(e) => setToCard(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="col-span-2 sm:col-span-2 lg:col-span-1">
              <label className="label">فیلتر دسته (اختیاری)</label>
              <input
                className="input"
                placeholder="همه دسته‌ها"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="col-span-2 sm:col-span-2 lg:col-span-1">
              <button
                type="button"
                className="btn-primary w-full"
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
                      const lastErr =
                        typeof data.lastError === "string" && data.lastError ? ` — علت خطا: ${data.lastError}` : "";
                      const text = `کارت #${fromCard} تا #${toCard} بررسی شد → اعمال: ${data.applied ?? 0} | صف بازبینی: ${data.pendingReview ?? 0} | رد/خطا: ${data.failed ?? 0}${lastErr}`;
                      const isOk =
                        Number(data.failed ?? 0) === 0 ||
                        Number(data.applied ?? 0) + Number(data.pendingReview ?? 0) > 0;
                      setMsg({ ok: isOk, text });
                      if (isOk) toast.success(text);
                      else toast.error(text);
                    } else {
                      const errText = String(data.error ?? "خطا در اجرای رنج کارت‌ها");
                      setMsg({ ok: false, text: errText });
                      toast.error(errText);
                    }
                    router.refresh();
                  })
                }
              >
                {pending && <IconSpinner className="h-4 w-4 shrink-0" />}
                <span>{pending ? "در حال اجرا…" : `⚡ اعمال روی کارت #${fromCard} تا #${toCard}`}</span>
              </button>
            </div>
            <div className="col-span-2 sm:col-span-2 lg:col-span-1">
              <button
                type="button"
                className="btn-secondary w-full text-xs"
                disabled={pending}
                onClick={() => setCleanupConfirmOpen(true)}
              >
                🧹 پاک‌سازی دسته ۳ + ریست قفل ترب
              </button>
            </div>
          </div>

          {msg && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs font-medium break-words ${
                msg.ok
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-rose-300 bg-rose-50 text-rose-900"
              }`}
            >
              {msg.text}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        title="پاک‌سازی دسته ۳ و ریست قفل ترب"
        description="کارت‌هایی که بدون قیمت خرید به اشتباه وارد دسته ۳ (فرصت زمان‌دار) شده‌اند از دیتابیس و فروشگاه بازگردانی شده و قفل موقت استعلام ترب ریست می‌شود. ادامه می‌دهید؟"
        confirmLabel="تأیید و پاک‌سازی"
        tone="primary"
        busy={pending}
        onConfirm={runCleanup}
        onCancel={() => setCleanupConfirmOpen(false)}
      />
    </>
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
  const toast = useToast();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [belowCostReason, setBelowCostReason] = useState("");

  const act = (
    action: "approve" | "reject" | "retry_sync",
    overrideOpts?: { allowBelowCost: boolean; belowCostReason: string; authorizedBy: string },
  ) => {
    if (action === "approve" && isBelowFloor && !overrideOpts?.allowBelowCost) {
      setShowOverrideForm(true);
      const warn = "این تصمیم زیر کف هزینه/سود است؛ برای تایید، مجوز صریح مدیریت (Override) را ثبت کنید.";
      setMsg({ ok: false, text: warn });
      toast.info(warn);
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
      const text = String(data.message ?? (ok ? "انجام شد" : data.error ?? "خطا"));
      setMsg({ ok, text });
      if (ok) toast.success(text);
      else toast.error(text);
      router.refresh();
    });
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {syncFailed ? (
          <button
            type="button"
            className="btn-primary flex-1 text-xs sm:flex-initial"
            disabled={pending}
            onClick={() => act("retry_sync")}
          >
            {pending && <IconSpinner className="h-3.5 w-3.5" />}
            <span>🔄 تلاش مجدد ارسال به فروشگاه</span>
          </button>
        ) : (
          <button
            type="button"
            className={`flex-1 sm:flex-initial ${isBelowFloor ? "btn-danger text-xs" : "btn-success"}`}
            disabled={pending}
            onClick={() => act("approve")}
          >
            {pending && <IconSpinner className="h-3.5 w-3.5" />}
            <span>{isBelowFloor ? "⚠️ تایید با مجوز زیر کف…" : "تأیید و اعمال"}</span>
          </button>
        )}
        <button
          type="button"
          className="btn-secondary flex-1 sm:flex-initial"
          disabled={pending}
          onClick={() => act("reject")}
        >
          رد
        </button>
      </div>

      {msg && (
        <span className={`text-xs font-medium break-words ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.text}
        </span>
      )}

      {showOverrideForm && (
        <div className="w-full space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-right sm:w-80">
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger flex-1 text-xs sm:flex-initial"
              disabled={pending || authorizedBy.trim().length < 2 || belowCostReason.trim().length < 5}
              onClick={() =>
                act("approve", {
                  allowBelowCost: true,
                  authorizedBy: authorizedBy.trim(),
                  belowCostReason: belowCostReason.trim(),
                })
              }
            >
              {pending && <IconSpinner className="h-3.5 w-3.5" />}
              <span>ثبت مجوز و اعمال</span>
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 text-xs sm:flex-initial"
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
  const toast = useToast();
  const [pending, start] = useTransition();
  const next = status === "paused" ? "active" : "paused";
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const { ok, data } = await safeJsonFetch(`/api/products/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
          });
          if (ok) {
            toast.success(next === "active" ? "قیمت‌گذاری محصول فعال شد" : "قیمت‌گذاری محصول متوقف شد");
          } else {
            toast.error(String(data.error ?? "خطا در تغییر وضعیت محصول"));
          }
          router.refresh();
        })
      }
    >
      {pending && <IconSpinner className="h-4 w-4" />}
      <span>{status === "paused" ? "فعال‌سازی" : "توقف قیمت‌گذاری"}</span>
    </button>
  );
}

export function DeleteProductButton({ id, name }: { id: number; name?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = () =>
    start(async () => {
      const { ok, data } = await safeJsonFetch(`/api/products/${id}`, { method: "DELETE" });
      if (ok) {
        toast.success("محصول با موفقیت حذف شد");
        setConfirmOpen(false);
        router.push("/products");
        router.refresh();
      } else {
        toast.error(String(data.error ?? "خطا در حذف محصول"));
      }
    });

  return (
    <>
      <button
        type="button"
        className="btn-danger"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        {pending && <IconSpinner className="h-4 w-4" />}
        <span>حذف</span>
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="حذف کارت محصول"
        description={`آیا از حذف ${name ? `«${name}»` : "این محصول"} و تمام تاریخچه تصمیم‌های آن مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        confirmLabel="بله، حذف شود"
        tone="danger"
        busy={pending}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
