"use client";

import type { ListingPanel } from "@/lib/pricing/listing";
import type { PanelCompetitiveEvidence } from "@/lib/pricing/types";
import { ListingLinks } from "./listing-links";
import { TorobPanelComparison } from "./torob-evidence";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { campaignLabel, faDate, faNum, pct, statusColor, statusLabel, toman } from "@/lib/format";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconSearch } from "./icons";
import { EmptyState, ModalSheet } from "./ui";

export interface SerializedRunItem {
  id: number;
  trigger: string;
  runMode: string;
  status: string;
  totalProducts: number;
  applied: number;
  pendingReview: number;
  failed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SerializedDecisionStep {
  step: string;
  title: string;
  message: string;
  level?: "info" | "warn" | "error";
}

export interface SerializedRunDecision {
  panels: ListingPanel[];
  panelEvidence?: PanelCompetitiveEvidence[];
  id: number;
  productId: number;
  name: string;
  sku: string;
  source: string;
  offersUsed: number;
  offersTotal: number;
  referencePrice: number | null;
  basePrice: number | null;
  finalPrice: number | null;
  discountPct: number | null;
  campaignType: string | null;
  strategy: string | null;
  confidence: number;
  status: string;
  pushStatus: string | null;
  pushError: string | null;
  errorSummary: string | null;
  steps: SerializedDecisionStep[];
}

export interface SerializedRunLog {
  id: number;
  scope: string;
  level: string;
  message: string;
  createdAt: string;
}

type DecisionStatusFilter = "all" | "applied" | "pending_review" | "failed";

function triggerLabel(trigger: string) {
  if (trigger === "schedule") return "زمان‌بندی";
  if (trigger === "manual") return "دستی";
  return "API";
}

export function RunsClient({
  runs,
  selectedRunId,
  decisions,
  runLogs = [],
}: {
  runs: SerializedRunItem[];
  selectedRunId: number | null;
  decisions: SerializedRunDecision[];
  runLogs?: SerializedRunLog[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [runSearch, setRunSearch] = useState("");
  const [decisionSearch, setDecisionSearch] = useState("");
  const [panelSize, setPanelSize] = useState(0);
  const [statusFilter, setStatusFilter] = useState<DecisionStatusFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const selectedIndex = useMemo(
    () => runs.findIndex((r) => r.id === selectedRunId),
    [runs, selectedRunId],
  );
  const selectedRun = selectedIndex >= 0 ? runs[selectedIndex] : runs[0] ?? null;
  const newerRun = selectedIndex > 0 ? runs[selectedIndex - 1] : null;
  const olderRun = selectedIndex >= 0 && selectedIndex < runs.length - 1 ? runs[selectedIndex + 1] : null;

  const filteredRuns = useMemo(() => {
    const q = runSearch.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (r) =>
        `#${r.id}`.includes(q) ||
        triggerLabel(r.trigger).toLowerCase().includes(q) ||
        (statusLabel[r.status] ?? r.status).toLowerCase().includes(q),
    );
  }, [runs, runSearch]);

  const filteredDecisions = useMemo(() => {
    const q = decisionSearch.trim().toLowerCase();
    return decisions.filter((d) => {
      if (panelSize && !d.panels.some((p) => p.sellerCount === panelSize)) return false;
      if (statusFilter === "applied" && d.status !== "applied") return false;
      if (statusFilter === "pending_review" && d.status !== "pending_review") return false;
      if (statusFilter === "failed" && !["rejected", "failed", "sync_failed", "pending_sync"].includes(d.status)) {
        return false;
      }
      if (q && !d.name.toLowerCase().includes(q) && !d.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [decisions, statusFilter, decisionSearch, panelSize]);

  const diagnosticLogs = useMemo(
    () => runLogs.filter((l) => l.level === "error" || l.level === "warn" || Boolean(selectedRun?.error)),
    [runLogs, selectedRun],
  );

  const renderRunList = (onPick?: () => void) => (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pr-9 text-xs"
          placeholder="جستجوی شماره اجرا یا نوع…"
          value={runSearch}
          onChange={(e) => setRunSearch(e.target.value)}
        />
      </div>
      <ul className="space-y-1.5">
        {filteredRuns.map((r) => {
          const active = selectedRun?.id === r.id;
          const hasErr = r.failed > 0 || Boolean(r.error);
          return (
            <li key={r.id}>
              <Link
                href={`/runs?run=${r.id}`}
                onClick={onPick}
                className={`block rounded-xl border px-3 py-2.5 text-sm transition ${
                  active
                    ? "border-indigo-300 bg-indigo-50/90 text-indigo-950 shadow-xs"
                    : "border-transparent bg-slate-50/60 hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">
                    #{faNum(r.id)} · {triggerLabel(r.trigger)}
                  </span>
                  <div className="flex items-center gap-1">
                    {hasErr && (
                      <span className="badge bg-rose-100 text-[10px] text-rose-800" title={r.error ?? "دارای خطا"}>
                        خطا
                      </span>
                    )}
                    <span className={`badge text-[11px] ${statusColor[r.status] ?? "bg-slate-100"}`}>
                      {statusLabel[r.status] ?? r.status}
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
                  <span>{faDate(r.startedAt)}</span>
                  <span className="num">
                    {faNum(r.totalProducts)} کالا · {faNum(r.applied)}✓ {faNum(r.pendingReview)}⏳ {faNum(r.failed)}✗
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
        {filteredRuns.length === 0 && (
          <li className="py-6 text-center text-xs text-slate-400">اجرایی یافت نشد</li>
        )}
      </ul>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* نوار انتخاب سریع اجرا برای موبایل و تبلت (< xl) */}
      <div className="card space-y-3 xl:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold text-slate-900">تاریخچه اجراها</h1>
            <p className="text-xs text-slate-500">{faNum(runs.length)} اجرای اخیر ثبت شده</p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="btn-primary btn-sm"
            disabled={runs.length === 0}
          >
            <span>انتخاب از {faNum(runs.length)} اجرا</span>
            <IconChevronDown className="h-4 w-4" />
          </button>
        </div>

        {selectedRun && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-indigo-950">
                اجرای #{faNum(selectedRun.id)} · {triggerLabel(selectedRun.trigger)}
              </div>
              <div className="flex items-center gap-1.5">
                {(selectedRun.failed > 0 || selectedRun.error) && (
                  <span className="badge bg-rose-100 text-[11px] text-rose-800">دارای خطا</span>
                )}
                <span className={`badge ${statusColor[selectedRun.status] ?? "bg-slate-100"}`}>
                  {statusLabel[selectedRun.status] ?? selectedRun.status}
                </span>
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-600">{faDate(selectedRun.startedAt)}</div>
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-indigo-200/70 pt-2">
              <div className="num text-xs text-slate-700">
                {faNum(selectedRun.totalProducts)} کالا · {faNum(selectedRun.applied)} اعمال ·{" "}
                {faNum(selectedRun.pendingReview)} بازبینی · {faNum(selectedRun.failed)} خطا
              </div>
              <div className="flex items-center gap-1">
                {newerRun && (
                  <Link
                    href={`/runs?run=${newerRun.id}`}
                    aria-label="اجرای جدیدتر"
                    className="btn-icon h-8 w-8"
                  >
                    <IconChevronRight className="h-4 w-4" />
                  </Link>
                )}
                {olderRun && (
                  <Link
                    href={`/runs?run=${olderRun.id}`}
                    aria-label="اجرای قبلی"
                    className="btn-icon h-8 w-8"
                  >
                    <IconChevronLeft className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* چیدمان Master-Detail دسکتاپ */}
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
        <aside className="card hidden xl:sticky xl:top-20 xl:flex xl:max-h-[calc(100dvh-7rem)] xl:flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-lg font-extrabold text-slate-900">اجراها</h1>
            <span className="badge bg-slate-100 text-slate-600 num">{faNum(runs.length)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pl-1">{renderRunList()}</div>
        </aside>

        <div className="min-w-0 space-y-4">
          {selectedRun && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <RunStat label="کل محصولات اجرا" value={faNum(selectedRun.totalProducts)} />
              <RunStat label="اعمال‌شده" value={faNum(selectedRun.applied)} tone="emerald" />
              <RunStat label="در انتظار بازبینی" value={faNum(selectedRun.pendingReview)} tone="amber" />
              <RunStat label="رد / خطا" value={faNum(selectedRun.failed)} tone="rose" />
            </div>
          )}

          {(selectedRun?.error || diagnosticLogs.length > 0) && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-rose-950">🔍 گزارش خطا و لاگ‌های عیب‌یابی اجرا</h3>
                {selectedRun && (
                  <span className="text-[11px] text-rose-700">
                    اجرای #{faNum(selectedRun.id)} · حالت: {selectedRun.runMode}
                  </span>
                )}
              </div>
              {selectedRun?.error && (
                <div className="rounded-xl border border-rose-300 bg-white/90 px-3 py-2 text-xs font-medium leading-6 text-rose-900 break-words">
                  <strong>علت اصلی خطای اجرا:</strong> {selectedRun.error}
                </div>
              )}
              {diagnosticLogs.length > 0 && (
                <ul className="space-y-1.5">
                  {diagnosticLogs.map((log) => (
                    <li
                      key={log.id}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs leading-5 break-words ${
                        log.level === "error"
                          ? "border-rose-200 bg-white text-rose-900"
                          : log.level === "warn"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-slate-200 bg-white/80 text-slate-700"
                      }`}
                    >
                      <span className="ml-1.5 font-semibold">[{log.scope}]</span>
                      <span>{log.message}</span>
                      <span className="mr-2 text-[10px] opacity-70">{faDate(log.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="card space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-bold text-slate-900">
                تصمیم‌های اجرای #{selectedRun ? faNum(selectedRun.id) : "—"}
              </h2>
              <select aria-label="تعداد فروشندگان پنل ترب" className="input w-full text-xs sm:w-auto"
                value={panelSize} onChange={(event) => setPanelSize(Number(event.target.value))}>
                <option value={0}>همهٔ پنل‌ها</option>
                <option value={1}>تک‌فروشنده</option>
                <option value={2}>دو فروشنده</option>
                <option value={3}>سه فروشنده</option>
              </select>
              <div className="relative w-full sm:w-64">
                <IconSearch className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pr-9 text-xs"
                  placeholder="جستجوی محصول یا SKU…"
                  value={decisionSearch}
                  onChange={(e) => setDecisionSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {(
                [
                  { key: "all", label: "همه", count: decisions.length },
                  { key: "applied", label: "اعمال‌شده", count: decisions.filter((d) => d.status === "applied").length },
                  {
                    key: "pending_review",
                    label: "بازبینی",
                    count: decisions.filter((d) => d.status === "pending_review").length,
                  },
                  {
                    key: "failed",
                    label: "رد / خطا",
                    count: decisions.filter((d) => ["rejected", "failed", "sync_failed", "pending_sync"].includes(d.status)).length,
                  },
                ] as const
              ).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setStatusFilter(c.key)}
                  className={`chip ${statusFilter === c.key ? "chip-active" : ""}`}
                >
                  <span>{c.label}</span>
                  <span className={`num text-[11px] ${statusFilter === c.key ? "text-indigo-100" : "text-slate-400"}`}>
                    ({faNum(c.count)})
                  </span>
                </button>
              ))}
            </div>

            {filteredDecisions.length === 0 ? (
              <EmptyState
                title={decisions.length ? "موردی مطابق فیلترها پیدا نشد" : "تصمیمی در این اجرا وجود ندارد"}
                description={
                  decisions.length ? "جستجو یا فیلتر تعداد فروشندگان را تغییر دهید." : selectedRun?.error
                    ? `علت: ${selectedRun.error}`
                    : runLogs.length > 0
                      ? runLogs[0].message
                      : undefined
                }
              />
            ) : (
              <>
                <div className="space-y-3 lg:hidden">
                  {filteredDecisions.map((d) => {
                    const isExpanded = expandedId === d.id;
                    const isErrStatus = ["rejected", "failed", "sync_failed"].includes(d.status);
                    return (
                      <div key={d.id} className="m-row space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <Link href={`/products/${d.productId}`} className="block truncate font-bold text-indigo-700">
                              {d.name}
                            </Link>
                            <div className="text-xs text-slate-400">{d.sku}</div>
                            <ListingLinks panels={d.panels} />
                          </div>
                          <span className={`badge shrink-0 ${statusColor[d.status] ?? "bg-slate-100"}`}>
                            {statusLabel[d.status] ?? d.status}
                          </span>
                        </div>
                        {d.errorSummary && (
                          <p
                            className={`rounded-lg px-2.5 py-1.5 text-xs leading-5 break-words ${
                              isErrStatus ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"
                            }`}
                          >
                            {d.errorSummary}
                          </p>
                        )}
                        <div className="m-row-kv">
                          <span>قیمت نهایی</span>
                          <span className="num font-bold text-emerald-700">{toman(d.finalPrice)}</span>
                        </div>
                        <div className="m-row-kv">
                          <span>مرجع / اصلی</span>
                          <span className="num text-xs">
                            {toman(d.referencePrice)} / {toman(d.basePrice)}
                          </span>
                        </div>
                        <div className="m-row-kv">
                          <span>تخفیف / کمپین / اعتماد</span>
                          <span className="num text-xs">
                            {pct(d.discountPct)} · {campaignLabel[d.campaignType ?? "none"]} · {pct(d.confidence * 100, 0)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : d.id)}
                          className="btn-secondary btn-sm w-full text-xs"
                        >
                          {isExpanded ? "بستن جزئیات مراحل" : `🔍 جزئیات مراحل (${faNum(d.steps.length)})`}
                        </button>
                        {isExpanded && <DecisionStepsDetail decision={d} />}
                      </div>
                    );
                  })}
                </div>

                <div className="table-scroll hidden lg:block">
                  <table className="data min-w-[920px]">
                    <thead>
                      <tr>
                        <th>محصول</th>
                        <th>منبع</th>
                        <th>معتبر/کل</th>
                        <th>مرجع</th>
                        <th>اصلی</th>
                        <th>نهایی</th>
                        <th>تخفیف</th>
                        <th>کمپین</th>
                        <th>اعتماد</th>
                        <th>وضعیت / جزئیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDecisions.map((d) => {
                        const isExpanded = expandedId === d.id;
                        const isErrStatus = ["rejected", "failed", "sync_failed"].includes(d.status);
                        return (
                          <Fragment key={d.id}>
                            <tr>
                              <td className="max-w-[260px]">
                                <Link href={`/products/${d.productId}`} className="block truncate font-medium text-indigo-700 hover:underline">
                                  {d.name}
                                </Link>
                                <div className="text-xs text-slate-400">{d.sku}</div>
                                <ListingLinks panels={d.panels} />
                                {d.errorSummary && (
                                  <div
                                    className={`mt-1 line-clamp-2 text-[11px] leading-4 ${
                                      isErrStatus ? "text-rose-700" : "text-amber-800"
                                    }`}
                                    title={d.errorSummary}
                                  >
                                    {d.errorSummary}
                                  </div>
                                )}
                              </td>
                              <td>{d.source}</td>
                              <td className="num">
                                {faNum(d.offersUsed)}/{faNum(d.offersTotal)}
                              </td>
                              <td className="num">{toman(d.referencePrice)}</td>
                              <td className="num line-through decoration-slate-400">{toman(d.basePrice)}</td>
                              <td className="num font-bold text-emerald-700">{toman(d.finalPrice)}</td>
                              <td className="num">{pct(d.discountPct)}</td>
                              <td className="text-xs">{campaignLabel[d.campaignType ?? "none"]}</td>
                              <td className="num">{pct(d.confidence * 100, 0)}</td>
                              <td>
                                <div className="flex flex-col items-start gap-1">
                                  <span className={`badge ${statusColor[d.status] ?? "bg-slate-100"}`}>
                                    {statusLabel[d.status] ?? d.status}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                                    className="text-[11px] font-medium text-indigo-700 hover:underline"
                                  >
                                    {isExpanded ? "بستن مراحل ▲" : `جزئیات (${faNum(d.steps.length)}) ▼`}
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={10} className="bg-slate-50/90 p-3">
                                  <DecisionStepsDetail decision={d} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* شیت انتخاب اجرا در موبایل */}
      <ModalSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="انتخاب اجرا از تاریخچه"
        subtitle="یکی از ۵۰ اجرای اخیر را انتخاب کنید"
        maxWidth="md"
      >
        {renderRunList(() => setPickerOpen(false))}
      </ModalSheet>
    </div>
  );
}

function DecisionStepsDetail({ decision }: { decision: SerializedRunDecision }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-right">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
        <span className="font-bold text-slate-800">
          ردپای تصمیم #{faNum(decision.id)} — استراتژی: {decision.strategy || "—"}
        </span>
        <Link href={`/products/${decision.productId}`} className="font-medium text-indigo-700 hover:underline">
          مشاهده صفحه محصول ←
        </Link>
      </div>
      {decision.pushError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-900 break-words">
          <strong>خطای ثبت/ارسال:</strong> {decision.pushError}
        </div>
      )}
      <TorobPanelComparison panels={decision.panelEvidence} />
      {decision.steps.length === 0 ? (
        <p className="text-xs text-slate-500">هیچ گامی برای این تصمیم ثبت نشده است.</p>
      ) : (
        <ol className="space-y-1.5">
          {decision.steps.map((s, idx) => {
            const cls =
              s.level === "error"
                ? "border-rose-200 bg-rose-50/70 text-rose-950"
                : s.level === "warn"
                  ? "border-amber-200 bg-amber-50/70 text-amber-950"
                  : "border-slate-200 bg-slate-50/70 text-slate-800";
            const badgeCls =
              s.level === "error"
                ? "bg-rose-200 text-rose-900"
                : s.level === "warn"
                  ? "bg-amber-200 text-amber-900"
                  : "bg-slate-200 text-slate-700";
            return (
              <li key={`${s.step}-${idx}`} className={`rounded-lg border px-2.5 py-2 text-xs leading-5 ${cls}`}>
                <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${badgeCls}`}>{s.step}</span>
                  <span>{s.title}</span>
                </div>
                <div className="mt-1 break-words">{s.message}</div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function RunStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber" | "rose";
}) {
  const styles =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/70 text-amber-800"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50/70 text-rose-800"
          : "text-slate-900";

  return (
    <div className={`card ${styles}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="num mt-1.5 text-xl font-extrabold">{value}</div>
    </div>
  );
}
