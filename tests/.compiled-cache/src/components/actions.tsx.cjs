"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeJsonFetch = safeJsonFetch;
exports.RunButton = RunButton;
exports.CardRangeRunner = CardRangeRunner;
exports.DecisionActions = DecisionActions;
exports.RelinkTorobAction = RelinkTorobAction;
exports.ProductStatusToggle = ProductStatusToggle;
exports.DeleteProductButton = DeleteProductButton;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const icons_1 = require("./icons");
const ui_1 = require("./ui");
async function safeJsonFetch(url, init) {
    try {
        const res = await fetch(url, init);
        if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
            return { ok: false, status: 401, data: { error: "نشست شما منقضی شده است — در حال انتقال به صفحه ورود…" } };
        }
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            data = { error: text ? text.slice(0, 180) : `پاسخ نامعتبر سرور (HTTP ${res.status})` };
        }
        return { ok: res.ok, status: res.status, data };
    }
    catch (e) {
        return {
            ok: false,
            status: 0,
            data: { error: `خطا در ارسال درخواست به سرور: ${e instanceof Error ? e.message : String(e)}` },
        };
    }
}
function RunButton({ productIds, cardRangeFrom, cardRangeTo, label = "اجرای استعلام", className = "btn-primary", onDone, }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    return ((0, jsx_runtime_1.jsxs)("span", { className: "inline-flex max-w-full flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: className, disabled: pending, onClick: () => start(async () => {
                    setMsg(null);
                    // برای جلوگیری از تایم‌اوت مرورگر، اگر دکمه کلی زده شد و هیچ رنجی مشخص نبود، ۵ کارت اول استعلام می‌شود
                    const bodyPayload = !productIds?.length && cardRangeFrom == null && cardRangeTo == null
                        ? { cardRangeFrom: 1, cardRangeTo: 5 }
                        : { productIds, cardRangeFrom, cardRangeTo };
                    const { ok, data } = await safeJsonFetch("/api/runs", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(bodyPayload),
                    });
                    if (ok) {
                        const runId = typeof data.runId === "number" ? data.runId : undefined;
                        const applied = Number(data.applied ?? 0);
                        const pendingReview = Number(data.pendingReview ?? 0);
                        const failed = Number(data.failed ?? 0);
                        const total = Number(data.total ?? 0);
                        const skippedLocked = Number(data.skippedLocked ?? 0);
                        const lastErr = typeof data.lastError === "string" && data.lastError ? ` — علت: ${data.lastError}` : "";
                        const lockNote = skippedLocked > 0 ? ` | ردشده (قفل): ${skippedLocked}` : "";
                        const text = `اعمال: ${applied} | بازبینی: ${pendingReview} | رد/خطا: ${failed}${lockNote}${lastErr}`;
                        const isSuccess = total > 0 &&
                            (failed === 0 || applied + pendingReview > 0) &&
                            !(skippedLocked > 0 && applied + pendingReview + failed === 0);
                        setMsg({ ok: isSuccess, text, runId });
                        if (isSuccess)
                            toast.success(text);
                        else
                            toast.error(text);
                        onDone?.();
                    }
                    else {
                        const errText = String(data.error ?? "خطا در اجرای استعلام");
                        setMsg({ ok: false, text: errText });
                        toast.error(errText);
                    }
                    router.refresh();
                }), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4 shrink-0" }), (0, jsx_runtime_1.jsx)("span", { children: pending ? "در حال استعلام…" : label })] }), msg && ((0, jsx_runtime_1.jsxs)("span", { className: `text-xs font-medium break-words ${msg.ok ? "text-emerald-700" : "text-rose-700"}`, children: [msg.text, msg.runId && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [" · ", (0, jsx_runtime_1.jsx)(link_1.default, { href: `/runs?run=${msg.runId}`, className: "underline hover:opacity-80", children: "\u0646\u062A\u0627\u06CC\u062C \u0648 \u0644\u06CC\u0646\u06A9 \u067E\u0646\u0644\u200C\u0647\u0627\u06CC \u062A\u0631\u0628 \u2190" })] }))] }))] }));
}
/**
 * نوار ابزار اجرای هوشمند روی یک رنج دلخواه از کارت‌ها + دکمه پاک‌سازی فوری دسته ۳ و ریست قفل ترب
 */
