"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunButton = RunButton;
exports.CardRangeRunner = CardRangeRunner;
exports.DecisionActions = DecisionActions;
exports.ProductStatusToggle = ProductStatusToggle;
exports.DeleteProductButton = DeleteProductButton;
const jsx_runtime_1 = require("react/jsx-runtime");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
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
function RunButton({ productIds, cardRangeFrom, cardRangeTo, label = "اجرای استعلام", className = "btn-primary", }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    return ((0, jsx_runtime_1.jsxs)("span", { className: "inline-flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: className, disabled: pending, onClick: () => start(async () => {
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
                        const lastErr = typeof data.lastError === "string" && data.lastError ? ` (${data.lastError})` : "";
                        setMsg({
                            ok: Number(data.failed ?? 0) === 0 || Number(data.applied ?? 0) + Number(data.pendingReview ?? 0) > 0,
                            text: `اعمال: ${data.applied ?? 0} | بازبینی: ${data.pendingReview ?? 0} | رد/خطا: ${data.failed ?? 0}${lastErr}`,
                        });
                    }
                    else {
                        setMsg({ ok: false, text: String(data.error ?? "خطا در اجرای استعلام") });
                    }
                    router.refresh();
                }), children: pending ? "در حال استعلام…" : label }), msg && ((0, jsx_runtime_1.jsx)("span", { className: `text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`, children: msg.text }))] }));
}
/**
 * نوار ابزار اجرای هوشمند روی یک رنج دلخواه از کارت‌ها + دکمه پاک‌سازی فوری دسته ۳ و ریست قفل ترب
 */
function CardRangeRunner({ totalCards }) {
    const router = (0, navigation_1.useRouter)();
    const [fromCard, setFromCard] = (0, react_1.useState)(1);
    const [toCard, setToCard] = (0, react_1.useState)(Math.max(1, Math.min(3, totalCards || 3)));
    const [category, setCategory] = (0, react_1.useState)("");
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-end gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: "text-xs font-bold text-indigo-900", children: "\uD83C\uDFAF \u0627\u062C\u0631\u0627\u06CC \u0647\u062F\u0641\u0645\u0646\u062F \u06A9\u0641 \u0648 \u0633\u0642\u0641 + \u062A\u062E\u0641\u06CC\u0641 \u0631\u0648\u06CC \u0631\u0646\u062C\u06CC \u0627\u0632 \u06A9\u0627\u0631\u062A\u200C\u0647\u0627" }), (0, jsx_runtime_1.jsx)("div", { className: "text-xs text-slate-500", children: "\u0628\u0631\u0627\u06CC \u062C\u0644\u0648\u06AF\u06CC\u0631\u06CC \u0627\u0632 \u0686\u0627\u0644\u0634 \u06A9\u067E\u0686\u0627\u06CC \u062A\u0631\u0628 (HTTP 490)\u060C \u0627\u0633\u062A\u0639\u0644\u0627\u0645 \u0631\u0627 \u062F\u0631 \u062F\u0633\u062A\u0647\u200C\u0647\u0627\u06CC \u06F3 \u062A\u0627 \u06F5 \u06A9\u0627\u0631\u062A\u06CC \u0627\u062C\u0631\u0627 \u06A9\u0646\u06CC\u062F" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0627\u0632 \u06A9\u0627\u0631\u062A #" }), (0, jsx_runtime_1.jsx)("input", { className: "input num w-24", type: "number", min: 1, value: fromCard, onChange: (e) => setFromCard(Math.max(1, Number(e.target.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u062A\u0627 \u06A9\u0627\u0631\u062A #" }), (0, jsx_runtime_1.jsx)("input", { className: "input num w-24", type: "number", min: 1, value: toCard, onChange: (e) => setToCard(Math.max(1, Number(e.target.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "label", children: "\u0641\u06CC\u0644\u062A\u0631 \u062F\u0633\u062A\u0647 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC)" }), (0, jsx_runtime_1.jsx)("input", { className: "input w-40", placeholder: "\u0647\u0645\u0647 \u062F\u0633\u062A\u0647\u200C\u0647\u0627", value: category, onChange: (e) => setCategory(e.target.value) })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-primary", disabled: pending, onClick: () => start(async () => {
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
                            }
                            else {
                                setMsg({ ok: false, text: String(data.error ?? "خطا در اجرای رنج کارت‌ها") });
                            }
                            router.refresh();
                        }), children: pending ? "در حال اجرای رنج کارت‌ها…" : `⚡ اعمال روی کارت #${fromCard} تا #${toCard}` }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary text-xs", disabled: pending, onClick: () => start(async () => {
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
                        }), children: "\uD83E\uDDF9 \u067E\u0627\u06A9\u200C\u0633\u0627\u0632\u06CC \u06A9\u0627\u0631\u062A \u0627\u0634\u062A\u0628\u0627\u0647 \u062F\u0633\u062A\u0647 \u06F3 (\u0641\u0631\u0635\u062A \u0632\u0645\u0627\u0646\u200C\u062F\u0627\u0631) + \u0631\u06CC\u0633\u062A \u0642\u0641\u0644 \u062A\u0631\u0628" })] }), msg && ((0, jsx_runtime_1.jsx)("div", { className: `rounded-lg border px-3 py-2 text-xs font-medium ${msg.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-rose-300 bg-rose-50 text-rose-900"}`, children: msg.text }))] }));
}
function DecisionActions({ decisionId }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const [msg, setMsg] = (0, react_1.useState)(null);
    const act = (action) => start(async () => {
        setMsg(null);
        const { ok, data } = await safeJsonFetch(`/api/decisions/${decisionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        setMsg({
            ok,
            text: String(data.message ?? (ok ? "انجام شد" : data.error ?? "خطا")),
        });
        router.refresh();
    });
    return ((0, jsx_runtime_1.jsxs)("span", { className: "inline-flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-success", disabled: pending, onClick: () => act("approve"), children: "\u062A\u0623\u06CC\u06CC\u062F \u0648 \u0627\u0639\u0645\u0627\u0644" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary", disabled: pending, onClick: () => act("reject"), children: "\u0631\u062F" }), msg && ((0, jsx_runtime_1.jsx)("span", { className: `text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`, children: msg.text }))] }));
}
function ProductStatusToggle({ id, status }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    const next = status === "paused" ? "active" : "paused";
    return ((0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary", disabled: pending, onClick: () => start(async () => {
            await safeJsonFetch(`/api/products/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: next }),
            });
            router.refresh();
        }), children: status === "paused" ? "فعال‌سازی" : "توقف قیمت‌گذاری" }));
}
function DeleteProductButton({ id }) {
    const router = (0, navigation_1.useRouter)();
    const [pending, start] = (0, react_1.useTransition)();
    return ((0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-danger", disabled: pending, onClick: () => {
            if (!confirm("حذف محصول؟"))
                return;
            start(async () => {
                await safeJsonFetch(`/api/products/${id}`, { method: "DELETE" });
                router.push("/products");
                router.refresh();
            });
        }, children: "\u062D\u0630\u0641" }));
}
