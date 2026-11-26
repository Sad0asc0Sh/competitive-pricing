"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignEditor = CampaignEditor;
const jsx_runtime_1 = require("react/jsx-runtime");
const format_1 = require("../lib/format");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const icons_1 = require("./icons");
const ui_1 = require("./ui");
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
    const toast = (0, ui_1.useToast)();
    const [prevCampaigns, setPrevCampaigns] = (0, react_1.useState)(campaigns);
    const [drafts, setDrafts] = (0, react_1.useState)(() => campaigns.map((c) => toDraft(c)));
    const [newDraft, setNewDraft] = (0, react_1.useState)(() => toDraft());
    const [newOpen, setNewOpen] = (0, react_1.useState)(false);
    const [expandedIds, setExpandedIds] = (0, react_1.useState)({});
    const [pending, start] = (0, react_1.useTransition)();
    const [runMsg, setRunMsg] = (0, react_1.useState)({});
    const [cleanupMsg, setCleanupMsg] = (0, react_1.useState)(null);
    const [cleanupConfirmOpen, setCleanupConfirmOpen] = (0, react_1.useState)(false);
    const [deleteTarget, setDeleteTarget] = (0, react_1.useState)(null);
    if (prevCampaigns !== campaigns) {
        setPrevCampaigns(campaigns);
        setDrafts(campaigns.map((c) => toDraft(c)));
    }
    const updateDraft = (i, patch) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const toggleExpand = (id) => setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
    const save = (d, key, onSuccess) => start(async () => {
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
            }
            else {
                const err = String(j.error ?? "خطا در ذخیره کمپین");
                setRunMsg((m) => ({ ...m, [key]: `❌ ${err}` }));
                toast.error(err);
            }
            router.refresh();
        }
        catch (e) {
            const msg = `خطا در ارتباط با سرور: ${e instanceof Error ? e.message : String(e)}`;
            setRunMsg((m) => ({ ...m, [key]: `❌ ${msg}` }));
            toast.error(msg);
        }
    });
    const toggleActiveQuick = (idx, nextActive) => {
        const updated = { ...drafts[idx], active: nextActive };
        updateDraft(idx, { active: nextActive });
        save(updated, String(updated.id ?? idx));
    };
    const confirmDelete = () => {
        if (!deleteTarget?.id)
            return;
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
                }
                else {
                    toast.error("خطا در حذف کمپین");
                }
            }
            catch {
                toast.error("خطا در ارتباط با سرور");
            }
        });
    };
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
            const text = res.ok
                ? `انجام شد: ${j.applied ?? 0} کارت اعمال شد | ${j.pendingReview ?? 0} در صف بازبینی | ${j.failed ?? 0} رد/خطا${errTail}`
                : String(j.error ?? "خطا در اجرا");
            setRunMsg((m) => ({ ...m, [key]: text }));
            if (res.ok)
                toast.success(text);
            else
                toast.error(text);
            router.refresh();
        }
        catch (e) {
            const text = `خطا در ارسال درخواست: ${e instanceof Error ? e.message : String(e)}`;
            setRunMsg((m) => ({ ...m, [key]: text }));
            toast.error(text);
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
            const text = String(j.message ?? j.error ?? "پاک‌سازی انجام شد");
            setCleanupMsg(text);
            if (res.ok)
                toast.success(text);
            else
                toast.error(text);
            setCleanupConfirmOpen(false);
            router.refresh();
        }
        catch (e) {
            const text = `خطا: ${e instanceof Error ? e.message : String(e)}`;
            setCleanupMsg(text);
            toast.error(text);
        }
    });
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4 sm:space-y-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "text-xs font-medium text-slate-500", children: [(0, jsx_runtime_1.jsx)("span", { className: "num font-bold text-slate-800", children: (0, format_1.faNum)(drafts.length) }), " \u06A9\u0645\u067E\u06CC\u0646 \u062B\u0628\u062A\u200C\u0634\u062F\u0647 \u00B7 \u0628\u0631\u0627\u06CC \u0648\u06CC\u0631\u0627\u06CC\u0634 \u062C\u0632\u0626\u06CC\u0627\u062A \u0631\u0648\u06CC \u0647\u0631 \u06A9\u0627\u0631\u062A \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F"] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary w-full sm:w-auto", onClick: () => {
                            setNewDraft(toDraft());
                            setNewOpen(true);
                        }, children: [(0, jsx_runtime_1.jsx)(icons_1.IconPlus, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u062A\u0639\u0631\u06CC\u0641 \u0642\u0627\u0646\u0648\u0646 \u0648 \u06A9\u0645\u067E\u06CC\u0646 \u062C\u062F\u06CC\u062F" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 sm:flex-row sm:items-center sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "text-xs leading-6 text-amber-950", children: [(0, jsx_runtime_1.jsx)("b", { children: "\uD83D\uDEE1\uFE0F \u0645\u062D\u0627\u0641\u0638\u062A \u0627\u0632 \u062F\u0633\u062A\u0647 \u06F3 (\u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 \u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641):" }), " \u0627\u06AF\u0631 \u0627\u0632 \u062A\u0633\u062A\u200C\u0647\u0627\u06CC \u0642\u0628\u0644\u06CC \u06A9\u0627\u0631\u062A\u06CC \u0628\u062F\u0648\u0646 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u0628\u0647 \u0627\u0634\u062A\u0628\u0627\u0647 \u0648\u0627\u0631\u062F \u062F\u0633\u062A\u0647 \u06F3 \u0634\u062F\u0647 \u0627\u0633\u062A\u060C \u0628\u0627 \u062F\u06A9\u0645\u0647 \u0631\u0648\u0628\u0647\u200C\u0631\u0648 \u0647\u0645 \u0627\u0632 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u067E\u0646\u0644 \u0648 \u0647\u0645 \u0627\u0632 \u0628\u062E\u0634 \u00AB\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641\u00BB \u0633\u0627\u06CC\u062A \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u0648 \u0628\u0647 \u062D\u0627\u0644\u062A \u0639\u0627\u062F\u06CC \u0628\u0631\u06AF\u0631\u062F\u0627\u0646\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F."] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary btn-sm shrink-0 font-bold", disabled: pending, onClick: () => setCleanupConfirmOpen(true), children: "\uD83E\uDDF9 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u062F\u0633\u062A\u0647 \u06F3 + \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628" })] }), cleanupMsg && ((0, jsx_runtime_1.jsx)("div", { className: "rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs font-bold text-indigo-900", children: cleanupMsg })), (0, jsx_runtime_1.jsx)(ui_1.CollapsibleSection, { title: "\u0631\u0627\u0647\u0646\u0645\u0627\u06CC \u06F3 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 sgeooole", subtitle: "\u062C\u0632\u0626\u06CC\u0627\u062A \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC\u060C \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 \u0648 \u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631", defaultOpen: false, children: (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-3 md:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-amber-200 bg-amber-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-1", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-amber-900", children: "\u06F1. \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (Flash Deal)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-200 text-amber-900", children: "\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" })] }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1.5 text-xs leading-5 text-amber-800", children: ["\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0631\u06CC\u0644 \u00AB\u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u0647\u0627\u06CC \u0644\u062D\u0638\u0647\u200C\u0627\u06CC\u00BB \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "isFlashDeal = true" }), ") \u0628\u0627 \u062A\u0645 \u0637\u0644\u0627\u06CC\u06CC-\u0642\u0631\u0645\u0632. \u0645\u0646\u0627\u0633\u0628 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0631\u062A\u0628\u0647 \u06F1 \u0645\u0634\u0647\u062F/\u062A\u0631\u0628 \u0628\u0627 \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u062C\u0630\u0627\u0628."] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-rose-200 bg-rose-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-1", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-rose-900", children: "\u06F2. \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (Special Offer)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-rose-200 text-rose-900", children: "\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" })] }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1.5 text-xs leading-5 text-rose-800", children: ["\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0628\u062E\u0634 \u00AB\u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632\u0647\u0627 / \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u00BB \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "isSpecialOffer = true" }), "). \u0633\u0642\u0641 \u0642\u06CC\u0645\u062A \u0628\u0627\u0632\u0627\u0631 \u0631\u0627 \u062E\u0637 \u0632\u062F\u0647 \u0648 \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u0631\u0627 \u062F\u0642\u06CC\u0642 \u0631\u0648\u06CC \u06A9\u0641 \u0647\u062F\u0641 \u0627\u0639\u0645\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u062F."] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-emerald-200 bg-emerald-50/70 p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-1", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-emerald-900", children: "\u06F3. \u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641)" }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-200 text-emerald-900", children: "\u067E\u0646\u0644 \u0645\u062F\u06CC\u0631\u06CC\u062A + \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627" })] }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1.5 text-xs leading-5 text-emerald-800", children: ["\u0645\u062F\u06CC\u0631\u06CC\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u06A9\u0645\u067E\u06CC\u0646\u200C\u0647\u0627\u06CC ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", children: "Sale" }), " \u062F\u0631 \u0628\u062E\u0634 \u00AB\u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641\u00BB \u067E\u0646\u0644 \u0627\u062F\u0645\u06CC\u0646 \u0628\u0627 \u0642\u0627\u0628\u0644\u06CC\u062A \u0627\u0646\u062A\u062E\u0627\u0628 \u0646\u0627\u0645 \u062F\u0644\u062E\u0648\u0627\u0647\u060C \u062A\u0645 \u0631\u0646\u06AF\u06CC \u0648 \u062A\u06CC\u06A9 \u00AB\u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u06CC \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC\u00BB."] })] })] }) }), drafts.length === 0 ? ((0, jsx_runtime_1.jsx)(ui_1.EmptyState, { title: "\u0647\u0646\u0648\u0632 \u06A9\u0645\u067E\u06CC\u0646\u06CC \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A", description: "\u06CC\u06A9 \u0642\u0627\u0646\u0648\u0646 \u0648 \u06A9\u0645\u067E\u06CC\u0646 \u062A\u062E\u0641\u06CC\u0641 \u062C\u062F\u06CC\u062F \u0628\u0633\u0627\u0632\u06CC\u062F \u062A\u0627 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627 \u062F\u0631 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0642\u0631\u0627\u0631 \u06AF\u06CC\u0631\u0646\u062F.", action: (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setNewOpen(true), className: "btn-primary btn-sm", children: [(0, jsx_runtime_1.jsx)(icons_1.IconPlus, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0627\u0641\u0632\u0648\u062F\u0646 \u0627\u0648\u0644\u06CC\u0646 \u06A9\u0645\u067E\u06CC\u0646" })] }) })) : ((0, jsx_runtime_1.jsx)("div", { className: "space-y-3.5", children: drafts.map((d, i) => {
                    const key = String(d.id ?? `row-${i}`);
                    const isExpanded = Boolean(d.id && expandedIds[d.id]);
                    return ((0, jsx_runtime_1.jsxs)("div", { className: `card space-y-3 transition ${d.active ? "border-indigo-200/90" : "border-slate-200 opacity-95"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 flex-1 space-y-1.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-base font-bold text-slate-900", children: d.name || "کمپین بدون نام" }), (0, jsx_runtime_1.jsx)("span", { className: `badge border text-[11px] ${format_1.campaignColor[d.type] ?? "bg-slate-100"}`, children: format_1.campaignShortLabel[d.type] ?? format_1.campaignLabel[d.type] ?? d.type }), d.type === "timed_sale" && ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-slate-100 text-[11px] text-slate-700", children: ["\u062A\u0645: ", format_1.badgeThemeLabel[d.badgeTheme] ?? d.badgeTheme] })), d.showInFeatured && ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-indigo-100 text-[11px] text-indigo-800", children: "\u2605 \u0645\u0646\u062A\u062E\u0628 \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC" }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "num flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500", children: [(0, jsx_runtime_1.jsxs)("span", { children: ["\u0628\u0627\u0632\u0647: ", (0, jsx_runtime_1.jsxs)("b", { children: ["\u06A9\u0627\u0631\u062A #", (0, format_1.faNum)(d.cardRangeFrom)] }), " \u062A\u0627 ", (0, jsx_runtime_1.jsxs)("b", { children: ["#", (0, format_1.faNum)(d.cardRangeTo)] })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u062A\u062E\u0641\u06CC\u0641: ", (0, jsx_runtime_1.jsxs)("b", { children: [(0, format_1.faNum)(d.minDiscountPct), "\u066A \u062A\u0627 ", (0, format_1.faNum)(d.maxDiscountPct), "\u066A"] })] }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u0627\u0648\u0644\u0648\u06CC\u062A: ", (0, jsx_runtime_1.jsx)("b", { children: (0, format_1.faNum)(d.priority) })] }), (0, jsx_runtime_1.jsx)("span", { children: d.maxCards > 0 ? `سقف ${(0, format_1.faNum)(d.maxCards)} کارت` : "بدون سقف تعداد" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5 sm:border-t-0 sm:pt-0", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5", children: [(0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: d.active, disabled: pending, onChange: (next) => toggleActiveQuick(i, next) }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs font-semibold text-slate-700", children: d.active ? "فعال" : "غیرفعال" })] }), d.id && ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-secondary btn-sm flex-1 sm:flex-initial", disabled: pending, onClick: () => runOnCardRange(d, key), children: ["\u26A1 \u0627\u0639\u0645\u0627\u0644 \u0631\u0648\u06CC #", (0, format_1.faNum)(d.cardRangeFrom), "\u2013#", (0, format_1.faNum)(d.cardRangeTo)] })), d.id && ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => toggleExpand(d.id), "aria-expanded": isExpanded, className: "btn-secondary btn-sm flex-1 sm:flex-initial", children: [(0, jsx_runtime_1.jsx)("span", { children: isExpanded ? "بستن ویرایش" : "ویرایش قوانین" }), (0, jsx_runtime_1.jsx)(icons_1.IconChevronDown, { className: `h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}` })] }))] })] }), runMsg[key] && ((0, jsx_runtime_1.jsx)("div", { className: "rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800", children: runMsg[key] })), isExpanded && ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4 border-t border-slate-100 pt-4", children: [(0, jsx_runtime_1.jsx)(CampaignFormFields, { draft: d, onChange: (patch) => updateDraft(i, patch) }), (0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3", children: (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2 w-full sm:w-auto", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary flex-1 sm:flex-initial", disabled: pending || !d.name, onClick: () => save(d, key), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\uD83D\uDCBE \u0630\u062E\u06CC\u0631\u0647 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u06A9\u0645\u067E\u06CC\u0646" })] }), d.id && ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-danger flex-1 sm:flex-initial", disabled: pending, onClick: () => setDeleteTarget(d), children: [(0, jsx_runtime_1.jsx)(icons_1.IconTrash, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u062D\u0630\u0641 \u06A9\u0645\u067E\u06CC\u0646" })] }))] }) })] }))] }, key));
                }) })), (0, jsx_runtime_1.jsx)(ui_1.ModalSheet, { open: newOpen, onClose: () => setNewOpen(false), title: "\u062A\u0639\u0631\u06CC\u0641 \u0642\u0627\u0646\u0648\u0646 \u0648 \u06A9\u0645\u067E\u06CC\u0646 \u062A\u062E\u0641\u06CC\u0641 \u062C\u062F\u06CC\u062F", subtitle: "\u0628\u0627\u0632\u0647 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u060C \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u0648 \u0646\u0648\u0639 \u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u0631\u0627 \u062A\u0646\u0638\u06CC\u0645 \u06A9\u0646\u06CC\u062F", maxWidth: "xl", children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsx)(CampaignFormFields, { draft: newDraft, onChange: (patch) => setNewDraft((prev) => ({ ...prev, ...patch })) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary", onClick: () => setNewOpen(false), children: "\u0627\u0646\u0635\u0631\u0627\u0641" }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary", disabled: pending || !newDraft.name.trim(), onClick: () => save(newDraft, "new", () => {
                                        setNewDraft(toDraft());
                                        setNewOpen(false);
                                    }), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u2795 \u0627\u0641\u0632\u0648\u062F\u0646 \u06A9\u0645\u067E\u06CC\u0646 \u062C\u062F\u06CC\u062F" })] })] })] }) }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: cleanupConfirmOpen, title: "\u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u062F\u0633\u062A\u0647 \u06F3 \u0648 \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628", description: "\u0622\u06CC\u0627 \u0627\u0632 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0627\u0634\u062A\u0628\u0627\u0647 \u062F\u0633\u062A\u0647 \u06F3 (\u0641\u0631\u0635\u062A\u200C\u0647\u0627\u06CC \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631) \u0648 \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628 \u0645\u0637\u0645\u0626\u0646 \u0647\u0633\u062A\u06CC\u062F\u061F", confirmLabel: "\u062A\u0623\u06CC\u06CC\u062F \u0648 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC", tone: "primary", busy: pending, onConfirm: cleanupTimedSales, onCancel: () => setCleanupConfirmOpen(false) }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: Boolean(deleteTarget), title: "\u062D\u0630\u0641 \u06A9\u0645\u067E\u06CC\u0646 \u062A\u062E\u0641\u06CC\u0641", description: `آیا از حذف کمپین «${deleteTarget?.name ?? ""}» مطمئن هستید؟`, confirmLabel: "\u0628\u0644\u0647\u060C \u062D\u0630\u0641 \u0634\u0648\u062F", tone: "danger", busy: pending, onConfirm: confirmDelete, onCancel: () => setDeleteTarget(null) })] }));
}
function CampaignFormFields({ draft: d, onChange, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0646\u0627\u0645 \u06A9\u0645\u067E\u06CC\u0646 / \u0628\u0631\u0686\u0633\u0628 \u0631\u0648\u06CC \u06A9\u0627\u0631\u062A \u0645\u062D\u0635\u0648\u0644 *" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: d.name, placeholder: "\u0645\u062B\u0644\u0627\u064B \u062C\u0634\u0646\u0648\u0627\u0631\u0647 \u0648\u06CC\u0698\u0647 \u0645\u0634\u0647\u062F \u06CC\u0627 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC", onChange: (e) => onChange({ name: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u06CC\u0633\u062A\u0645 \u062A\u062E\u0641\u06CC\u0641 \u0647\u062F\u0641 \u062F\u0631 sgeooole" }), (0, jsx_runtime_1.jsxs)("select", { className: "input font-medium", value: d.type, onChange: (e) => {
                                    const nextType = e.target.value;
                                    onChange({
                                        type: nextType,
                                        badgeTheme: nextType === "flash"
                                            ? "gold-red"
                                            : nextType === "featured"
                                                ? "red-purple"
                                                : "green-orange",
                                        showInFeatured: nextType !== "flash",
                                    });
                                }, children: [(0, jsx_runtime_1.jsx)("option", { value: "flash", children: "\u06F1) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u2014 isFlashDeal)" }), (0, jsx_runtime_1.jsx)("option", { value: "featured", children: "\u06F2) \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632 (\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u2014 isSpecialOffer)" }), (0, jsx_runtime_1.jsx)("option", { value: "timed_sale", children: "\u06F3) \u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631 (\u0628\u062E\u0634 \u0645\u0627\u0644\u06CC \u0648 \u062A\u062E\u0641\u06CC\u0641 \u2014 Sale + \u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0648\u0644\u0648\u06CC\u062A \u0628\u0631\u0631\u0633\u06CC (\u0639\u062F\u062F \u0628\u0627\u0644\u0627\u062A\u0631 = \u0627\u0648\u0644\u0648\u06CC\u062A \u0627\u0648\u0644)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.priority, onChange: (e) => onChange({ priority: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0645\u062F\u062A \u062A\u0627\u06CC\u0645\u0631 \u06A9\u0645\u067E\u06CC\u0646 (\u0633\u0627\u0639\u062A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.durationHours, onChange: (e) => onChange({ durationHours: Number(e.target.value) }) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200 bg-slate-50/70 p-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-3", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-slate-800", children: "\uD83C\uDFAF \u0647\u062F\u0641\u200C\u06AF\u06CC\u0631\u06CC \u0631\u0646\u062C \u06A9\u0627\u0631\u062A\u200C\u0647\u0627 \u0648 \u0634\u0631\u0627\u06CC\u0637 \u0627\u0639\u0645\u0627\u0644 \u062A\u062E\u0641\u06CC\u0641 (\u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631 \u0628\u0647 \u06A9\u0641 \u0631\u0642\u0627\u0628\u062A\u06CC)" }), (0, jsx_runtime_1.jsx)("div", { className: "mt-0.5 text-[11px] text-slate-500", children: "\u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u06CC\u0646 \u06A9\u0645\u067E\u06CC\u0646 \u0631\u0627 \u062F\u0642\u06CC\u0642\u0627\u064B \u0631\u0648\u06CC \u06CC\u06A9 \u0628\u0627\u0632\u0647 \u0627\u0632 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u0645\u062D\u0635\u0648\u0644 (\u0645\u062B\u0644\u0627\u064B \u06A9\u0627\u0631\u062A \u06F1 \u062A\u0627 \u06F5) \u0645\u062D\u062F\u0648\u062F \u06A9\u0646\u06CC\u062F" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0632 \u06A9\u0627\u0631\u062A \u0634\u0645\u0627\u0631\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: d.cardRangeFrom, onChange: (e) => onChange({ cardRangeFrom: Math.max(1, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0627 \u06A9\u0627\u0631\u062A \u0634\u0645\u0627\u0631\u0647" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: d.cardRangeTo, onChange: (e) => onChange({ cardRangeTo: Math.max(1, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u0642\u0641 \u062A\u0639\u062F\u0627\u062F \u06A9\u0627\u0631\u062A (\u06F0=\u0646\u0627\u0645\u062D\u062F\u0648\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 0, value: d.maxCards, onChange: (e) => onChange({ maxCards: Math.max(0, Number(e.target.value)) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u062A\u062E\u0641\u06CC\u0641 (\u0633\u0642\u0641 \u0628\u0647 \u06A9\u0641) \u066A" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.minDiscountPct, onChange: (e) => onChange({ minDiscountPct: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u062A\u062E\u0641\u06CC\u0641 \u066A" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", value: d.maxDiscountPct, onChange: (e) => onChange({ maxDiscountPct: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u0642\u0644 \u0642\u06CC\u0645\u062A \u06A9\u0641 (\u062A\u0648\u0645\u0627\u0646)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: 50000, value: d.minPriceToman, onChange: (e) => onChange({ minPriceToman: Number(e.target.value) }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "col-span-2 sm:col-span-1", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u0642\u06CC\u0645\u062A \u06A9\u0641 (\u06F0=\u0646\u0627\u0645\u062D\u062F\u0648\u062F)" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", step: 50000, value: d.maxPriceToman, onChange: (e) => onChange({ maxPriceToman: Number(e.target.value) }) })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0645 \u0631\u0646\u06AF\u06CC \u0646\u0634\u0627\u0646 \u062A\u062E\u0641\u06CC\u0641 \u0631\u0648\u06CC \u06A9\u0627\u0631\u062A" }), (0, jsx_runtime_1.jsxs)("select", { className: "input", value: d.badgeTheme, onChange: (e) => onChange({ badgeTheme: e.target.value }), children: [(0, jsx_runtime_1.jsx)("option", { value: "green-orange", children: "\u0633\u0628\u0632 - \u0646\u0627\u0631\u0646\u062C\u06CC (\u0641\u0631\u0648\u0634 \u0648\u06CC\u0698\u0647)" }), (0, jsx_runtime_1.jsx)("option", { value: "gold-red", children: "\u0637\u0644\u0627\u06CC\u06CC - \u0642\u0631\u0645\u0632 (\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC)" }), (0, jsx_runtime_1.jsx)("option", { value: "red-purple", children: "\u0642\u0631\u0645\u0632 - \u0628\u0646\u0641\u0634 (\u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062F\u0633\u062A\u0647\u200C\u0628\u0646\u062F\u06CC\u200C\u0647\u0627\u06CC \u0645\u062C\u0627\u0632 (\u06A9\u0627\u0645\u0627\u061B \u062E\u0627\u0644\u06CC=\u0647\u0645\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", value: d.categories, placeholder: "\u062F\u0648\u0631\u0628\u06CC\u0646 \u0645\u062F\u0627\u0631\u0628\u0633\u062A\u0647, \u062F\u0632\u062F\u06AF\u06CC\u0631", onChange: (e) => onChange({ categories: e.target.value }) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0633\u0627\u0639\u0627\u062A \u0641\u0639\u0627\u0644 (0-23\u061B \u062E\u0627\u0644\u06CC=\u0647\u0645\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.activeHours, onChange: (e) => onChange({ activeHours: e.target.value }), placeholder: "9,10,11,20,21,22" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0631\u0648\u0632\u0647\u0627\u06CC \u0641\u0639\u0627\u0644 (0=\u06CC\u06A9\u0634\u0646\u0628\u0647\u20266=\u0634\u0646\u0628\u0647)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.activeDays, onChange: (e) => onChange({ activeDays: e.target.value }), placeholder: "6,0,1,2,3" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "sm:col-span-2", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC \u062E\u0627\u0635 (ID \u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0628\u0627 \u06A9\u0627\u0645\u0627\u061B \u062E\u0627\u0644\u06CC = \u0628\u0631 \u0627\u0633\u0627\u0633 \u0631\u0646\u062C \u06A9\u0627\u0631\u062A)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", dir: "ltr", value: d.targetProductIds, onChange: (e) => onChange({ targetProductIds: e.target.value }), placeholder: "1, 2, 5, 12" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3.5 md:grid-cols-3", children: [(0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: d.active, onChange: (next) => onChange({ active: next }), label: "\u06A9\u0645\u067E\u06CC\u0646 \u0641\u0639\u0627\u0644 \u0628\u0627\u0634\u062F" }), (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: d.showInFeatured, onChange: (next) => onChange({ showInFeatured: next }), label: "\u2605 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0631 \u00AB\u0645\u0646\u062A\u062E\u0628\u200C\u0647\u0627\u00BB", description: "\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u0633\u0627\u06CC\u062A (showInFeatured)" }), (0, jsx_runtime_1.jsx)(ui_1.Switch, { checked: d.onlyTopRanked, onChange: (next) => onChange({ onlyTopRanked: next }), label: "\u0641\u0642\u0637 \u0631\u062A\u0628\u0647\u200C\u0647\u0627\u06CC \u06F1 \u062A\u0627 \u06F3", description: "\u062F\u0631 \u0645\u0634\u0647\u062F \u06CC\u0627 \u06A9\u0644 \u062A\u0631\u0628" })] })] }));
}
