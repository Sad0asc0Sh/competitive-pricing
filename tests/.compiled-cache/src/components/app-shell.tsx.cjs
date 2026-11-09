"use client";
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppShell = AppShell;
const jsx_runtime_1 = require("react/jsx-runtime");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const icons_1 = require("./icons");
const NAV = [
    { href: "/", label: "داشبورد", desc: "نمای کلی و آخرین تصمیم‌ها", Icon: icons_1.IconDashboard },
    { href: "/products", label: "محصولات", desc: "کارت‌های محصول و استعلام", Icon: icons_1.IconProducts },
    { href: "/review", label: "بازبینی", desc: "صف تأیید انسانی", Icon: icons_1.IconReview },
    { href: "/runs", label: "اجراها", desc: "تاریخچه استعلام‌ها", Icon: icons_1.IconRuns },
    { href: "/campaigns", label: "کمپین‌های تخفیف", desc: "۳ سیستم تخفیف فروشگاه", Icon: icons_1.IconCampaigns },
    { href: "/settings", label: "تنظیمات موتور", desc: "پروفایل، زمان‌بندی، اتصال", Icon: icons_1.IconSettings },
    { href: "/simulate", label: "شبیه‌ساز", desc: "آزمایشگاه کف و سقف بازار", Icon: icons_1.IconSimulate },
    { href: "/docs", label: "منطق سیستم", desc: "مستندات موتور قیمت‌گذاری", Icon: icons_1.IconDocs },
];
function isActive(pathname, href) {
    if (href === "/")
        return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}
