"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewClient = ReviewClient;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const format_1 = require("../lib/format");
const actions_1 = require("./actions");
const icons_1 = require("./icons");
const ui_1 = require("./ui");
function buildQuickPrices(item) {
    const seen = new Set();
    const out = [];
    const add = (label, raw) => {
        if (raw == null || !Number.isFinite(raw) || raw <= 0)
            return;
        const p = Math.round(raw);
        if (seen.has(p))
            return;
        seen.add(p);
        out.push({ label, price: p });
    };
    add("پیشنهاد بهینه موتور", item.finalPrice);
    add("میانه بازار ترب", item.marketMedian);
    if (item.alternative) {
        add(`سناریوی جایگزین (${Math.round(item.alternative.p * 100)}٪)`, item.alternative.finalPrice);
    }
    return out;
}
function ReviewClient({ pendingItems, rejectedItems, }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [tab, setTab] = (0, react_1.useState)("all_pending");
    const [query, setQuery] = (0, react_1.useState)("");
    const [selectedIds, setSelectedIds] = (0, react_1.useState)([]);
    const [bulkPending, startBulk] = (0, react_1.useTransition)();
    const [bulkProgress, setBulkProgress] = (0, react_1.useState)(null);
    const stats = (0, react_1.useMemo)(() => {
        const readyCount = pendingItems.filter((x) => x.readyForApproval && !x.syncFailed).length;
        const withConf = pendingItems.filter((x) => Number.isFinite(x.confidence));
        const avgConfPct = withConf.length
            ? Math.round((withConf.reduce((s, x) => s + x.confidence, 0) / withConf.length) * 100)
            : 0;
        const avgRiskPct = withConf.length
            ? Math.round(withConf.reduce((s, x) => s + x.errorRiskPct, 0) / withConf.length)
            : 0;
        return { readyCount, avgConfPct, avgRiskPct };
    }, [pendingItems]);
    const counts = (0, react_1.useMemo)(() => ({
        all_pending: pendingItems.length,
        ready: stats.readyCount,
        pending_review: pendingItems.filter((x) => x.status === "pending_review" && !x.syncFailed).length,
        sync_issues: pendingItems.filter((x) => x.syncFailed).length,
        warnings: pendingItems.filter((x) => x.marketConflict || x.isBelowFloor).length,
        rejected: rejectedItems.length,
    }), [pendingItems, rejectedItems, stats.readyCount]);
    const filteredPending = (0, react_1.useMemo)(() => {
        const q = query.trim().toLowerCase();
        return pendingItems.filter((item) => {
            if (tab === "ready" && (!item.readyForApproval || item.syncFailed))
                return false;
            if (tab === "pending_review" && (item.status !== "pending_review" || item.syncFailed))
                return false;
            if (tab === "sync_issues" && !item.syncFailed)
                return false;
            if (tab === "warnings" && !item.marketConflict && !item.isBelowFloor)
                return false;
            if (q && !item.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q))
                return false;
            return true;
        });
    }, [pendingItems, tab, query]);
    const filteredRejected = (0, react_1.useMemo)(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return rejectedItems;
        return rejectedItems.filter((item) => item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q));
    }, [rejectedItems, query]);
    const selectableIds = (0, react_1.useMemo)(() => filteredPending
        .filter((x) => !x.isBelowFloor && !x.syncFailed && (x.finalPrice ?? 0) > 0)
        .map((x) => x.id), [filteredPending]);
    const selectedSet = (0, react_1.useMemo)(() => new Set(selectedIds), [selectedIds]);
    const selectedVisibleIds = (0, react_1.useMemo)(() => selectableIds.filter((id) => selectedSet.has(id)), [selectableIds, selectedSet]);
    const toggleSelect = (id) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };
    const runBulkApprove = () => {
        const targets = selectedVisibleIds;
        if (!targets.length)
            return;
        startBulk(async () => {
            let okCount = 0;
            let errCount = 0;
            for (let i = 0; i < targets.length; i++) {
                setBulkProgress(`${i + 1}/${targets.length}`);
                const { ok } = await (0, actions_1.safeJsonFetch)(`/api/decisions/${targets[i]}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "approve", force: true }),
                });
                if (ok)
                    okCount++;
                else
                    errCount++;
            }
            setBulkProgress(null);
            setSelectedIds([]);
            if (errCount === 0)
                toast.success(`${(0, format_1.faNum)(okCount)} تصمیم با موفقیت تأیید و ارسال شد`);
            else
                toast.info(`${(0, format_1.faNum)(okCount)} تأیید شد · ${(0, format_1.faNum)(errCount)} مورد با خطا متوقف ماند`);
            router.refresh();
        });
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-5 sm:space-y-6", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("h1", { className: "text-lg font-extrabold text-slate-900 sm:text-2xl", children: "\u067E\u0646\u0644 \u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631\u06CC \u0622\u0645\u0627\u0631\u06CC \u0648 \u0646\u0638\u0627\u0631\u062A \u0627\u0646\u0633\u0627\u0646\u06CC" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs leading-5 text-slate-500 sm:text-sm", children: "\u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631\u06CC \u0628\u0627 \u0645\u062F\u0644 \u0627\u062D\u062A\u0645\u0627\u0644\u0627\u062A \u0628\u06CC\u0632\u06CC\u0646 (\u0633\u0648\u062F \u062E\u0627\u0644\u0635\u060C \u067E\u0631\u0627\u06A9\u0646\u062F\u06AF\u06CC \u0628\u0627\u0632\u0627\u0631 \u0648 \u0636\u0631\u06CC\u0628 \u062E\u0637\u0627) \u0645\u062D\u0627\u0633\u0628\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F\u061B \u0628\u062F\u0648\u0646 \u062A\u0623\u06CC\u06CC\u062F \u0634\u0645\u0627 \u0647\u06CC\u0686 \u0642\u06CC\u0645\u062A\u06CC \u0631\u0648\u06CC \u0633\u0627\u06CC\u062A \u0627\u0639\u0645\u0627\u0644 \u0646\u0645\u06CC\u200C\u0634\u0648\u062F." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2 shrink-0", children: [(0, jsx_runtime_1.jsx)(actions_1.RunButton, { label: "\uD83D\uDD0D \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u06F5 \u06A9\u0627\u0631\u062A \u0627\u0648\u0644", className: "btn-primary btn-sm" }), (0, jsx_runtime_1.jsxs)("div", { className: "relative w-full sm:w-56", children: [(0, jsx_runtime_1.jsx)(icons_1.IconSearch, { className: "pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" }), (0, jsx_runtime_1.jsx)("input", { className: "input pr-9 text-xs", placeholder: "\u062C\u0633\u062A\u062C\u0648 (\u0646\u0627\u0645 \u06CC\u0627 SKU)\u2026", value: query, onChange: (e) => setQuery(e.target.value) })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4", children: [(0, jsx_runtime_1.jsx)(StatTile, { label: "\u06A9\u0644 \u0635\u0641 \u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631\u06CC", value: (0, format_1.faNum)(pendingItems.length) }), (0, jsx_runtime_1.jsx)(StatTile, { label: "\u0622\u0645\u0627\u062F\u0647 \u062A\u0623\u06CC\u06CC\u062F \u06A9\u0645\u200C\u062E\u0637\u0627", value: (0, format_1.faNum)(stats.readyCount), tone: "emerald" }), (0, jsx_runtime_1.jsx)(StatTile, { label: "\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646 \u0627\u0639\u062A\u0645\u0627\u062F / \u0636\u0631\u06CC\u0628 \u062E\u0637\u0627", value: pendingItems.length ? `${(0, format_1.faNum)(stats.avgConfPct)}٪ / ${(0, format_1.faNum)(stats.avgRiskPct)}٪` : "—", tone: stats.avgRiskPct <= 25 ? "indigo" : "amber" }), (0, jsx_runtime_1.jsx)(StatTile, { label: "\u0631\u062F\u0634\u062F\u0647 (\u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u0628\u0631\u0631\u0633\u06CC \u0644\u06CC\u0646\u06A9/\u062F\u0627\u062F\u0647)", value: (0, format_1.faNum)(rejectedItems.length), tone: "rose" })] }), (0, jsx_runtime_1.jsx)(ui_1.SegmentedTabs, { value: tab, onChange: setTab, items: [
                    { key: "all_pending", label: "همه صف قیمت‌گذاری", count: counts.all_pending },
                    { key: "ready", label: "آماده تأیید سریع", count: counts.ready },
                    { key: "pending_review", label: "در انتظار بررسی", count: counts.pending_review },
                    { key: "sync_issues", label: "خطای همگام‌سازی", count: counts.sync_issues },
                    { key: "warnings", label: "تعارض / زیر کف", count: counts.warnings },
                    { key: "rejected", label: "ردشده‌های ناظر", count: counts.rejected },
                ] }), tab !== "rejected" && selectableIds.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2 text-xs text-indigo-950", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setSelectedIds(selectableIds), className: "btn-secondary btn-sm text-xs", disabled: bulkPending, children: ["\u0627\u0646\u062A\u062E\u0627\u0628 \u0647\u0645\u0647\u0654 \u0645\u0648\u0627\u0631\u062F \u0645\u062C\u0627\u0632 (", (0, format_1.faNum)(selectableIds.length), ")"] }), selectedVisibleIds.length > 0 && ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setSelectedIds([]), className: "text-xs font-medium text-slate-600 hover:underline", disabled: bulkPending, children: ["\u0644\u063A\u0648 \u0627\u0646\u062A\u062E\u0627\u0628 (", (0, format_1.faNum)(selectedVisibleIds.length), ")"] }))] }), selectedVisibleIds.length > 0 && ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: runBulkApprove, disabled: bulkPending, className: "btn-success btn-sm text-xs", children: bulkPending
                            ? `در حال تأیید ${bulkProgress ?? ""}…`
                            : `✅ تأیید گروهی ${(0, format_1.faNum)(selectedVisibleIds.length)} مورد انتخاب‌شده` }))] })), tab !== "rejected" ? ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4", children: [filteredPending.map((item) => {
                        const canBulkSelect = !item.isBelowFloor && !item.syncFailed && (item.finalPrice ?? 0) > 0;
                        const confPct = Math.round((item.confidence ?? 0) * 100);
                        const quickPrices = buildQuickPrices(item);
                        return ((0, jsx_runtime_1.jsxs)("div", { className: "card space-y-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [canBulkSelect && ((0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: selectedSet.has(item.id), onChange: () => toggleSelect(item.id), "aria-label": `انتخاب ${item.name}`, className: "h-4 w-4 rounded border-slate-300 text-indigo-600" })), (0, jsx_runtime_1.jsx)(link_1.default, { href: `/products/${item.productId}`, className: "text-base font-bold text-indigo-700 hover:underline sm:text-lg", children: item.name }), (0, jsx_runtime_1.jsx)("span", { className: `badge ${format_1.statusColor[item.status] ?? "bg-slate-100"}`, children: format_1.statusLabel[item.status] ?? item.status }), item.readyForApproval && !item.syncFailed && ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-emerald-100 text-emerald-800", children: "\u2705 \u0622\u0645\u0627\u062F\u0647 \u062A\u0623\u06CC\u06CC\u062F \u0633\u0631\u06CC\u0639" })), item.isBelowFloor && ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-rose-100 text-rose-800", children: "\u26A0\uFE0F \u0632\u06CC\u0631 \u06A9\u0641 \u0633\u0648\u062F" })), item.marketConflict && ((0, jsx_runtime_1.jsx)("span", { className: "badge bg-amber-100 text-amber-900", children: "\u062A\u0639\u0627\u0631\u0636 \u0628\u0627\u0632\u0627\u0631" })), item.supOverallPct != null && ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-slate-100 text-slate-700", children: ["\u0627\u0645\u062A\u06CC\u0627\u0632 \u06A9\u0644 \u0646\u0627\u0638\u0631: ", (0, format_1.faNum)(item.supOverallPct), "\u066A"] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400", children: [(0, jsx_runtime_1.jsxs)("span", { children: [item.sku, " \u00B7 \u062A\u0635\u0645\u06CC\u0645 #", (0, format_1.faNum)(item.id), " \u00B7 ", (0, format_1.faDate)(item.createdAt), " \u00B7 ", (0, format_1.faNum)(item.offersUsed), "/", (0, format_1.faNum)(item.offersTotal), " \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0645\u0639\u062A\u0628\u0631"] }), item.torobUrl && ((0, jsx_runtime_1.jsxs)("a", { href: item.torobUrl, target: "_blank", rel: "noreferrer", className: "font-medium text-sky-600 hover:underline", children: ["\uD83D\uDD17 \u0645\u0634\u0627\u0647\u062F\u0647 \u062F\u0631 \u062A\u0631\u0628", item.torobTitle ? ` (${item.torobTitle.slice(0, 48)}${item.torobTitle.length > 48 ? "…" : ""})` : ""] }))] })] }), (0, jsx_runtime_1.jsx)(actions_1.DecisionActions, { decisionId: item.id, force: true, isBelowFloor: item.isBelowFloor, syncFailed: item.syncFailed, initialFinalPrice: item.finalPrice, initialBasePrice: item.basePrice, initialDiscountPct: item.discountPct, initialCampaignType: item.campaignType, effectiveCost: item.effectiveCost, quickPrices: quickPrices })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 text-xs", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-bold text-indigo-950", children: "\uD83D\uDCCA \u062A\u062D\u0644\u06CC\u0644 \u0622\u0645\u0627\u0631\u06CC \u0648 \u0636\u0631\u06CC\u0628 \u062E\u0637\u0627:" }), (0, jsx_runtime_1.jsxs)("span", { className: `badge ${item.errorRiskPct <= 15
                                                                ? "bg-emerald-100 text-emerald-800"
                                                                : item.errorRiskPct <= 30
                                                                    ? "bg-amber-100 text-amber-900"
                                                                    : "bg-rose-100 text-rose-800"}`, children: ["\u0627\u0639\u062A\u0645\u0627\u062F: ", (0, format_1.faNum)(confPct), "\u066A \u00B7 \u0636\u0631\u06CC\u0628 \u062E\u0637\u0627\u06CC \u062A\u062E\u0645\u06CC\u0646\u06CC: ", (0, format_1.faNum)(item.errorRiskPct), "\u066A"] }), item.pRight != null && ((0, jsx_runtime_1.jsxs)("span", { className: "text-[11px] text-slate-600", children: ["\u0627\u062D\u062A\u0645\u0627\u0644 \u0635\u062D\u062A \u0642\u06CC\u0645\u062A: ", (0, jsx_runtime_1.jsxs)("strong", { className: "num", children: [(0, format_1.faNum)(Math.round(item.pRight * 100)), "\u066A"] })] })), item.pTooHigh != null && item.pTooLow != null && ((0, jsx_runtime_1.jsxs)("span", { className: "text-[11px] text-slate-600", children: ["(\u0631\u06CC\u0633\u06A9 \u06AF\u0631\u0627\u0646\u200C\u0628\u0648\u062F\u0646: ", (0, jsx_runtime_1.jsxs)("strong", { className: "num", children: [(0, format_1.faNum)(Math.round(item.pTooHigh * 100)), "\u066A"] }), " \u00B7 \u0631\u06CC\u0633\u06A9 \u0627\u0631\u0632\u0627\u0646\u200C\u0628\u0648\u062F\u0646:", " ", (0, jsx_runtime_1.jsxs)("strong", { className: "num", children: [(0, format_1.faNum)(Math.round(item.pTooLow * 100)), "\u066A"] }), ")"] }))] }), item.strategy && ((0, jsx_runtime_1.jsxs)("span", { className: "text-[11px] font-medium text-indigo-800", children: ["\u0627\u0633\u062A\u0631\u0627\u062A\u0698\u06CC: ", format_1.strategyLabel[item.strategy] ?? item.strategy] }))] }), (0, jsx_runtime_1.jsx)("div", { className: "h-1.5 w-full overflow-hidden rounded-full bg-slate-200", children: (0, jsx_runtime_1.jsx)("div", { className: `h-full rounded-full ${confPct >= 80 ? "bg-emerald-500" : confPct >= 60 ? "bg-amber-500" : "bg-rose-500"}`, style: { width: `${Math.max(4, Math.min(100, confPct))}%` } }) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600", children: [item.marketSigma != null && ((0, jsx_runtime_1.jsxs)("span", { children: ["\u067E\u0631\u0627\u06A9\u0646\u062F\u06AF\u06CC \u0628\u0627\u0632\u0627\u0631 (\u03C3):", " ", (0, jsx_runtime_1.jsxs)("strong", { className: "num text-slate-800", children: [(0, format_1.faNum)(item.marketSigma * 100, 1), "\u066A"] })] })), item.pAnchorOk != null && ((0, jsx_runtime_1.jsxs)("span", { children: ["\u0627\u0637\u0645\u06CC\u0646\u0627\u0646 \u0628\u0647 \u06A9\u0641 \u0628\u0627\u0632\u0627\u0631:", " ", (0, jsx_runtime_1.jsxs)("strong", { className: "num text-slate-800", children: [(0, format_1.faNum)(Math.round(item.pAnchorOk * 100)), "\u066A"] })] })), item.netProfitToman != null && item.effectiveCost > 0 && ((0, jsx_runtime_1.jsxs)("span", { children: ["\u0633\u0648\u062F \u062E\u0627\u0644\u0635 \u0631\u0648\u06CC \u0642\u06CC\u0645\u062A \u0647\u0645\u06A9\u0627\u0631:", " ", (0, jsx_runtime_1.jsxs)("strong", { className: `num ${item.netProfitToman > 0 ? "text-emerald-700" : "text-rose-700"}`, children: [(0, format_1.toman)(item.netProfitToman), item.netMarginPct != null ? ` (${(0, format_1.faNum)(item.netMarginPct, 1)}٪)` : ""] })] }))] }), item.alternative && ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg border border-indigo-200/80 bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-700", children: ["\uD83D\uDD04 ", (0, jsx_runtime_1.jsx)("strong", { children: "\u0633\u0646\u0627\u0631\u06CC\u0648\u06CC \u062C\u0627\u06CC\u06AF\u0632\u06CC\u0646 \u0627\u062D\u062A\u0645\u0627\u0644\u06CC:" }), " ", (0, jsx_runtime_1.jsx)("span", { className: "num font-semibold text-indigo-800", children: (0, format_1.toman)(item.alternative.finalPrice) }), " ", "(\u0627\u062D\u062A\u0645\u0627\u0644 ", (0, jsx_runtime_1.jsxs)("span", { className: "num", children: [(0, format_1.faNum)(Math.round(item.alternative.p * 100)), "\u066A"] }), " \u2014 \u0627\u06AF\u0631 \u06A9\u0641 \u0648\u0627\u0642\u0639\u06CC \u0645\u062A\u0639\u0644\u0642 \u0628\u0647 \u00AB", item.alternative.shopName, "\u00BB \u0628\u0627 ", (0, format_1.toman)(item.alternative.lowestPrice), " \u0628\u0627\u0634\u062F)"] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7", children: [(0, jsx_runtime_1.jsx)(Item, { k: "\u062A\u0645\u0627\u0645\u200C\u0634\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631", v: (0, format_1.toman)(item.effectiveCost || item.cost) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0642\u06CC\u0645\u062A \u0641\u0639\u0644\u06CC \u0633\u0627\u06CC\u062A", v: (0, format_1.toman)(item.current) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0645\u06CC\u0627\u0646\u0647 \u0628\u0627\u0632\u0627\u0631 \u062A\u0631\u0628", v: (0, format_1.toman)(item.marketMedian ?? item.referencePrice) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u062E\u0637\u200C\u062E\u0648\u0631\u062F\u0647 (\u0633\u0642\u0641)", v: (0, format_1.toman)(item.basePrice) }), (0, jsx_runtime_1.jsx)(Item, { k: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u06CC\u0648\u0632\u0631 (\u0646\u0647\u0627\u06CC\u06CC)", v: (0, format_1.toman)(item.finalPrice), strong: true }), (0, jsx_runtime_1.jsx)(Item, { k: "\u062A\u062E\u0641\u06CC\u0641 \u0646\u0645\u0627\u06CC\u0634\u06CC / \u06A9\u0645\u067E\u06CC\u0646", v: `${item.discountPct && item.discountPct > 0 ? (0, format_1.pct)(item.discountPct) : "بدون تخفیف"} · ${format_1.campaignLabel[item.campaignType ?? "none"] ?? item.campaignType ?? "عادی"}` }), (0, jsx_runtime_1.jsx)(Item, { k: "\u0631\u062A\u0628\u0647 \u0645\u0644\u06CC / \u0628\u0627 \u0645\u0634\u06A9\u0648\u06A9", v: `${item.projectedNationalRank != null ? `#${(0, format_1.faNum)(item.projectedNationalRank)}` : "—"} / ${item.rankIncludingSuspect != null ? `#${(0, format_1.faNum)(item.rankIncludingSuspect)}` : "—"} از ${item.totalIncludingSuspect ? (0, format_1.faNum)(item.totalIncludingSuspect) : "—"}` })] }), (0, jsx_runtime_1.jsx)(SupervisorGateChips, { gates: item.supGates }), item.competitors.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5", children: [(0, jsx_runtime_1.jsx)("div", { className: "mb-1.5 text-[11px] font-semibold text-slate-600", children: "\u0627\u0631\u0632\u0627\u0646\u200C\u062A\u0631\u06CC\u0646 \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u06A9\u0634\u0641\u200C\u0634\u062F\u0647 \u062F\u0631 \u062A\u0631\u0628 (\u0645\u0642\u0627\u06CC\u0633\u0647 \u0628\u0627 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u06CC\u0648\u0632\u0631):" }), (0, jsx_runtime_1.jsx)("div", { className: "grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3", children: item.competitors.map((c) => ((0, jsx_runtime_1.jsxs)("div", { className: `flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${c.included
                                                    ? "border-slate-200 bg-white text-slate-800"
                                                    : "border-amber-200 bg-amber-50/70 text-amber-900"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 truncate", children: [(0, jsx_runtime_1.jsx)("span", { className: "font-medium", children: c.shopName }), c.shopCity && ((0, jsx_runtime_1.jsxs)("span", { className: `mr-1 text-[10px] ${c.isLocalCity ? "font-bold text-indigo-700" : "text-slate-400"}`, children: ["(", c.shopCity, ")"] })), !c.included && c.excludeReason && ((0, jsx_runtime_1.jsxs)("div", { className: "truncate text-[10px] text-amber-700", children: ["\u062D\u0630\u0641: ", c.excludeReason] }))] }), (0, jsx_runtime_1.jsx)("div", { className: "num shrink-0 font-semibold", children: (0, format_1.toman)(c.price) })] }, c.id))) })] })), item.marketConflict && ((0, jsx_runtime_1.jsx)("p", { className: "rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-6 text-rose-800", children: "\u26A0\uFE0F \u062A\u0639\u0627\u0631\u0636 \u0628\u0627\u0632\u0627\u0631: \u0641\u0631\u0648\u0634\u0646\u062F\u0647\u200C\u06CC \u00AB\u0645\u0634\u06A9\u0648\u06A9 \u067E\u0627\u06CC\u06CC\u0646\u00BB \u0632\u06CC\u0631 \u0642\u06CC\u0645\u062A \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC \u0645\u0627 \u0647\u0633\u062A \u2014 \u067E\u06CC\u0634 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F\u060C \u0631\u062A\u0628\u0647\u200C\u06CC \u0633\u062A\u0648\u0646 \u00AB\u0628\u0627 \u0645\u0634\u06A9\u0648\u06A9\u00BB \u0631\u0627 \u0628\u0627 \u0631\u062A\u0628\u0647\u200C\u06CC \u0631\u0633\u0645\u06CC \u0645\u0642\u0627\u06CC\u0633\u0647 \u06A9\u0646\u06CC\u062F." })), item.liquidationMsg && ((0, jsx_runtime_1.jsxs)("p", { className: "rounded-xl border border-cyan-200 bg-cyan-50 px-3.5 py-2.5 text-xs leading-6 text-cyan-900", children: ["\uD83E\uDDEE \u0641\u06CC\u0644\u062A\u0631 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0645\u0646\u0641\u0631\u062F \u0646\u0642\u062F\u06A9\u0646\u0646\u062F\u0647 \u0627\u0646\u0628\u0627\u0631: ", item.liquidationMsg] })), item.aiIdentityMsg && ((0, jsx_runtime_1.jsxs)("p", { className: "rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-xs leading-6 text-violet-900", children: ["\uD83D\uDD0E \u062A\u0637\u0627\u0628\u0642 \u067E\u0646\u0644 \u062A\u0631\u0628 (AI): ", item.aiIdentityMsg] })), item.reasons && ((0, jsx_runtime_1.jsx)("p", { className: "rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-900 sm:text-sm", children: item.reasons })), item.supMsg && ((0, jsx_runtime_1.jsxs)("p", { className: "rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs leading-6 text-indigo-900", children: ["\uD83D\uDEE1\uFE0F \u0646\u0627\u0638\u0631: ", item.supMsg] })), item.aiMsg && ((0, jsx_runtime_1.jsxs)("p", { className: "rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs leading-6 text-slate-700", children: ["\uD83E\uDD16 \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06CC: ", item.aiMsg] }))] }, item.id));
                    }), filteredPending.length === 0 && ((0, jsx_runtime_1.jsx)(ui_1.EmptyState, { title: pendingItems.length === 0 ? "صف قیمت‌گذاری خالی است ✅" : "موردی مطابق فیلتر انتخاب‌شده یافت نشد", description: pendingItems.length === 0
                            ? "در حال حاضر همه تصمیم‌ها بررسی شده‌اند یا منتظر اجرای بعدی هستند."
                            : "فیلتر یا عبارت جستجو را تغییر دهید." })), tab === "all_pending" && rejectedItems.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: "pt-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-3 flex items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-base font-bold text-slate-900 sm:text-lg", children: "\u0631\u062F\u0634\u062F\u0647\u200C\u0647\u0627\u06CC \u0627\u062E\u06CC\u0631 \u0646\u0627\u0638\u0631 (\u0648\u0627\u0631\u062F \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0646\u0645\u06CC\u200C\u0634\u0648\u0646\u062F)" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-xs text-slate-500", children: "\u0627\u06CC\u0646 \u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627 \u0628\u0647\u200C\u062E\u0627\u0637\u0631 \u0627\u0645\u062A\u06CC\u0627\u0632 \u06A9\u0644 \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u0627\u0632 \u06F4\u06F5\u066A \u06CC\u0627 \u0631\u062F \u0634\u062F\u0646 \u062F\u0631 \u06CC\u06A9\u06CC \u0627\u0632 \u0645\u0642\u06CC\u0627\u0633\u200C\u0647\u0627\u06CC \u062D\u06CC\u0627\u062A\u06CC \u0645\u062A\u0648\u0642\u0641 \u0634\u062F\u0647\u200C\u0627\u0646\u062F\u061B \u0627\u0632 \u067E\u0627\u06CC\u06CC\u0646 \u06A9\u0627\u0631\u062A \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u067E\u0646\u0644 \u062A\u0631\u0628 \u0631\u0627 \u062A\u0623\u06CC\u06CC\u062F \u06CC\u0627 \u0627\u0635\u0644\u0627\u062D \u06A9\u0646\u06CC\u062F." })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setTab("rejected"), className: "btn-secondary btn-sm shrink-0", children: ["\u0645\u0634\u0627\u0647\u062F\u0647 \u0647\u0645\u0647 (", (0, format_1.faNum)(rejectedItems.length), ")"] })] }), (0, jsx_runtime_1.jsx)("div", { className: "space-y-2.5", children: filteredRejected.slice(0, 5).map((r) => ((0, jsx_runtime_1.jsx)(RejectedCard, { item: r }, r.id))) })] }))] })) : ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "text-base font-bold text-slate-900 sm:text-lg", children: "\u0631\u062F\u0634\u062F\u0647\u200C\u0647\u0627\u06CC \u0627\u062E\u06CC\u0631 \u0646\u0627\u0638\u0631 (\u0648\u0627\u0631\u062F \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0646\u0645\u06CC\u200C\u0634\u0648\u0646\u062F)" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-xs text-slate-500", children: "\u0627\u06CC\u0646 \u062A\u0635\u0645\u06CC\u0645\u200C\u0647\u0627 \u0628\u0647\u200C\u062E\u0627\u0637\u0631 \u0627\u0645\u062A\u06CC\u0627\u0632 \u06A9\u0644 \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u0627\u0632 \u06F4\u06F5\u066A \u06CC\u0627 \u0631\u062F \u0634\u062F\u0646 \u062F\u0631 \u06CC\u06A9\u06CC \u0627\u0632 \u0645\u0642\u06CC\u0627\u0633\u200C\u0647\u0627\u06CC \u062D\u06CC\u0627\u062A\u06CC \u0645\u062A\u0648\u0642\u0641 \u0634\u062F\u0647\u200C\u0627\u0646\u062F\u061B \u0627\u06AF\u0631 \u067E\u0646\u0644 \u062A\u0631\u0628 \u0627\u0646\u062A\u062E\u0627\u0628\u200C\u0634\u062F\u0647 \u0635\u062D\u06CC\u062D \u0627\u0633\u062A \u0628\u0627 \u06CC\u06A9 \u06A9\u0644\u06CC\u06A9 \u062A\u0623\u06CC\u06CC\u062F \u0648 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0645\u062C\u062F\u062F \u0628\u06AF\u06CC\u0631\u06CC\u062F \u06CC\u0627 \u0644\u06CC\u0646\u06A9 \u062F\u06CC\u06AF\u0631\u06CC \u062B\u0628\u062A \u06A9\u0646\u06CC\u062F." })] }), filteredRejected.map((r) => ((0, jsx_runtime_1.jsx)(RejectedCard, { item: r }, r.id))), filteredRejected.length === 0 && ((0, jsx_runtime_1.jsx)(ui_1.EmptyState, { title: "\u0645\u0648\u0631\u062F \u0631\u062F\u0634\u062F\u0647\u200C\u0627\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A" }))] }))] }));
}
function StatTile({ label, value, tone = "default", }) {
    const cls = tone === "emerald"
        ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
        : tone === "indigo"
            ? "border-indigo-200 bg-indigo-50/70 text-indigo-800"
            : tone === "amber"
                ? "border-amber-200 bg-amber-50/70 text-amber-800"
                : tone === "rose"
                    ? "border-rose-200 bg-rose-50/70 text-rose-800"
                    : "text-slate-900";
    return ((0, jsx_runtime_1.jsxs)("div", { className: `card ${cls}`, children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs text-slate-500", children: label }), (0, jsx_runtime_1.jsx)("div", { className: "num mt-1 text-lg font-extrabold sm:text-xl", children: value })] }));
}
function SupervisorGateChips({ gates }) {
    if (!gates.length)
        return null;
    return ((0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap gap-1.5", children: gates.map((g) => {
            const cls = g.verdict === "reject"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : g.verdict === "approve"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800";
            return ((0, jsx_runtime_1.jsxs)("span", { title: g.reason, className: `inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium ${cls}`, children: [(0, jsx_runtime_1.jsxs)("span", { children: [g.title || g.key, ":"] }), (0, jsx_runtime_1.jsxs)("strong", { className: "num", children: [(0, format_1.faNum)(g.scorePct), "\u066A"] }), (0, jsx_runtime_1.jsxs)("span", { children: ["(", g.verdict === "reject" ? "رد" : g.verdict === "approve" ? "تأیید" : "بازبینی", ")"] })] }, g.key || g.title));
        }) }));
}
function RejectedCard({ item }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "card border-rose-200", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)(link_1.default, { href: `/products/${item.productId}`, className: "font-bold text-rose-700 hover:underline", children: item.name }), item.supOverallPct != null && ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-rose-100 text-rose-800", children: ["\u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646 \u06A9\u0644: ", (0, format_1.faNum)(item.supOverallPct), "\u066A"] })), item.finalPrice != null && item.finalPrice > 0 && ((0, jsx_runtime_1.jsxs)("span", { className: "badge bg-slate-100 text-slate-700 num", children: ["\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0645\u0648\u0642\u062A: ", (0, format_1.toman)(item.finalPrice)] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400", children: [(0, jsx_runtime_1.jsxs)("span", { children: [item.sku, " \u00B7 \u062A\u0635\u0645\u06CC\u0645 #", (0, format_1.faNum)(item.id), " \u00B7 ", (0, format_1.faDate)(item.createdAt), " \u00B7 ", (0, format_1.faNum)(item.offersUsed), "/", (0, format_1.faNum)(item.offersTotal), " \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0645\u0639\u062A\u0628\u0631"] }), item.torobUrl && ((0, jsx_runtime_1.jsxs)("a", { href: item.torobUrl, target: "_blank", rel: "noreferrer", className: "text-sky-600 hover:underline", children: ["\uD83D\uDD17 \u067E\u0646\u0644 \u062A\u0631\u0628", item.torobTitle ? ` (${item.torobTitle.slice(0, 42)})` : ""] }))] })] }), (0, jsx_runtime_1.jsx)("span", { className: "badge bg-rose-100 text-rose-700", children: "\u26D4 \u0631\u062F\u0634\u062F\u0647 \u2014 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u0627\u0639\u0645\u0627\u0644" })] }), (0, jsx_runtime_1.jsx)("div", { className: "mt-2", children: (0, jsx_runtime_1.jsx)(SupervisorGateChips, { gates: item.supGates }) }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-800", children: item.supMsg }), (0, jsx_runtime_1.jsx)(actions_1.RelinkTorobAction, { decisionId: item.id, initialTorobUrl: item.torobUrl, canConfirmCurrent: Boolean(item.torobUrl) })] }));
}
function Item({ k, v, strong }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "rounded-xl border border-slate-100 bg-slate-50 px-3 py-2", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-[11px] text-slate-500", children: k }), (0, jsx_runtime_1.jsx)("div", { className: `num mt-0.5 break-words ${strong ? "font-bold text-emerald-700" : "font-medium text-slate-800"}`, children: v })] }));
}
