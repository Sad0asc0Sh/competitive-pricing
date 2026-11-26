"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useToast = useToast;
exports.ToastProvider = ToastProvider;
exports.ModalSheet = ModalSheet;
exports.ConfirmDialog = ConfirmDialog;
exports.Switch = Switch;
exports.CollapsibleSection = CollapsibleSection;
exports.SegmentedTabs = SegmentedTabs;
exports.EmptyState = EmptyState;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const icons_1 = require("./icons");
const noopToast = {
    push: () => { },
    success: () => { },
    error: () => { },
    info: () => { },
};
const ToastContext = (0, react_1.createContext)(noopToast);
function useToast() {
    return (0, react_1.useContext)(ToastContext);
}
function ToastProvider({ children }) {
    const [items, setItems] = (0, react_1.useState)([]);
    const nextId = (0, react_1.useRef)(1);
    const timers = (0, react_1.useRef)(new Map());
    const dismiss = (0, react_1.useCallback)((id) => {
        const t = timers.current.get(id);
        if (t) {
            clearTimeout(t);
            timers.current.delete(id);
        }
        setItems((prev) => prev.filter((x) => x.id !== id));
    }, []);
    const push = (0, react_1.useCallback)((tone, text) => {
        const id = nextId.current++;
        setItems((prev) => [...prev.slice(-3), { id, tone, text }]);
        const duration = tone === "error" ? 6500 : 4500;
        const t = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, t);
    }, [dismiss]);
    (0, react_1.useEffect)(() => {
        const map = timers.current;
        return () => {
            map.forEach((t) => clearTimeout(t));
            map.clear();
        };
    }, []);
    const value = (0, react_1.useMemo)(() => ({
        push,
        success: (text) => push("success", text),
        error: (text) => push("error", text),
        info: (text) => push("info", text),
    }), [push]);
    return ((0, jsx_runtime_1.jsxs)(ToastContext.Provider, { value: value, children: [children, (0, jsx_runtime_1.jsx)("div", { className: "pointer-events-none fixed inset-x-3.5 bottom-20 z-[70] flex flex-col gap-2 lg:bottom-6 lg:left-6 lg:right-auto lg:w-96", "aria-live": "polite", "aria-atomic": "false", children: items.map((item) => {
                    const styles = item.tone === "success"
                        ? "border-emerald-200 bg-emerald-950 text-white"
                        : item.tone === "error"
                            ? "border-rose-300 bg-rose-950 text-white"
                            : "border-slate-700 bg-slate-900 text-white";
                    return ((0, jsx_runtime_1.jsxs)("div", { role: "status", className: `pointer-events-auto animate-toast-in flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-xs font-medium shadow-xl ${styles}`, children: [(0, jsx_runtime_1.jsx)("span", { className: "mt-0.5 shrink-0", children: item.tone === "success" ? ((0, jsx_runtime_1.jsx)(icons_1.IconCheckCircle, { className: "h-4 w-4 text-emerald-400" })) : item.tone === "error" ? ((0, jsx_runtime_1.jsx)(icons_1.IconXCircle, { className: "h-4 w-4 text-rose-400" })) : ((0, jsx_runtime_1.jsx)(icons_1.IconInfo, { className: "h-4 w-4 text-indigo-300" })) }), (0, jsx_runtime_1.jsx)("span", { className: "min-w-0 flex-1 break-words leading-5", children: item.text }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => dismiss(item.id), "aria-label": "\u0628\u0633\u062A\u0646 \u0627\u0639\u0644\u0627\u0646", className: "shrink-0 rounded-lg p-1 text-white/70 transition hover:bg-white/10 hover:text-white", children: (0, jsx_runtime_1.jsx)(icons_1.IconClose, { className: "h-3.5 w-3.5" }) })] }, item.id));
                }) })] }));
}
/* =========================================================
 * ۲) مودال واکنش‌گرا: Bottom Sheet در موبایل و Dialog در دسکتاپ
 * =======================================================*/