function CardRangeRunner({ totalCards, defaultCollapsedOnMobile = false, }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [fromCard, setFromCard] = (0, react_1.useState)(1);
    const [toCard, setToCard] = (0, react_1.useState)(Math.max(1, Math.min(3, totalCards || 3)));
    const [category, setCategory] = (0, react_1.useState)("");
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    const [mobileOpen, setMobileOpen] = (0, react_1.useState)(!defaultCollapsedOnMobile);
    const [cleanupConfirmOpen, setCleanupConfirmOpen] = (0, react_1.useState)(false);
    const presets = [
        [1, 3],
        [1, 5],
        [6, 10],
        [11, 15],
    ];
    const runCleanup = () => start(async () => {
        setMsg(null);
        const { ok, data } = await safeJsonFetch("/api/campaigns/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const text = String(data.message ?? data.error ?? "پاک‌سازی انجام شد");
        setMsg({ ok, text });
        if (ok)
            toast.success(text);
        else
            toast.error(text);
        setCleanupConfirmOpen(false);
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("div", { className: "rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-3.5 sm:p-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-indigo-950 sm:text-sm", children: "\uD83C\uDFAF \u0627\u062C\u0631\u0627\u06CC \u0647\u062F\u0641\u0645\u0646\u062F \u06A9\u0641 \u0648 \u0633\u0642\u0641 + \u062A\u062E\u0641\u06CC\u0641 \u0631\u0648\u06CC \u0631\u0646\u062C\u06CC \u0627\u0632 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627" }), (0, jsx_runtime_1.jsx)("div", { className: "mt-0.5 text-[11px] leading-5 text-slate-600 sm:text-xs", children: "\u0628\u0631\u0627\u06CC \u062C\u0644\u0648\u06AF\u06CC\u0631\u06CC \u0627\u0632 \u0686\u0627\u0644\u0634 \u06A9\u067E\u0686\u0627\u06CC \u062A\u0631\u0628 (HTTP 490)\u060C \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0631\u0627 \u062F\u0631 \u062F\u0633\u062A\u0647\u200C\u0647\u0627\u06CC \u06F3 \u062A\u0627 \u06F5 \u06A9\u0627\u0631\u062A\u06CC \u0627\u062C\u0631\u0627 \u06A9\u0646\u06CC\u062F" })] }), defaultCollapsedOnMobile && ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setMobileOpen((o) => !o), "aria-expanded": mobileOpen, className: "btn-secondary btn-sm md:hidden", children: [(0, jsx_runtime_1.jsx)(icons_1.IconSliders, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: mobileOpen ? "بستن ابزار" : "تنظیم و اجرا" }), (0, jsx_runtime_1.jsx)(icons_1.IconChevronDown, { className: `h-3.5 w-3.5 transition-transform ${mobileOpen ? "rotate-180" : ""}` })] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: `mt-3 space-y-3 ${mobileOpen ? "block" : "hidden md:block"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5", children: [(0, jsx_runtime_1.jsx)("span", { className: "shrink-0 text-[11px] font-medium text-slate-500", children: "\u0631\u0646\u062C \u0633\u0631\u06CC\u0639:" }), presets.map(([f, t]) => {
                                        const clampedTo = totalCards > 0 ? Math.min(t, totalCards) : t;
                                        if (totalCards > 0 && f > totalCards)
                                            return null;
                                        const isCurrent = fromCard === f && toCard === clampedTo;
                                        return ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => {
                                                setFromCard(f);
                                                setToCard(clampedTo);
                                            }, className: `chip num min-h-8 text-[11px] ${isCurrent ? "chip-active" : ""}`, children: ["\u06A9\u0627\u0631\u062A #", f.toLocaleString("fa-IR"), " \u062A\u0627 #", clampedTo.toLocaleString("fa-IR")] }, `${f}-${t}`));
                                    })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-[110px_110px_minmax(150px,1fr)_auto_auto] lg:items-end", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0632 \u06A9\u0627\u0631\u062A #" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: fromCard, onChange: (e) => setFromCard(Math.max(1, Number(e.target.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0627 \u06A9\u0627\u0631\u062A #" }), (0, jsx_runtime_1.jsx)("input", { className: "input num", type: "number", min: 1, value: toCard, onChange: (e) => setToCard(Math.max(1, Number(e.target.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "col-span-2 sm:col-span-2 lg:col-span-1", children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0641\u06CC\u0644\u062A\u0631 \u062F\u0633\u062A\u0647 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC)" }), (0, jsx_runtime_1.jsx)("input", { className: "input", placeholder: "\u0647\u0645\u0647 \u062F\u0633\u062A\u0647\u200C\u0647\u0627", value: category, onChange: (e) => setCategory(e.target.value) })] }), (0, jsx_runtime_1.jsx)("div", { className: "col-span-2 sm:col-span-2 lg:col-span-1", children: (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary w-full", disabled: pending, onClick: () => start(async () => {
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
                                                    const runId = typeof data.runId === "number" ? data.runId : undefined;
                                                    const applied = Number(data.applied ?? 0);
                                                    const pendingReview = Number(data.pendingReview ?? 0);
                                                    const failed = Number(data.failed ?? 0);
                                                    const total = Number(data.total ?? 0);
                                                    const skippedLocked = Number(data.skippedLocked ?? 0);
                                                    const lastErr = typeof data.lastError === "string" && data.lastError ? ` — علت خطا: ${data.lastError}` : "";
                                                    const lockNote = skippedLocked > 0 ? ` | ردشده (قفل): ${skippedLocked}` : "";
                                                    const text = `کارت #${fromCard} تا #${toCard} بررسی شد → اعمال: ${applied} | صف بازبینی: ${pendingReview} | رد/خطا: ${failed}${lockNote}${lastErr}`;
                                                    const isOk = total > 0 &&
                                                        (failed === 0 || applied + pendingReview > 0) &&
                                                        !(skippedLocked > 0 && applied + pendingReview + failed === 0);
                                                    setMsg({ ok: isOk, text, runId });
                                                    if (isOk)
                                                        toast.success(text);
                                                    else
                                                        toast.error(text);
                                                }
                                                else {
                                                    const errText = String(data.error ?? "خطا در اجرای رنج کارت‌ها");
                                                    setMsg({ ok: false, text: errText });
                                                    toast.error(errText);
                                                }
                                                router.refresh();
                                            }), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4 shrink-0" }), (0, jsx_runtime_1.jsx)("span", { children: pending ? "در حال اجرا…" : `🔍 استعلام و پیشنهاد کارت #${fromCard} تا #${toCard}` })] }) }), (0, jsx_runtime_1.jsx)("div", { className: "col-span-2 sm:col-span-2 lg:col-span-1", children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary w-full text-xs", disabled: pending, onClick: () => setCleanupConfirmOpen(true), children: "\uD83E\uDDF9 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u062F\u0633\u062A\u0647 \u06F3 + \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628" }) })] }), msg && ((0, jsx_runtime_1.jsxs)("div", { className: `rounded-xl border px-3 py-2 text-xs font-medium break-words ${msg.ok
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                    : "border-rose-300 bg-rose-50 text-rose-900"}`, children: [(0, jsx_runtime_1.jsx)("span", { children: msg.text }), msg.runId && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [" · ", (0, jsx_runtime_1.jsxs)(link_1.default, { href: `/runs?run=${msg.runId}`, className: "underline hover:opacity-80", children: ["\u0645\u0634\u0627\u0647\u062F\u0647 \u062C\u0632\u0626\u06CC\u0627\u062A \u0627\u062C\u0631\u0627 #", msg.runId.toLocaleString("fa-IR"), " \u2190"] })] }))] }))] })] }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: cleanupConfirmOpen, title: "\u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u062F\u0633\u062A\u0647 \u06F3 \u0648 \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628", description: "\u06A9\u0627\u0631\u062A\u200C\u0647\u0627\u06CC\u06CC \u06A9\u0647 \u0628\u062F\u0648\u0646 \u0642\u06CC\u0645\u062A \u062E\u0631\u06CC\u062F \u0628\u0647 \u0627\u0634\u062A\u0628\u0627\u0647 \u0648\u0627\u0631\u062F \u062F\u0633\u062A\u0647 \u06F3 (\u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631) \u0634\u062F\u0647\u200C\u0627\u0646\u062F \u0627\u0632 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0648 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647 \u0628\u0627\u0632\u06AF\u0631\u062F\u0627\u0646\u06CC \u0634\u062F\u0647 \u0648 \u0642\u0641\u0644 \u0645\u0648\u0642\u062A \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u062A\u0631\u0628 \u0631\u06CC\u0633\u062A \u0645\u06CC\u200C\u0634\u0648\u062F. \u0627\u062F\u0627\u0645\u0647 \u0645\u06CC\u200C\u062F\u0647\u06CC\u062F\u061F", confirmLabel: "\u062A\u0623\u06CC\u06CC\u062F \u0648 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC", tone: "primary", busy: pending, onConfirm: runCleanup, onCancel: () => setCleanupConfirmOpen(false) })] }));
}
function DecisionActions({ decisionId, id, force = false, isBelowFloor = false, syncFailed = false, initialFinalPrice, initialBasePrice, initialDiscountPct, initialCampaignType, effectiveCost, hardFloor, quickPrices, }) {
    const targetId = decisionId ?? id ?? 0;
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    const [showEditPanel, setShowEditPanel] = (0, react_1.useState)(false);
    const [editFinalPrice, setEditFinalPrice] = (0, react_1.useState)(initialFinalPrice && initialFinalPrice > 0 ? String(Math.round(initialFinalPrice)) : "");
    const [useDiscount, setUseDiscount] = (0, react_1.useState)(Boolean((initialDiscountPct ?? 0) > 0 && (initialBasePrice ?? 0) > (initialFinalPrice ?? 0)));
    const [editDiscountPct, setEditDiscountPct] = (0, react_1.useState)(initialDiscountPct && initialDiscountPct > 0 ? String(Math.round(initialDiscountPct)) : "10");
    const [editCampaignType, setEditCampaignType] = (0, react_1.useState)(initialCampaignType ?? "none");
    const parsedFinal = Math.round(Number(editFinalPrice) || 0);
    const parsedPct = useDiscount ? Math.max(1, Math.min(60, Math.round(Number(editDiscountPct) || 0))) : 0;
    const previewBasePrice = useDiscount && parsedFinal > 0 && parsedPct > 0
        ? Math.round(parsedFinal / (1 - parsedPct / 100))
        : parsedFinal;
    const previewProfit = effectiveCost && effectiveCost > 0 && parsedFinal > 0 ? parsedFinal - effectiveCost : null;
    const effectiveBelowFloor = showEditPanel
        ? !parsedFinal || !effectiveCost || parsedFinal <= effectiveCost || parsedFinal < (hardFloor ?? 0)
        : isBelowFloor;
    const act = (action) => {
        if (action !== "reject" && effectiveBelowFloor)
            return;
        const editPayload = action === "approve" && showEditPanel && parsedFinal > 0
            ? {
                finalPrice: parsedFinal,
                useDisplayDiscount: useDiscount,
                discountPct: useDiscount ? parsedPct : 0,
                campaignType: useDiscount ? editCampaignType : "none",
            }
            : {};
        start(async () => {
            setMsg(null);
            const { ok, data } = await safeJsonFetch(`/api/decisions/${targetId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    force,
                    ...editPayload,
                }),
            });
            if (ok)
                setShowEditPanel(false);
            const text = String(data.message ?? (ok ? "انجام شد" : data.error ?? "خطا"));
            setMsg({ ok, text });
            if (ok)
                toast.success(text);
            else
                toast.error(text);
            router.refresh();
        });
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [syncFailed ? ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary flex-1 text-xs sm:flex-initial", disabled: pending || effectiveBelowFloor, onClick: () => act("retry_sync"), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: "\uD83D\uDD04 \u062A\u0644\u0627\u0634 \u0645\u062C\u062F\u062F \u0627\u0631\u0633\u0627\u0644 \u0628\u0647 \u0641\u0631\u0648\u0634\u06AF\u0627\u0647" })] })) : ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: `flex-1 sm:flex-initial ${effectiveBelowFloor ? "btn-danger text-xs" : "btn-success"}`, disabled: pending || effectiveBelowFloor, onClick: () => act("approve"), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: effectiveBelowFloor
                                    ? "قیمت نیاز به اصلاح دارد"
                                    : showEditPanel
                                        ? "✅ ذخیره تغییرات و تأیید"
                                        : "تأیید و اعمال" })] })), !syncFailed && ((0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary flex-1 text-xs sm:flex-initial", disabled: pending, onClick: () => setShowEditPanel((s) => !s), children: "\u270F\uFE0F \u0648\u06CC\u0631\u0627\u06CC\u0634 \u0642\u06CC\u0645\u062A \u0648 \u062A\u062E\u0641\u06CC\u0641" })), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary flex-1 sm:flex-initial", disabled: pending, onClick: () => act("reject"), children: "\u0631\u062F" })] }), msg && ((0, jsx_runtime_1.jsx)("span", { className: `text-xs font-medium break-words ${msg.ok ? "text-emerald-700" : "text-rose-700"}`, children: msg.text })), showEditPanel && !syncFailed && ((0, jsx_runtime_1.jsxs)("div", { className: "w-full space-y-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-right sm:w-96", children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-indigo-900", children: "\u270F\uFE0F \u0648\u06CC\u0631\u0627\u06CC\u0634 \u062F\u0633\u062A\u06CC \u0642\u06CC\u0645\u062A \u06CC\u0648\u0632\u0631 \u0648 \u062A\u062E\u0641\u06CC\u0641 \u0646\u0645\u0627\u06CC\u0634\u06CC \u067E\u06CC\u0634 \u0627\u0632 \u0627\u0631\u0633\u0627\u0644 \u0628\u0647 \u0633\u0627\u06CC\u062A" }), quickPrices && quickPrices.length > 0 && ((0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap gap-1.5", children: quickPrices.map((qp) => ((0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setEditFinalPrice(String(Math.round(qp.price))), className: `rounded-lg border px-2 py-1 text-[11px] font-medium transition ${parsedFinal === Math.round(qp.price)
                                ? "border-indigo-500 bg-indigo-600 text-white"
                                : "border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-100"}`, children: [qp.label, ": ", Math.round(qp.price).toLocaleString("fa-IR")] }, `${qp.label}-${qp.price}`))) })), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px]", children: "\u0642\u06CC\u0645\u062A \u0646\u0647\u0627\u06CC\u06CC \u0641\u0631\u0648\u0634 \u0628\u0647 \u06CC\u0648\u0632\u0631 (\u062A\u0648\u0645\u0627\u0646)" }), (0, jsx_runtime_1.jsx)("input", { type: "number", min: 1, className: "input num text-xs", value: editFinalPrice, onChange: (e) => setEditFinalPrice(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("label", { className: "flex cursor-pointer items-center gap-2 text-xs text-slate-800", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", className: "h-4 w-4 rounded border-slate-300 text-indigo-600", checked: useDiscount, onChange: (e) => setUseDiscount(e.target.checked) }), (0, jsx_runtime_1.jsx)("span", { children: "\u0646\u0645\u0627\u06CC\u0634 \u062A\u062E\u0641\u06CC\u0641 \u062E\u0637\u200C\u062E\u0648\u0631\u062F\u0647 (\u0633\u0642\u0641 \u0645\u0639\u06CC\u0627\u0631 + \u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641) \u062F\u0631 \u0633\u0627\u06CC\u062A" })] }), useDiscount && ((0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-2 gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px]", children: "\u062F\u0631\u0635\u062F \u062A\u062E\u0641\u06CC\u0641 \u0646\u0645\u0627\u06CC\u0634\u06CC (\u066A)" }), (0, jsx_runtime_1.jsx)("input", { type: "number", min: 1, max: 60, className: "input num text-xs", value: editDiscountPct, onChange: (e) => setEditDiscountPct(e.target.value) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label text-[11px]", children: "\u0646\u0648\u0639 \u06A9\u0645\u067E\u06CC\u0646 \u0633\u0627\u06CC\u062A" }), (0, jsx_runtime_1.jsxs)("select", { className: "input text-xs", value: editCampaignType, onChange: (e) => setEditCampaignType(e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: "none", children: "\u0639\u0627\u062F\u06CC (\u062E\u0637\u200C\u062E\u0648\u0631\u062F\u0647 \u0628\u062F\u0648\u0646 \u06A9\u0645\u067E\u06CC\u0646)" }), (0, jsx_runtime_1.jsx)("option", { value: "flash", children: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0644\u062D\u0638\u0647\u200C\u0627\u06CC" }), (0, jsx_runtime_1.jsx)("option", { value: "featured", children: "\u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0634\u06AF\u0641\u062A\u200C\u0627\u0646\u06AF\u06CC\u0632" }), (0, jsx_runtime_1.jsx)("option", { value: "timed_sale", children: "\u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631" })] })] })] })), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-lg bg-white/80 px-2.5 py-2 text-[11px] leading-5 text-slate-700", children: [(0, jsx_runtime_1.jsxs)("div", { children: ["\u0633\u0642\u0641 \u062E\u0637\u200C\u062E\u0648\u0631\u062F\u0647 \u0645\u062D\u0627\u0633\u0628\u0647\u200C\u0634\u062F\u0647:", " ", (0, jsx_runtime_1.jsx)("strong", { className: "num text-slate-900", children: previewBasePrice > 0 ? `${previewBasePrice.toLocaleString("fa-IR")} تومان` : "—" }), " ", useDiscount ? `(${parsedPct.toLocaleString("fa-IR")}٪ تخفیف)` : "(بدون تخفیف نمایشی)"] }), previewProfit !== null && ((0, jsx_runtime_1.jsxs)("div", { children: ["\u0633\u0648\u062F \u062E\u0627\u0644\u0635 \u062A\u062E\u0645\u06CC\u0646\u06CC \u0631\u0648\u06CC \u0642\u06CC\u0645\u062A \u0647\u0645\u06A9\u0627\u0631:", " ", (0, jsx_runtime_1.jsxs)("strong", { className: `num ${previewProfit > 0 ? "text-emerald-700" : "text-rose-700"}`, children: [previewProfit.toLocaleString("fa-IR"), " \u062A\u0648\u0645\u0627\u0646"] })] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap gap-2", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: `flex-1 text-xs sm:flex-initial ${effectiveBelowFloor ? "btn-danger" : "btn-success"}`, disabled: pending || effectiveBelowFloor, onClick: () => act("approve"), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: "\u2705 \u0630\u062E\u06CC\u0631\u0647 \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0646\u0647\u0627\u06CC\u06CC" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary flex-1 text-xs sm:flex-initial", onClick: () => setShowEditPanel(false), children: "\u0628\u0633\u062A\u0646" })] })] }))] }));
}
function RelinkTorobAction({ decisionId, initialTorobUrl, canConfirmCurrent = false, }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [torobUrl, setTorobUrl] = (0, react_1.useState)(initialTorobUrl ?? "");
    const [msg, setMsg] = (0, react_1.useState)(null);
    const submitRelink = (overrideUrl) => {
        const clean = (overrideUrl ?? torobUrl).trim();
        if (!clean)
            return;
        start(async () => {
            setMsg(null);
            const { ok, data } = await safeJsonFetch(`/api/decisions/${decisionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "relink_torob",
                    torobUrl: clean,
                }),
            });
            const text = String(data.message ?? (ok ? "لینک ترب اصلاح و استعلام مجدد انجام شد" : data.error ?? "خطا در اصلاح لینک ترب"));
            setMsg({ ok, text });
            if (ok)
                toast.success(text);
            else
                toast.error(text);
            router.refresh();
        });
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mt-2.5 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-[11px] font-semibold text-slate-700", children: "\uD83D\uDD17 \u0627\u0635\u0644\u0627\u062D \u0644\u06CC\u0646\u06A9 \u0635\u0641\u062D\u0647 \u0645\u062D\u0635\u0648\u0644 \u062F\u0631 \u062A\u0631\u0628 \u0648 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0645\u062C\u062F\u062F (\u0627\u06AF\u0631 \u067E\u0646\u0644 \u0627\u0634\u062A\u0628\u0627\u0647 \u0627\u0646\u062A\u062E\u0627\u0628 \u0634\u062F\u0647 \u0627\u0633\u062A):" }), canConfirmCurrent && initialTorobUrl && ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-success btn-sm text-[11px]", disabled: pending, onClick: () => submitRelink(initialTorobUrl), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3 w-3" }), (0, jsx_runtime_1.jsx)("span", { children: "\u2705 \u062A\u0623\u06CC\u06CC\u062F \u0627\u06CC\u0646 \u067E\u0646\u0644 \u062A\u0631\u0628 \u0648 \u0627\u0646\u062A\u0642\u0627\u0644 \u0628\u0647 \u067E\u0646\u0644 \u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631\u06CC" })] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col gap-2 sm:flex-row", children: [(0, jsx_runtime_1.jsx)("input", { className: "input flex-1 text-xs", dir: "ltr", placeholder: "https://torob.com/p/...", value: torobUrl, onChange: (e) => setTorobUrl(e.target.value) }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-primary shrink-0 text-xs", disabled: pending || !torobUrl.trim(), onClick: () => submitRelink(), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-3.5 w-3.5" }), (0, jsx_runtime_1.jsx)("span", { children: "\u0627\u062A\u0635\u0627\u0644 \u0648 \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0645\u062C\u062F\u062F" })] })] }), msg && ((0, jsx_runtime_1.jsx)("div", { className: `text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`, children: msg.text }))] }));
}
function ProductStatusToggle({ id, status }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const next = status === "paused" ? "active" : "paused";
    return ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-secondary", disabled: pending, onClick: () => start(async () => {
            const { ok, data } = await safeJsonFetch(`/api/products/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: next }),
            });
            if (ok) {
                toast.success(next === "active" ? "قیمت‌گذاری محصول فعال شد" : "قیمت‌گذاری محصول متوقف شد");
            }
            else {
                toast.error(String(data.error ?? "خطا در تغییر وضعیت محصول"));
            }
            router.refresh();
        }), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: status === "paused" ? "فعال‌سازی" : "توقف قیمت‌گذاری" })] }));
}
function DeleteProductButton({ id, name }) {
    const router = (0, navigation_1.useRouter)();
    const toast = (0, ui_1.useToast)();
    const [pending, start] = (0, react_1.useTransition)();
    const [confirmOpen, setConfirmOpen] = (0, react_1.useState)(false);
    const remove = () => start(async () => {
        const { ok, data } = await safeJsonFetch(`/api/products/${id}`, { method: "DELETE" });
        if (ok) {
            toast.success("محصول با موفقیت حذف شد");
            setConfirmOpen(false);
            router.push("/products");
            router.refresh();
        }
        else {
            toast.error(String(data.error ?? "خطا در حذف محصول"));
        }
    });
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "btn-danger", disabled: pending, onClick: () => setConfirmOpen(true), children: [pending && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), (0, jsx_runtime_1.jsx)("span", { children: "\u062D\u0630\u0641" })] }), (0, jsx_runtime_1.jsx)(ui_1.ConfirmDialog, { open: confirmOpen, title: "\u062D\u0630\u0641 \u06A9\u0627\u0631\u062A \u0645\u062D\u0635\u0648\u0644", description: `آیا از حذف ${name ? `«${name}»` : "این محصول"} و تمام تاریخچه تصمیم‌های آن مطمئن هستید؟ این عمل قابل بازگشت نیست.`, confirmLabel: "\u0628\u0644\u0647\u060C \u062D\u0630\u0641 \u0634\u0648\u062F", tone: "danger", busy: pending, onConfirm: remove, onCancel: () => setConfirmOpen(false) })] }));
}