function NavList({ pathname, onNavigate }) {
    return ((0, jsx_runtime_1.jsx)("nav", { className: "flex flex-col gap-1 p-3", "aria-label": "\u0646\u0627\u0648\u0628\u0631\u06CC \u0627\u0635\u0644\u06CC", children: NAV.map(({ href, label, desc, Icon }) => {
            const active = isActive(pathname, href);
            return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: href, onClick: onNavigate, "aria-current": active ? "page" : undefined, className: `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active
                    ? "bg-indigo-600 font-semibold text-white shadow-sm shadow-indigo-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`, children: [(0, jsx_runtime_1.jsx)(Icon, { className: `h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-500"}` }), (0, jsx_runtime_1.jsxs)("span", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: "block truncate", children: label }), (0, jsx_runtime_1.jsx)("span", { className: `block truncate text-[11px] font-normal ${active ? "text-indigo-100" : "text-slate-400"}`, children: desc })] })] }, href));
        }) }));
}
function Brand() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-3 px-5 py-5", children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200", children: (0, jsx_runtime_1.jsx)(icons_1.IconBolt, { className: "h-5 w-5" }) }), (0, jsx_runtime_1.jsxs)("span", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: "block truncate text-base font-extrabold text-slate-900", children: "\u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631 \u0647\u0648\u0634\u0645\u0646\u062F" }), (0, jsx_runtime_1.jsx)("span", { className: "block truncate text-[11px] text-slate-500", children: "Torob-driven Pricing Engine" })] })] }));
}
function AppShell({ children, authEnabled }) {
    const pathname = (0, navigation_1.usePathname)() ?? "/";
    const [drawerOpen, setDrawerOpen] = (0, react_1.useState)(false);
    const [prevPathname, setPrevPathname] = (0, react_1.useState)(pathname);
    // با هر جابه‌جایی بین صفحات، دراور موبایل بسته شود
    // (الگوی رسمی React برای همگام‌سازی state با prop: تنظیم state در حین رندر به‌جای افکت)
    if (prevPathname !== pathname) {
        setPrevPathname(pathname);
        if (drawerOpen)
            setDrawerOpen(false);
    }
    // قفل اسکرول بدنه + بستن با Escape وقتی دراور باز است
    (0, react_1.useEffect)(() => {
        if (!drawerOpen)
            return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e) => {
            if (e.key === "Escape")
                setDrawerOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener("keydown", onKey);
        };
    }, [drawerOpen]);
    // صفحه ورود پوسته ندارد
    if (pathname === "/login")
        return (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: children });
    const logout = authEnabled ? ((0, jsx_runtime_1.jsx)("form", { action: "/api/auth/logout", method: "post", className: "p-3 pt-0", children: (0, jsx_runtime_1.jsxs)("button", { type: "submit", className: "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500 transition hover:bg-rose-50 hover:text-rose-700", children: [(0, jsx_runtime_1.jsx)(icons_1.IconLogout, { className: "h-5 w-5 shrink-0" }), "\u062E\u0631\u0648\u062C \u0627\u0632 \u067E\u0646\u0644"] }) })) : null;
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex min-h-screen", children: [(0, jsx_runtime_1.jsxs)("aside", { className: "sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex", children: [(0, jsx_runtime_1.jsx)("div", { className: "border-b border-slate-100", children: (0, jsx_runtime_1.jsx)(Brand, {}) }), (0, jsx_runtime_1.jsx)("div", { className: "flex-1 overflow-y-auto", children: (0, jsx_runtime_1.jsx)(NavList, { pathname: pathname }) }), logout] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col", children: [(0, jsx_runtime_1.jsxs)("header", { className: "sticky top-0 z-40 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur lg:hidden", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setDrawerOpen(true), "aria-label": "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648", "aria-expanded": drawerOpen, className: "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-slate-50 active:bg-slate-100", children: (0, jsx_runtime_1.jsx)(icons_1.IconMenu, { className: "h-5 w-5" }) }), (0, jsx_runtime_1.jsxs)("span", { className: "flex min-w-0 items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white", children: (0, jsx_runtime_1.jsx)(icons_1.IconBolt, { className: "h-4 w-4" }) }), (0, jsx_runtime_1.jsx)("span", { className: "truncate text-sm font-extrabold text-slate-900", children: "\u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631 \u0647\u0648\u0634\u0645\u0646\u062F" })] }), (0, jsx_runtime_1.jsx)("span", { className: "mr-auto truncate text-xs font-medium text-slate-400", children: NAV.find((n) => isActive(pathname, n.href))?.label ?? "" })] }), !authEnabled && ((0, jsx_runtime_1.jsxs)("div", { className: "border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-6 text-amber-800 md:px-8", children: [(0, jsx_runtime_1.jsx)("span", { className: "ml-1 inline-flex translate-y-0.5 items-center", children: (0, jsx_runtime_1.jsx)(icons_1.IconShield, { className: "h-4 w-4" }) }), "\u0648\u0631\u0648\u062F \u0645\u062F\u06CC\u0631 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A \u2014 \u0628\u0631\u0627\u06CC \u0648\u0627\u0642\u0639\u06CC \u0648 \u0627\u0645\u0646\u200C\u06A9\u0631\u062F\u0646 \u067E\u0646\u0644\u060C \u0645\u062A\u063A\u06CC\u0631 ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: "ADMIN_PASSWORD" }), " \u0631\u0627 \u062F\u0631 \u0641\u0627\u06CC\u0644 ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: ".env" }), " \u0633\u0631\u0648\u0631 \u062A\u0646\u0638\u06CC\u0645 \u0648 \u0633\u0631\u0648\u06CC\u0633 \u0631\u0627 \u0631\u06CC\u200C\u0627\u0633\u062A\u0627\u0631\u062A \u06A9\u0646\u06CC\u062F."] })), (0, jsx_runtime_1.jsx)("main", { className: "mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6 md:p-8", children: children })] }), (0, jsx_runtime_1.jsxs)("div", { className: `fixed inset-0 z-50 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`, "aria-hidden": !drawerOpen, children: [(0, jsx_runtime_1.jsx)("div", { onClick: () => setDrawerOpen(false), className: `absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-300 ${drawerOpen ? "opacity-100" : "opacity-0"}` }), (0, jsx_runtime_1.jsxs)("aside", { className: `absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${drawerOpen ? "translate-x-0" : "translate-x-full"}`, role: "dialog", "aria-modal": "true", "aria-label": "\u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between border-b border-slate-100", children: [(0, jsx_runtime_1.jsx)(Brand, {}), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setDrawerOpen(false), "aria-label": "\u0628\u0633\u062A\u0646 \u0645\u0646\u0648", className: "ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50", children: (0, jsx_runtime_1.jsx)(icons_1.IconClose, { className: "h-4 w-4" }) })] }), (0, jsx_runtime_1.jsx)("div", { className: "flex-1 overflow-y-auto", children: (0, jsx_runtime_1.jsx)(NavList, { pathname: pathname, onNavigate: () => setDrawerOpen(false) }) }), logout] })] })] }));
}
