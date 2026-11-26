"use client";

import type { DiscountCampaign } from "@/db/schema";
import { badgeThemeLabel, campaignColor, campaignLabel, campaignShortLabel, faNum } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconChevronDown, IconPlus, IconSpinner, IconTrash } from "./icons";
import { CollapsibleSection, ConfirmDialog, EmptyState, ModalSheet, Switch, useToast } from "./ui";

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
  active: c?.active ?? false,
  priority: c?.priority ?? 10,
  minDiscountPct: c?.minDiscountPct ?? 10,
  maxDiscountPct: c?.maxDiscountPct ?? 45,
  activeHours: (c?.activeHours ?? []).join(","),
  activeDays: (c?.activeDays ?? []).join(","),
  categories: (c?.categories ?? []).join(","),
  durationHours: c?.durationHours ?? 48,
  badgeTheme: c?.badgeTheme ?? (c?.type === "flash" ? "gold-red" : c?.type === "featured" ? "red-purple" : "green-orange"),
  showInFeatured: c?.showInFeatured ?? (c?.type !== "flash"),
  cardRangeFrom: c?.cardRangeFrom ?? 1,
  cardRangeTo: c?.cardRangeTo ?? 10,
  maxCards: c?.maxCards ?? 0,
  minPriceToman: c?.minPriceToman ?? 0,
  maxPriceToman: c?.maxPriceToman ?? 0,
  onlyTopRanked: c?.onlyTopRanked ?? false,
  targetProductIds: (c?.targetProductIds ?? []).join(","),
});

