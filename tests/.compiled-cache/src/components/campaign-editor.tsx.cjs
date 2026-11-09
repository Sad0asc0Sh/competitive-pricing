"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignEditor = CampaignEditor;
const jsx_runtime_1 = require("react/jsx-runtime");
const format_1 = require("../lib/format");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const toDraft = (c) => ({
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
function CampaignEditor({ campaigns }) {
    const router = (0, navigation_1.useRouter)();
    const [drafts, setDrafts] = (0, react_1.useState)([...campaigns.map((c) => toDraft(c)), toDraft()]);
    const [pending, start] = (0, react_1.useTransition)();
    const [runMsg, setRunMsg] = (0, react_1.useState)({});
    const [cleanupMsg, setCleanupMsg] = (0, react_1.useState)(null);
    const update = (i, patch) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const save = (d, key) => start(async () => {
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
            setRunMsg((m) => ({
                ...m,
                [key]: res.ok ? "✅ تنظیمات کمپین با موفقیت ذخیره شد" : `❌ ${j.error ?? "خطا در ذخیره کمپین"}`,
            }));
            router.refresh();
            if (!d.id && res.ok)
                setDrafts((ds) => ds.map((x) => (x === d ? toDraft() : x)));
        }
        catch (e) {
            setRunMsg((m) => ({
                ...m,
                [key]: `❌ خطا در ارتباط با سرور: ${e instanceof Error ? e.message : String(e)}`,
            }));
        }
    });
    const remove = (id) => start(async () => {
        try {
            await fetch("/api/campaigns", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            setDrafts((ds) => ds.filter((x) => x.id !== id));
            router.refresh();
        }
        catch {
            // ignore
        }
    });
    const runOnCardRange = (d, key) => start(async () => {
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
            setRunMsg((m) => ({
                ...m,
                [key]: res.ok
                    ? `انجام شد: ${j.applied ?? 0} کارت اعمال شد | ${j.pendingReview ?? 0} در صف بازبینی | ${j.failed ?? 0} رد/خطا${errTail}`
                    : j.error ?? "خطا در اجرا",
            }));
            router.refresh();
        }
        catch (e) {
            setRunMsg((m) => ({
                ...m,
                [key]: `خطا در ارسال درخواست: ${e instanceof Error ? e.message : String(e)}`,
            }));
        }
    });
    const cleanupTimedSales = () => start(async () => {
        setCleanupMsg("در حال پاک‌سازی کارت‌های اشتباه دسته ۳ و بازگردانی در فروشگاه…");
        try {
            const res = await fetch("/api/campaigns/cleanup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const j = await res.json().catch(() => ({}));
            setCleanupMsg(j.message ?? j.error ?? "پاک‌سازی انجام شد");
            router.refresh();
        }
        catch (e) {
            setCleanupMsg(`خطا: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "text-xs leading-5 text-amber-950", children: [(0, jsx_runtime_1.jsx)("b", { children: "\uD83D\uDEE1\uFE0F \u0645\u062D\u0627\u0641\u0638\u062A \u0627\u0632 \u062F\u0633\u062A\u0647 \u06F3 (\u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 \u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641):" }), " \u0627\u06AF\u0631 \u0627\u0632 \u062A\u0633\u062A\u200C\u0647\u0627\u06CC \u0642\u0628\u0644\u06CC \u06A9\u0627\u0631\u062A\u06CC \u0628\u062F\u0648\u0646 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u0628\u0647 \u0627\u0634\u062A\u0628\u0627\u0647 \u0648\u0627\u0631\u062F \u062F\u0633\u062A\u0647 \u06F3 \u0634\u062F\u0647 \u0627\u0633\u062A\u060C \u0628\u0627 \u06A9\u0644\u06CC\u06A9 \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u0631\u0648\u0628\u0647\u200C\u0631\u0648 \u0647\u0645 \u0627\u0632 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u067E\u0646\u0644 \u0648 \u0647\u0645 \u0627\u0632 \u0628\u062E\u0634 \u00AB\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641\u00BB \u0633\u0627\u06CC\u062A \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u0648 \u0628\u0647 \u062D\u0627\u0644\u062A \u0639\u0627\u062F\u06CC \u0628\u0631\u06AF\u0631\u062F\u0627\u0646\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F."] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary text-xs font-bold", disabled: pending, onClick: cleanupTimedSales, children: "\uD83E\uDDF9 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u0641\u0648\u0631\u06CC \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0627\u0634\u062A\u0628\u0627\u0647 \u062F\u0633\u062A\u0647 \u06F3 + \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628" }), cleanupMsg && (0, jsx_runtime_1.jsx)("div", { className: "w-full text-xs font-bold text-indigo-900", children: cleanupMsg })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-3 md:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-amber-200 bg-amber-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-amber-900", children: "\u06F1. \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (Flash Deal)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-200 text-amber-900", children: "\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" })] }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs leading-5 text-amber-800", children: "\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0631\u06CC\u0644 \u00AB\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627\u06CC \u0644\u062D\u0638\u0647\u200C\u0627\u06CC\u00BB \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC (`isFlashDeal = true`) \u0628\u0627 \u062A\u0645 \u0637\u0644\u0627\u06CC\u06CC-\u0642\u0631\u0645\u0632. \u0645\u0646\u0627\u0633\u0628 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0631\u062A\u0628\u0647 \u06F1 \u0645\u0634\u0647\u062F/\u062A\u0631\u0628 \u0628\u0627 \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u062C\u0630\u0627\u0628 (\u0633\u0642\u0641 \u0628\u0627\u0632\u0627\u0631 \u0628\u0647 \u06A9\u0641 \u0631\u0642\u0627\u0628\u062A\u06CC)." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-rose-200 bg-rose-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-rose-900", children: "\u06F2. \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (Special Offer)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-rose-200 text-rose-900", children: "\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" })] }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs leading-5 text-rose-800", children: "\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0628\u062E\u0634 \u00AB\u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632\u0647\u0627 / \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u00BB \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC (`isSpecialOffer = true`). \u0633\u0642\u0641 \u0642\u06CC\u0645\u062A \u0628\u0627\u0632\u0627\u0631 \u0631\u0627 \u062E\u0637 \u0632\u062F\u0647 \u0648 \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u0631\u0627 \u062F\u0642\u06CC\u0642 \u0631\u0648\u06CC \u06A9\u0641 \u0647\u062F\u0641 \u0627\u0639\u0645\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u062F." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-emerald-200 bg-emerald-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-emerald-900", children: "\u06F3. \u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-200 text-emerald-900", children: "\u067E\u0646\u0644 \u0645\u062F\u06CC\u0631\u06CC\u062A + \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627" })] }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1 text-xs leading-5 text-emerald-800", children: ["\u0645\u062F\u06CC\u0631\u06CC\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u06A9\u0645\u067E\u06CC\u0646\u200C\u0647\u0627\u06CC `Sale` \u062F\u0631 \u0628\u062E\u0634 \u00AB\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641\u00BB \u067E\u0646\u0644 \u0627\u062F\u0645\u06CC\u0646 \u0628\u0627 \u0642\u0627\u0628\u0644\u06CC\u062A \u0627\u0646\u062A\u062E\u0627\u0628 \u0646\u0627\u0645 \u062F\u0644\u062E\u0648\u0627\u0647\u060C \u062A\u0645 \u0631\u0646\u06AF\u06CC (`green-orange`, `gold-red`, `red-purple`) \u0648 \u062A\u06CC\u06A9 ", (0, jsx_runtime_1.jsx)("b", { children: "\u00AB\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u06CC \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC\u00BB" }), "."] })] })] }), drafts.map((d, i) => {
                const key = String(d.id ?? `new-${i}`);
                return ((0, jsx_runtime_1.jsxs)("div", { className: `card space-y-4 transition ${d.id ? "border-slate-200" : "border-2 border-dashed border-indigo-300 bg-indigo-50/20"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-base font-bold", children: d.id ? d.name : "➕ تعریف قانون و کمپین تخفیف جدید" }), (0, jsx_runtime_1.jsx)("span", { className: `badge border ${format_1.campaignColor[d.type] ?? "bg-slate-100"}`, children: format_1.campaignLabel[d.type] ?? d.type }), d.type === "timed_sale" && ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-slate-100 text-slate-700", children: ["\u062A\u0645: ", format_1.badgeThemeLabel[d.badgeTheme] ?? d.badgeTheme] })), d.showInFeatured && ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-indigo-100 text-indigo-800", children: "\u2605 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u06CC \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "text-xs text-slate-500", children: ["\u0628\u0627\u0632\u0647 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627: ", (0, jsx_runtime_1.jsxs)("b", { children: ["\u06A9\u0627\u0631\u062A #", d.cardRangeFrom] }), " \u062A\u0627 ", (0, jsx_runtime_1.jsxs)("b", { children: ["\u06A9\u0627\u0631\u062A #", d.cardRangeTo] }), d.maxCards > 0 ? ` (حداکثر ${d.maxCards} کارت)` : " (بدون محدودیت تعداد)"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6", children: [(0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u06A9\u0645\u067E\u06CC\u0646 / \u0628\u0631\u0686\u0633\u0628 \u0631\u0648\u06CC \u06A9\u0627\u0631\u062A \u0645\u062D\u0635\u0648\u0644" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: d.name, placeholder: "\u0645\u062B\u0644\u0627\u064B \u062C\u0634\u0646\u0648\u0627\u0631\u0647 \u0648\u06CC\u0698\u0647 \u0645\u0634\u0647\u062F \u06CC\u0627 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC", onChange: (e) => update(i, { name: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u0647\u062F\u0641 \u062F\u0631 sgeooole" }), (0, jsx_runtime_1.jsxs)("select", { className: "input font-medium", value: d.type, onChange: (e) => {
                                                const nextType = e.target.value;
                                                update(i, {
                                                    type: nextType,
                                                    badgeTheme: nextType === "flash"
                                                        ? "gold-red"
                                                        : nextType === "featured"
                                                            ? "red-purple"
                                                            : "green-orange",
                                                    showInFeatured: nextType !== "flash",
                                                });
                                            }, children: [(0, jsx_runtime_1.jsx)("option", { value: "flash", children: "\u06F1) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u2014 isFlashDeal)" }), (0, jsx_runtime_1.jsx)("option", { value: "featured", children: "\u06F2) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u2014 isSpecialOffer)" }), (0, jsx_runtime_1.jsx)("option", { value: "timed_sale", children: "\u06F3) \u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0628\u062E\u0634 \u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641 \u2014 Sale + \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0648\u0644\u0648\u06CC\u062A \u0628\u0631\u0631\u0633\u06CC (\u0639\u062F\u062F \u0628\u0627\u0644\u0627\u062A\u0631 = \u0627\u0648\u0644\u0648\u06CC\u062A \u0627\u0648\u0644)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.priority, onChange: (e) => update(i, { priority: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u062A \u062A\u0627\u06CC\u0645\u0631 \u06A9\u0645\u067E\u06CC\u0646 (\u0633\u0627\u0639\u062A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.durationHours, onChange: (e) => update(i, { durationHours: Number(e.target.value) }) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-slate-50/70 p-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-2 flex items-center justify-between", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-xs font-bold text-slate-700", children: "\uD83C\uDFAF \u0647\u062F\u0641\u200C\u06AF\u06CC\u0631\u06CC \u0631\u0646\u062C \u06A9\u0627\u0631\u062A\u200C\u0647\u0627 \u0648 \u0634\u0631\u0627\u06CC\u0637 \u0627\u0639\u0645\u0627\u0644 \u062A\u062E\u0641\u06CC\u0641 (\u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631 \u0628\u0647 \u06A9\u0641 \u0631\u0642\u0627\u0628\u062A\u06CC)" }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-slate-500", children: "\u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u06CC\u0646 \u06A9\u0645\u067E\u06CC\u0646 \u0631\u0627 \u062F\u0642\u06CC\u0642\u0627\u064B \u0631\u0648\u06CC \u06CC\u06A9 \u0628\u0627\u0632\u0647 \u0627\u0632 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0645\u062D\u0635\u0648\u0644 (\u0645\u062B\u0644\u0627\u064B \u06A9\u0627\u0631\u062A \u06F1 \u062A\u0627 \u06F5) \u0645\u062D\u062F\u0648\u062F \u06A9\u0646\u06CC\u062F" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0632 \u06A9\u0627\u0631\u062A \u0634\u0645\u0627\u0631\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: d.cardRangeFrom, onChange: (e) => update(i, { cardRangeFrom: Math.max(1, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0627 \u06A9\u0627\u0631\u062A \u0634\u0645\u0627\u0631\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: d.cardRangeTo, onChange: (e) => update(i, { cardRangeTo: Math.max(1, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u0642\u0641 \u062A\u0639\u062F\u0627\u062F \u06A9\u0627\u0631\u062A (\u06F0=\u0646\u0627\u0645\u062D\u062F\u0648\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 0, value: d.maxCards, onChange: (e) => update(i, { maxCards: Math.max(0, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u062A\u062E\u0641\u06CC\u0641 (\u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641) \u066A" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.minDiscountPct, onChange: (e) => update(i, { minDiscountPct: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u062A\u062E\u0641\u06CC\u0641 \u066A" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.maxDiscountPct, onChange: (e) => update(i, { maxDiscountPct: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u0642\u06CC\u0645\u062A \u06A9\u0641 (\u062A\u0648\u0645\u0627\u0646)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: 50000, value: d.minPriceToman, onChange: (e) => update(i, { minPriceToman: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u0642\u06CC\u0645\u062A \u06A9\u0641 (\u06F0=\u0646\u0627\u0645\u062D\u062F\u0648\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: 50000, value: d.maxPriceToman, onChange: (e) => update(i, { maxPriceToman: Number(e.target.value) }) })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0645 \u0631\u0646\u06AF\u06CC \u0646\u0634\u0627\u0646 \u062A\u062E\u0641\u06CC\u0641 \u0631\u0648\u06CC \u06A9\u0627\u0631\u062A" }), (0, jsx_runtime_1.jsxs)("select", { className: "input", value: d.badgeTheme, onChange: (e) => update(i, { badgeTheme: e.target.value }), children: [(0, jsx_runtime_1.jsx)("option", { value: "green-orange", children: "\u0633\u0628\u0632 - \u0646\u0627\u0631\u0646\u062C\u06CC (\u0641\u0631\u0648\u0634 \u0648\u06CC\u0698\u0647)" }), (0, jsx_runtime_1.jsx)("option", { value: "gold-red", children: "\u0637\u0644\u0627\u06CC\u06CC - \u0642\u0631\u0645\u0632 (\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "red-purple", children: "\u0642\u0631\u0645\u0632 - \u0628\u0646\u0641\u0634 (\u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062F\u0633\u062A\u0647\u200C\u0628\u0646\u062F\u06CC\u200C\u0647\u0627\u06CC \u0645\u062C\u0627\u0632 (\u06A9\u0627\u0645\u0627\u061B \u062E\u0627\u0644\u06CC=\u0647\u0645\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: d.categories, placeholder: "\u062F\u0648\u0631\u0628\u06CC\u0646 \u0645\u062F\u0627\u0631\u0628\u0633\u062A\u0647, \u062F\u0632\u062F\u06AF\u06CC\u0631", onChange: (e) => update(i, { categories: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u0627\u0639\u0627\u062A \u0641\u0639\u0627\u0644 (0-23\u061B \u062E\u0627\u0644\u06CC=\u0647\u0645\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.activeHours, onChange: (e) => update(i, { activeHours: e.target.value }), placeholder: "9,10,11,20,21,22" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0631\u0648\u0632\u0647\u0627\u06CC \u0641\u0639\u0627\u0644 (0=\u06CC\u06A9\u0634\u0646\u0628\u0647\u20266=\u0634\u0646\u0628\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.activeDays, onChange: (e) => update(i, { activeDays: e.target.value }), placeholder: "6,0,1,2,3" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "md:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u062E\u0627\u0635 (ID \u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0628\u0627 \u06A9\u0627\u0645\u0627\u061B \u062E\u0627\u0644\u06CC = \u0628\u0631 \u0627\u0633\u0627\u0633 \u0631\u0646\u062C \u06A9\u0627\u0631\u062A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.targetProductIds, onChange: (e) => update(i, { targetProductIds: e.target.value }), placeholder: "1, 2, 5, 12" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-3 pt-1", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-5 text-sm", children: [(0, jsx_runtime_1.jsxs)("label", { className: "flex items-center gap-2 font-medium", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: d.active, onChange: (e) => update(i, { active: e.target.checked }) }), "\u06A9\u0645\u067E\u06CC\u0646 \u0641\u0639\u0627\u0644 \u0628\u0627\u0634\u062F"] }), (0, jsx_runtime_1.jsxs)("label", { className: "flex items-center gap-2 font-medium text-indigo-800", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: d.showInFeatured, onChange: (e) => update(i, { showInFeatured: e.target.checked }) }), "\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0628\u062E\u0634 \u00AB\u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u00BB \u062F\u0631 \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u0633\u0627\u06CC\u062A (`showInFeatured`)"] }), (0, jsx_runtime_1.jsxs)("label", { className: "flex items-center gap-2 text-slate-700", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: d.onlyTopRanked, onChange: (e) => update(i, { onlyTopRanked: e.target.checked }) }), "\u0641\u0642\u0637 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u062F\u0627\u0631\u0627\u06CC \u0631\u062A\u0628\u0647 \u06F1 \u062A\u0627 \u06F3 \u062F\u0631 \u0645\u0634\u0647\u062F \u06CC\u0627 \u062A\u0631\u0628"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-primary", disabled: pending || !d.name, onClick: () => save(d, key), children: d.id ? "💾 ذخیره تنظیمات کمپین" : "➕ افزودن کمپین جدید" }), d.id && ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-secondary", disabled: pending, onClick: () => runOnCardRange(d, key), title: "\u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0628\u0627\u0632\u0627\u0631 \u062A\u0631\u0628 \u0648 \u0627\u0639\u0645\u0627\u0644 \u0641\u0648\u0631\u06CC \u0627\u06CC\u0646 \u06A9\u0645\u067E\u06CC\u0646 \u0631\u0648\u06CC \u0631\u0646\u062C \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0627\u0646\u062A\u062E\u0627\u0628\u06CC", children: ["\u26A1 \u0627\u0639\u0645\u0627\u0644 \u0641\u0648\u0631\u06CC \u0631\u0648\u06CC \u06A9\u0627\u0631\u062A #", d.cardRangeFrom, " \u062A\u0627 #", d.cardRangeTo] })), d.id && ((0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-danger", disabled: pending, onClick: () => remove(d.id), children: "\u062D\u0630\u0641" }))] })] }), runMsg[key] && ((0, jsx_runtime_1.jsx)("div", { className: "rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800", children: runMsg[key] }))] }, key));
            })] }));
}
