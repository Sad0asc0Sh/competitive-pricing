"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LoginPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const icons_1 = require("@/components/icons");
function LoginForm() {
    const router = (0, navigation_1.useRouter)();
    const search = (0, navigation_1.useSearchParams)();
    const next = search.get("next") || "/";
    const [password, setPassword] = (0, react_1.useState)("");
    const [err, setErr] = (0, react_1.useState)(null);
    const [pending, start] = (0, react_1.useTransition)();
    const submit = (e) => {
        e.preventDefault();
        start(async () => {
            setErr(null);
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(j.error ?? "خطا در ورود");
                return;
            }
            router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
            router.refresh();
        });
    };
    return ((0, jsx_runtime_1.jsx)("div", { className: "flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-10", children: (0, jsx_runtime_1.jsxs)("form", { onSubmit: submit, className: "w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8", children: [(0, jsx_runtime_1.jsxs)("div", { className: "mb-6 flex flex-col items-center text-center", children: [(0, jsx_runtime_1.jsx)("span", { className: "mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200", children: (0, jsx_runtime_1.jsx)(icons_1.IconBolt, { className: "h-6 w-6" }) }), (0, jsx_runtime_1.jsx)("h1", { className: "text-lg font-extrabold text-slate-900", children: "\u0648\u0631\u0648\u062F \u0628\u0647 \u067E\u0646\u0644 \u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631 \u0647\u0648\u0634\u0645\u0646\u062F" }), (0, jsx_runtime_1.jsxs)("p", { className: "mt-1 flex items-center gap-1 text-xs text-slate-500", children: [(0, jsx_runtime_1.jsx)(icons_1.IconShield, { className: "h-3.5 w-3.5" }), "\u0627\u06CC\u0646 \u0628\u062E\u0634 \u0641\u0642\u0637 \u0628\u0631\u0627\u06CC \u0645\u062F\u06CC\u0631 \u0633\u06CC\u0633\u062A\u0645 \u0627\u0633\u062A"] })] }), (0, jsx_runtime_1.jsx)("label", { className: "label", htmlFor: "admin-password", children: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0645\u062F\u06CC\u0631" }), (0, jsx_runtime_1.jsx)("input", { id: "admin-password", type: "password", autoComplete: "current-password", className: "input", dir: "ltr", value: password, onChange: (e) => setPassword(e.target.value), autoFocus: true }), err && (0, jsx_runtime_1.jsx)("p", { className: "mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700", children: err }), (0, jsx_runtime_1.jsx)("button", { type: "submit", className: "btn-primary mt-5 w-full py-2.5", disabled: pending || !password, children: pending ? "در حال بررسی…" : "ورود" })] }) }));
}
function LoginPage() {
    return ((0, jsx_runtime_1.jsx)(react_1.Suspense, { children: (0, jsx_runtime_1.jsx)(LoginForm, {}) }));
}