export function CampaignEditor({ campaigns }: { campaigns: DiscountCampaign[] }) {
  const router = useRouter();
  const toast = useToast();
  const [prevCampaigns, setPrevCampaigns] = useState(campaigns);
  const [drafts, setDrafts] = useState<Draft[]>(() => campaigns.map((c) => toDraft(c)));
  const [newDraft, setNewDraft] = useState<Draft>(() => toDraft());
  const [newOpen, setNewOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [pending, start] = useTransition();
  const [runMsg, setRunMsg] = useState<Record<string, string>>({});
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);

  if (prevCampaigns !== campaigns) {
    setPrevCampaigns(campaigns);
    setDrafts(campaigns.map((c) => toDraft(c)));
  }

  const updateDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));

  const save = (d: Draft, key: string, onSuccess?: () => void) =>
    start(async () => {
      try {
        const res = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(d),
        });
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          const text = "✅ تنظیمات کمپین با موفقیت ذخیره شد";
          setRunMsg((m) => ({ ...m, [key]: text }));
          toast.success(text);
          onSuccess?.();
        } else {
          const err = String(j.error ?? "خطا در ذخیره کمپین");
          setRunMsg((m) => ({ ...m, [key]: `❌ ${err}` }));
          toast.error(err);
        }
        router.refresh();
      } catch (e) {
        const msg = `خطا در ارتباط با سرور: ${e instanceof Error ? e.message : String(e)}`;
        setRunMsg((m) => ({ ...m, [key]: `❌ ${msg}` }));
        toast.error(msg);
      }
    });

  const toggleActiveQuick = (idx: number, nextActive: boolean) => {
    const updated = { ...drafts[idx], active: nextActive };
    updateDraft(idx, { active: nextActive });
    save(updated, String(updated.id ?? idx));
  };

  const confirmDelete = () => {
    if (!deleteTarget?.id) return;
    const id = deleteTarget.id;
    start(async () => {
      try {
        const res = await fetch("/api/campaigns", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok) {
          setDrafts((ds) => ds.filter((x) => x.id !== id));
          toast.success("کمپین حذف شد");
          setDeleteTarget(null);
          router.refresh();
        } else {
          toast.error("خطا در حذف کمپین");
        }
      } catch {
        toast.error("خطا در ارتباط با سرور");
      }
    });
  };

  const runOnCardRange = (d: Draft, key: string) =>
    start(async () => {
      setRunMsg((m) => ({ ...m, [key]: "در حال استعلام سقف و کف و اعمال تخفیف روی رنج کارت‌ها…" }));
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardRangeFrom: d.cardRangeFrom,
            cardRangeTo: d.cardRangeTo,
            category: d.categories.split(",")[0]?.trim() || undefined,
          }),
        });
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        const j = await res.json().catch(() => ({}));
        const errTail = j.lastError ? ` — علت خطا: ${j.lastError}` : "";
        const text = res.ok
          ? `انجام شد: ${j.applied ?? 0} کارت اعمال شد | ${j.pendingReview ?? 0} در صف بازبینی | ${j.failed ?? 0} رد/خطا${errTail}`
          : String(j.error ?? "خطا در اجرا");
        setRunMsg((m) => ({ ...m, [key]: text }));
        if (res.ok) toast.success(text);
        else toast.error(text);
        router.refresh();
      } catch (e) {
        const text = `خطا در ارسال درخواست: ${e instanceof Error ? e.message : String(e)}`;
        setRunMsg((m) => ({ ...m, [key]: text }));
        toast.error(text);
      }
    });

  const cleanupTimedSales = () =>
    start(async () => {
      setCleanupMsg("در حال پاک‌سازی کارت‌های اشتباه دسته ۳ و بازگردانی در فروشگاه…");
      try {
        const res = await fetch("/api/campaigns/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = await res.json().catch(() => ({}));
        const text = String(j.message ?? j.error ?? "پاک‌سازی انجام شد");
        setCleanupMsg(text);
        if (res.ok) toast.success(text);
        else toast.error(text);
        setCleanupConfirmOpen(false);
        router.refresh();
      } catch (e) {
        const text = `خطا: ${e instanceof Error ? e.message : String(e)}`;
        setCleanupMsg(text);
        toast.error(text);
      }
    });

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* نوار اکشن بالای صفحه */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium text-slate-500">
          <span className="num font-bold text-slate-800">{faNum(drafts.length)}</span> کمپین ثبت‌شده · برای ویرایش جزئیات روی هر کارت کلیک کنید
        </div>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => {
            setNewDraft(toDraft());
            setNewOpen(true);
          }}
        >
          <IconPlus className="h-4 w-4" />
          <span>تعریف قانون و کمپین جدید</span>
        </button>
      </div>

      {/* نوار پاک‌سازی فوری کارت اشتباه دسته ۳ */}
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs leading-6 text-amber-950">
          <b>🛡️ محافظت از دسته ۳ (فرصت‌های زمان‌دار مالی و تخفیف):</b> اگر از تست‌های قبلی کارتی بدون قیمت خرید به اشتباه وارد دسته ۳ شده است، با دکمه روبه‌رو هم از دیتابیس پنل و هم از بخش «مالی و تخفیف» سایت پاک‌سازی و به حالت عادی برگردانده می‌شود.
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0 font-bold"
          disabled={pending}
          onClick={() => setCleanupConfirmOpen(true)}
        >
          🧹 پاک‌سازی دسته ۳ + ریست قفل ترب
        </button>
      </div>
      {cleanupMsg && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs font-bold text-indigo-900">
          {cleanupMsg}
        </div>
      )}

      {/* راهنمای بازشوی ۳ سیستم تخفیف */}
      <CollapsibleSection
        title="راهنمای ۳ سیستم تخفیف فروشگاه sgeooole"
        subtitle="جزئیات پیشنهاد لحظه‌ای، پیشنهاد شگفت‌انگیز و فرصت‌های زمان‌دار"
        defaultOpen={false}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-bold text-amber-900">۱. پیشنهاد لحظه‌ای (Flash Deal)</span>
              <span className="badge bg-amber-200 text-amber-900">صفحه اصلی</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-amber-800">
              نمایش در ریل «پیشنهادهای لحظه‌ای» صفحه اصلی (<code dir="ltr">isFlashDeal = true</code>) با تم طلایی-قرمز. مناسب کارت‌های رتبه ۱ مشهد/ترب با درصد تخفیف جذاب.
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-bold text-rose-900">۲. پیشنهاد شگفت‌انگیز (Special Offer)</span>
              <span className="badge bg-rose-200 text-rose-900">صفحه اصلی</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-rose-800">
              نمایش در بخش «شگفت‌انگیزها / منتخب‌ها» صفحه اصلی (<code dir="ltr">isSpecialOffer = true</code>). سقف قیمت بازار را خط زده و درصد تخفیف را دقیق روی کف هدف اعمال می‌کند.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-bold text-emerald-900">۳. فرصت‌های زمان‌دار (مالی و تخفیف)</span>
              <span className="badge bg-emerald-200 text-emerald-900">پنل مدیریت + منتخب‌ها</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-emerald-800">
              مدیریت خودکار کمپین‌های <code dir="ltr">Sale</code> در بخش «مالی و تخفیف» پنل ادمین با قابلیت انتخاب نام دلخواه، تم رنگی و تیک «نمایش در منتخب‌های صفحه اصلی».
            </p>
          </div>
        </div>
      </CollapsibleSection>

      {/* لیست کمپین‌ها */}
      {drafts.length === 0 ? (
        <EmptyState
          title="هنوز کمپینی تعریف نشده است"
          description="یک قانون و کمپین تخفیف جدید بسازید تا کارت‌ها در سیستم تخفیف فروشگاه قرار گیرند."
          action={
            <button type="button" onClick={() => setNewOpen(true)} className="btn-primary btn-sm">
              <IconPlus className="h-4 w-4" />
              <span>افزودن اولین کمپین</span>
            </button>
          }
        />
      ) : (
        <div className="space-y-3.5">
          {drafts.map((d, i) => {
            const key = String(d.id ?? `row-${i}`);
            const isExpanded = Boolean(d.id && expandedIds[d.id]);

            return (
              <div
                key={key}
                className={`card space-y-3 transition ${d.active ? "border-indigo-200/90" : "border-slate-200 opacity-95"}`}
              >
                {/* خلاصه کمپین */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{d.name || "کمپین بدون نام"}</h2>
                      <span className={`badge border text-[11px] ${campaignColor[d.type] ?? "bg-slate-100"}`}>
                        {campaignShortLabel[d.type] ?? campaignLabel[d.type] ?? d.type}
                      </span>
                      {d.type === "timed_sale" && (
                        <span className="badge bg-slate-100 text-[11px] text-slate-700">
                          تم: {badgeThemeLabel[d.badgeTheme] ?? d.badgeTheme}
                        </span>
                      )}
                      {d.showInFeatured && (
                        <span className="badge bg-indigo-100 text-[11px] text-indigo-800">★ منتخب صفحه اصلی</span>
                      )}
                    </div>
                    <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        بازه: <b>کارت #{faNum(d.cardRangeFrom)}</b> تا <b>#{faNum(d.cardRangeTo)}</b>
                      </span>
                      <span>
                        تخفیف: <b>{faNum(d.minDiscountPct)}٪ تا {faNum(d.maxDiscountPct)}٪</b>
                      </span>
                      <span>اولویت: <b>{faNum(d.priority)}</b></span>
                      <span>{d.maxCards > 0 ? `سقف ${faNum(d.maxCards)} کارت` : "بدون سقف تعداد"}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5 sm:border-t-0 sm:pt-0">
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                      <Switch
                        checked={d.active}
                        disabled={pending}
                        onChange={(next) => toggleActiveQuick(i, next)}
                      />
                      <span className="text-xs font-semibold text-slate-700">
                        {d.active ? "فعال" : "غیرفعال"}
                      </span>
                    </div>

                    {d.id && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm flex-1 sm:flex-initial"
                        disabled={pending}
                        onClick={() => runOnCardRange(d, key)}
                      >
                        ⚡ اعمال روی #{faNum(d.cardRangeFrom)}–#{faNum(d.cardRangeTo)}
                      </button>
                    )}

                    {d.id && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(d.id!)}
                        aria-expanded={isExpanded}
                        className="btn-secondary btn-sm flex-1 sm:flex-initial"
                      >
                        <span>{isExpanded ? "بستن ویرایش" : "ویرایش قوانین"}</span>
                        <IconChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>
                </div>

                {runMsg[key] && (
                  <div className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800">
                    {runMsg[key]}
                  </div>
                )}

                {/* فرم ویرایش بازشو */}
                {isExpanded && (
                  <div className="space-y-4 border-t border-slate-100 pt-4">
                    <CampaignFormFields
                      draft={d}
                      onChange={(patch) => updateDraft(i, patch)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          className="btn-primary flex-1 sm:flex-initial"
                          disabled={pending || !d.name}
                          onClick={() => save(d, key)}
                        >
                          {pending && <IconSpinner className="h-4 w-4" />}
                          <span>💾 ذخیره تنظیمات کمپین</span>
                        </button>
                        {d.id && (
                          <button
                            type="button"
                            className="btn-danger flex-1 sm:flex-initial"
                            disabled={pending}
                            onClick={() => setDeleteTarget(d)}
                          >
                            <IconTrash className="h-4 w-4" />
                            <span>حذف کمپین</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* مودال افزودن کمپین جدید */}
      <ModalSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="تعریف قانون و کمپین تخفیف جدید"
        subtitle="بازه کارت‌ها، درصد تخفیف و نوع سیستم تخفیف را تنظیم کنید"
        maxWidth="xl"
      >
        <div className="space-y-4">
          <CampaignFormFields
            draft={newDraft}
            onChange={(patch) => setNewDraft((prev) => ({ ...prev, ...patch }))}
          />
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setNewOpen(false)}>
              انصراف
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !newDraft.name.trim()}
              onClick={() =>
                save(newDraft, "new", () => {
                  setNewDraft(toDraft());
                  setNewOpen(false);
                })
              }
            >
              {pending && <IconSpinner className="h-4 w-4" />}
              <span>➕ افزودن کمپین جدید</span>
            </button>
          </div>
        </div>
      </ModalSheet>

      <ConfirmDialog
        open={cleanupConfirmOpen}
        title="پاک‌سازی دسته ۳ و ریست قفل ترب"
        description="آیا از پاک‌سازی کارت‌های اشتباه دسته ۳ (فرصت‌های زمان‌دار) و ریست قفل ترب مطمئن هستید؟"
        confirmLabel="تأیید و پاک‌سازی"
        tone="primary"
        busy={pending}
        onConfirm={cleanupTimedSales}
        onCancel={() => setCleanupConfirmOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="حذف کمپین تخفیف"
        description={`آیا از حذف کمپین «${deleteTarget?.name ?? ""}» مطمئن هستید؟`}
        confirmLabel="بله، حذف شود"
        tone="danger"
        busy={pending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CampaignFormFields({
  draft: d,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* ردیف اول: مشخصات اصلی */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">نام کمپین / برچسب روی کارت محصول *</label>
          <input
            className="input"
            value={d.name}
            placeholder="مثلاً جشنواره ویژه مشهد یا پیشنهاد لحظه‌ای"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">سیستم تخفیف هدف در sgeooole</label>
          <select
            className="input font-medium"
            value={d.type}
            onChange={(e) => {
              const nextType = e.target.value;
              onChange({
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
            onChange={(e) => onChange({ priority: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">مدت تایمر کمپین (ساعت)</label>
          <input
            className="input num"
            type="number"
            value={d.durationHours}
            onChange={(e) => onChange({ durationHours: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* ردیف دوم: رنج کارت‌ها و بازه تخفیف */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
        <div className="mb-3">
          <div className="text-xs font-bold text-slate-800">
            🎯 هدف‌گیری رنج کارت‌ها و شرایط اعمال تخفیف (سقف معیار به کف رقابتی)
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            می‌توانید این کمپین را دقیقاً روی یک بازه از کارت‌های محصول (مثلاً کارت ۱ تا ۵) محدود کنید
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <label className="label">از کارت شماره</label>
            <input
              className="input num"
              type="number"
              min={1}
              value={d.cardRangeFrom}
              onChange={(e) => onChange({ cardRangeFrom: Math.max(1, Number(e.target.value)) })}
            />
          </div>
          <div>
            <label className="label">تا کارت شماره</label>
            <input
              className="input num"
              type="number"
              min={1}
              value={d.cardRangeTo}
              onChange={(e) => onChange({ cardRangeTo: Math.max(1, Number(e.target.value)) })}
            />
          </div>
          <div>
            <label className="label">سقف تعداد کارت (۰=نامحدود)</label>
            <input
              className="input num"
              type="number"
              min={0}
              value={d.maxCards}
              onChange={(e) => onChange({ maxCards: Math.max(0, Number(e.target.value)) })}
            />
          </div>
          <div>
            <label className="label">حداقل تخفیف (سقف به کف) ٪</label>
            <input
              className="input num"
              type="number"
              value={d.minDiscountPct}
              onChange={(e) => onChange({ minDiscountPct: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">حداکثر تخفیف ٪</label>
            <input
              className="input num"
              type="number"
              value={d.maxDiscountPct}
              onChange={(e) => onChange({ maxDiscountPct: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">حداقل قیمت کف (تومان)</label>
            <input
              className="input num"
              type="number"
              step={50000}
              value={d.minPriceToman}
              onChange={(e) => onChange({ minPriceToman: Number(e.target.value) })}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label">حداکثر قیمت کف (۰=نامحدود)</label>
            <input
              className="input num"
              type="number"
              step={50000}
              value={d.maxPriceToman}
              onChange={(e) => onChange({ maxPriceToman: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* ردیف سوم: ظاهر و زمان‌بندی */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label">تم رنگی نشان تخفیف روی کارت</label>
          <select
            className="input"
            value={d.badgeTheme}
            onChange={(e) => onChange({ badgeTheme: e.target.value })}
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
            onChange={(e) => onChange({ categories: e.target.value })}
          />
        </div>
        <div>
          <label className="label">ساعات فعال (0-23؛ خالی=همه)</label>
          <input
            className="input"
            dir="ltr"
            value={d.activeHours}
            onChange={(e) => onChange({ activeHours: e.target.value })}
            placeholder="9,10,11,20,21,22"
          />
        </div>
        <div>
          <label className="label">روزهای فعال (0=یکشنبه…6=شنبه)</label>
          <input
            className="input"
            dir="ltr"
            value={d.activeDays}
            onChange={(e) => onChange({ activeDays: e.target.value })}
            placeholder="6,0,1,2,3"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">شناسه کارت‌های خاص (ID محصولات با کاما؛ خالی = بر اساس رنج کارت)</label>
          <input
            className="input"
            dir="ltr"
            value={d.targetProductIds}
            onChange={(e) => onChange({ targetProductIds: e.target.value })}
            placeholder="1, 2, 5, 12"
          />
        </div>
      </div>

      {/* ردیف چهارم: سوئیچ‌های کنترلی */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3.5 md:grid-cols-3">
        <Switch
          checked={d.active}
          onChange={(next) => onChange({ active: next })}
          label="کمپین فعال باشد"
        />
        <Switch
          checked={d.showInFeatured}
          onChange={(next) => onChange({ showInFeatured: next })}
          label="★ نمایش در «منتخب‌ها»"
          description="صفحه اصلی سایت (showInFeatured)"
        />
        <Switch
          checked={d.onlyTopRanked}
          onChange={(next) => onChange({ onlyTopRanked: next })}
          label="فقط رتبه‌های ۱ تا ۳"
          description="در مشهد یا کل ترب"
        />
      </div>
    </div>
  );
}