const modalWidths = {
    sm: "sm:max-w-md",
    md: "sm:max-w-xl",
    lg: "sm:max-w-3xl",
    xl: "sm:max-w-4xl",
};
function ModalSheet({ open, onClose, title, subtitle, maxWidth = "lg", children, footer, }) {
    const titleId = (0, react_1.useId)();
    (0, react_1.useEffect)(() => {
        if (!open)
            return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKey);
        };
    }, [open, onClose]);
    if (!open)
        return null;
    return ((0, jsx_runtime_1.jsxs)("div", { className: "fixed inset-0 z-[65] flex items-end justify-center p-0 sm:items-center sm:p-4", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, children: [(0, jsx_runtime_1.jsx)("div", { onClick: onClose, className: "fixed inset-0 bg-slate-900/55 backdrop-blur-[2px] transition-opacity" }), (0, jsx_runtime_1.jsxs)("div", { className: `relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl ${modalWidths[maxWidth]} animate-sheet-up`, children: [(0, jsx_runtime_1.jsx)("div", { className: "flex justify-center pt-2.5 pb-1 sm:hidden", children: (0, jsx_runtime_1.jsx)("span", { className: "h-1 w-10 rounded-full bg-slate-300" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("h2", { id: titleId, className: "text-base font-bold text-slate-900", children: title }), subtitle && (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-xs text-slate-500", children: subtitle })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: onClose, "aria-label": "\u0628\u0633\u062A\u0646 \u067E\u0646\u062C\u0631\u0647", className: "btn-icon h-9 w-9 shrink-0", children: (0, jsx_runtime_1.jsx)(icons_1.IconClose, { className: "h-4 w-4" }) })] }), (0, jsx_runtime_1.jsx)("div", { className: "flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5", children: children }), footer ? ((0, jsx_runtime_1.jsx)("div", { className: "safe-bottom border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5", children: footer })) : ((0, jsx_runtime_1.jsx)("div", { className: "safe-bottom sm:hidden" }))] })] }));
}
/* =========================================================
 * ۳) دیالوگ تأیید سفارشی (جایگزین window.confirm)
 * =======================================================*/
function ConfirmDialog({ open, title, description, confirmLabel = "تأیید و ادامه", cancelLabel = "انصراف", tone = "danger", busy = false, onConfirm, onCancel, }) {
    return ((0, jsx_runtime_1.jsxs)(ModalSheet, { open: open, onClose: busy ? () => { } : onCancel, title: title, maxWidth: "sm", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-sm leading-7 text-slate-600", children: description }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "btn-secondary", disabled: busy, onClick: onCancel, children: cancelLabel }), (0, jsx_runtime_1.jsxs)("button", { type: "button", className: tone === "danger" ? "btn-danger" : "btn-primary", disabled: busy, onClick: onConfirm, children: [busy && (0, jsx_runtime_1.jsx)(icons_1.IconSpinner, { className: "h-4 w-4" }), confirmLabel] })] })] }));
}
/* =========================================================
 * ۴) کلید کشویی مدرن (Switch) سازگار با RTL و تاچ موبایل
 * =======================================================*/
function Switch({ checked, onChange, label, description, disabled = false, id, }) {
    const autoId = (0, react_1.useId)();
    const controlId = id ?? autoId;
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [(label || description) && ((0, jsx_runtime_1.jsxs)("label", { htmlFor: controlId, className: "min-w-0 flex-1 cursor-pointer select-none", children: [label && (0, jsx_runtime_1.jsx)("span", { className: "block text-sm font-medium text-slate-800", children: label }), description && (0, jsx_runtime_1.jsx)("span", { className: "mt-0.5 block text-xs leading-5 text-slate-500", children: description })] })), (0, jsx_runtime_1.jsx)("button", { id: controlId, type: "button", role: "switch", "aria-checked": checked, disabled: disabled, onClick: () => onChange(!checked), dir: "ltr", className: `relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-indigo-600" : "bg-slate-300"}`, children: (0, jsx_runtime_1.jsx)("span", { className: `pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}` }) })] }));
}
/* =========================================================
 * ۵) بخش بازشو (Accordion / CollapsibleSection)
 * =======================================================*/
function CollapsibleSection({ title, subtitle, badge, icon, defaultOpen = true, open: controlledOpen, onOpenChange, className = "", headerRight, children, }) {
    const [internalOpen, setInternalOpen] = (0, react_1.useState)(defaultOpen);
    const isOpen = controlledOpen ?? internalOpen;
    const toggle = () => {
        const next = !isOpen;
        if (controlledOpen === undefined)
            setInternalOpen(next);
        onOpenChange?.(next);
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: `card overflow-hidden p-0 ${className}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-3.5", children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: toggle, "aria-expanded": isOpen, className: "flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-right transition hover:opacity-85", children: [icon && (0, jsx_runtime_1.jsx)("span", { className: "shrink-0 text-indigo-600", children: icon }), (0, jsx_runtime_1.jsxs)("span", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsxs)("span", { className: "flex flex-wrap items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-sm font-bold text-slate-900 sm:text-base", children: title }), badge] }), subtitle && (0, jsx_runtime_1.jsx)("span", { className: "mt-0.5 block text-xs text-slate-500", children: subtitle })] }), (0, jsx_runtime_1.jsx)(icons_1.IconChevronDown, { className: `h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}` })] }), headerRight && (0, jsx_runtime_1.jsx)("div", { className: "shrink-0", children: headerRight })] }), isOpen && (0, jsx_runtime_1.jsx)("div", { className: "border-t border-slate-100 p-4 sm:p-5", children: children })] }));
}
function SegmentedTabs({ items, value, onChange, className = "", }) {
    return ((0, jsx_runtime_1.jsx)("div", { role: "tablist", className: `no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1.5 ${className}`, children: items.map((item) => {
            const active = item.key === value;
            return ((0, jsx_runtime_1.jsxs)("button", { type: "button", role: "tab", "aria-selected": active, onClick: () => onChange(item.key), className: `inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition sm:text-sm ${active
                    ? "bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/70"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"}`, children: [item.icon && (0, jsx_runtime_1.jsx)("span", { className: "shrink-0", children: item.icon }), (0, jsx_runtime_1.jsx)("span", { children: item.label }), item.count != null && ((0, jsx_runtime_1.jsx)("span", { className: `num rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-indigo-100 text-indigo-800" : "bg-slate-200/80 text-slate-600"}`, children: item.count.toLocaleString("fa-IR") }))] }, item.key));
        }) }));
}
/* =========================================================
 * ۷) وضعیت خالی استاندارد (EmptyState)
 * =======================================================*/
function EmptyState({ icon, title, description, action, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "empty-state flex flex-col items-center justify-center gap-2", children: [icon && (0, jsx_runtime_1.jsx)("div", { className: "mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-xs", children: icon }), (0, jsx_runtime_1.jsx)("div", { className: "font-bold text-slate-700", children: title }), description && (0, jsx_runtime_1.jsx)("p", { className: "max-w-md text-xs leading-6 text-slate-500", children: description }), action && (0, jsx_runtime_1.jsx)("div", { className: "mt-2", children: action })] }));
}
