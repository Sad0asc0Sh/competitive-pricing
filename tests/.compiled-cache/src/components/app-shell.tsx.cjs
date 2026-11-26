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
const ui_1 = require("./ui");
const NAV = [
    { href: "/", label: "داشبورد", shortLabel: "داشبورد", desc: "نمای کلی و آخرین تصمیم‌ها", Icon: icons_1.IconDashboard },
    { href: "/products", label: "محصولات", shortLabel: "محصولات", desc: "کارت‌های محصول و استعلام", Icon: icons_1.IconProducts },
    { href: "/review", label: "بازبینی", shortLabel: "بازبینی", desc: "صف تأیید انسانی", Icon: icons_1.IconReview },
    { href: "/runs", label: "اجراها", shortLabel: "اجراها", desc: "تاریخچه استعلام‌ها", Icon: icons_1.IconRuns },
    { href: "/campaigns", label: "کمپین‌های تخفیف", shortLabel: "کمپین‌ها", desc: "۳ سیستم تخفیف فروشگاه", Icon: icons_1.IconCampaigns },
    { href: "/settings", label: "تنظیمات موتور", shortLabel: "تنظیمات", desc: "پروفایل، زمان‌بندی، اتصال", Icon: icons_1.IconSettings },
    { href: "/simulate", label: "شبیه‌ساز", shortLabel: "شبیه‌ساز", desc: "آزمایشگاه کف و سقف بازار", Icon: icons_1.IconSimulate },
    { href: "/docs", label: "منطق سیستم", shortLabel: "مستندات", desc: "مستندات موتور قیمت‌گذاری", Icon: icons_1.IconDocs },
];
const BOTTOM_NAV_HREFS = ["/", "/products", "/review", "/campaigns"];
function isActive(pathname, href) {
    if (href === "/")
        return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}
function subscribeStorage(cb) {
    window.addEventListener("storage", cb);
    window.addEventListener("cp-ui-storage", cb);
    return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener("cp-ui-storage", cb);
    };
}
function readLocalFlag(key) {
    try {
        return window.localStorage.getItem(key) === "1";
    }
    catch {
        return false;
    }
}
function writeLocalFlag(key, value) {
    try {
        window.localStorage.setItem(key, value ? "1" : "0");
        window.dispatchEvent(new Event("cp-ui-storage"));
    }
    catch {
        // ignore storage errors
    }
}
function readSessionFlag(key) {
    try {
        return window.sessionStorage.getItem(key) === "1";
    }
    catch {
        return false;
    }
}
function writeSessionFlag(key, value) {
    try {
        window.sessionStorage.setItem(key, value ? "1" : "0");
        window.dispatchEvent(new Event("cp-ui-storage"));
    }
    catch {
        // ignore storage errors
    }
}
function NavList({ pathname, collapsed = false, onNavigate, }) {
    return ((0, jsx_runtime_1.jsx)("nav", { className: `flex flex-col gap-1 ${collapsed ? "p-2" : "p-3"}`, "aria-label": "\u0646\u0627\u0648\u0628\u0631\u06CC \u0627\u0635\u0644\u06CC", children: NAV.map(({ href, label, desc, Icon }) => {
            const active = isActive(pathname, href);
            return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: href, onClick: onNavigate, title: collapsed ? `${label} — ${desc}` : undefined, "aria-current": active ? "page" : undefined, className: `group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${collapsed ? "justify-center px-2" : ""} ${active
                    ? "bg-indigo-600 font-semibold text-white shadow-sm shadow-indigo-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`, children: [(0, jsx_runtime_1.jsx)(Icon, { className: `h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-500"}` }), !collapsed && ((0, jsx_runtime_1.jsxs)("span", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsx)("span", { className: "block truncate", children: label }), (0, jsx_runtime_1.jsx)("span", { className: `block truncate text-[11px] font-normal ${active ? "text-indigo-100" : "text-slate-400"}`, children: desc })] }))] }, href));
        }) }));
}
function Brand({ collapsed = false }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `flex items-center gap-3 ${collapsed ? "justify-center px-3 py-4" : "px-4 py-4 sm:px-5"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200", children: (0, jsx_runtime_1.jsx)(icons_1.IconBolt, { className: "h-5 w-5" }) }), !collapsed && ((0, jsx_runtime_1.jsxs)("span", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: "block truncate text-base font-extrabold text-slate-900", children: "\u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631 \u0647\u0648\u0634\u0645\u0646\u062F" }), (0, jsx_runtime_1.jsx)("span", { className: "block truncate text-[11px] text-slate-500", children: "Torob-driven Pricing Engine" })] }))] }));
}
function AppShell({ children, authEnabled }) {
    const pathname = (0, navigation_1.usePathname)() ?? "/";
    const router = (0, navigation_1.useRouter)();
    const [drawerOpen, setDrawerOpen] = (0, react_1.useState)(false);
    const [quickJumpOpen, setQuickJumpOpen] = (0, react_1.useState)(false);
    const [quickQuery, setQuickQuery] = (0, react_1.useState)("");
    const [prevPathname, setPrevPathname] = (0, react_1.useState)(pathname);
    const [dragOffset, setDragOffset] = (0, react_1.useState)(0);
    const touchStartX = (0, react_1.useRef)(null);
    const sidebarCollapsed = (0, react_1.useSyncExternalStore)(subscribeStorage, () => readLocalFlag("cp-sidebar-collapsed"), () => false);
    const devBannerDismissed = (0, react_1.useSyncExternalStore)(subscribeStorage, () => readSessionFlag("cp-dev-banner-dismissed"), () => false);
    // با هر جابه‌جایی بین صفحات، دراور و جستجوی سریع بسته شوند
    if (prevPathname !== pathname) {
        setPrevPathname(pathname);
        if (drawerOpen)
            setDrawerOpen(false);
        if (quickJumpOpen)
            setQuickJumpOpen(false);
        if (dragOffset !== 0)
            setDragOffset(0);
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
    // کلید میانبر Ctrl+K / Cmd+K برای جستجوی سریع بین بخش‌ها
    (0, react_1.useEffect)(() => {
        if (pathname === "/login")
            return;
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setQuickQuery("");
                setQuickJumpOpen((o) => !o);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [pathname]);
    const activeNav = (0, react_1.useMemo)(() => NAV.find((n) => isActive(pathname, n.href)) ?? NAV[0], [pathname]);
    const isOverflowRouteActive = (0, react_1.useMemo)(() => !BOTTOM_NAV_HREFS.some((href) => isActive(pathname, href)), [pathname]);
    const filteredNav = (0, react_1.useMemo)(() => {
        const q = quickQuery.trim().toLowerCase();
        if (!q)
            return NAV;
        return NAV.filter((n) => n.label.toLowerCase().includes(q) ||
            n.desc.toLowerCase().includes(q) ||
            n.href.toLowerCase().includes(q));
    }, [quickQuery]);
    // صفحه ورود پوسته ندارد اما ToastProvider دارد
    if (pathname === "/login") {
        return (0, jsx_runtime_1.jsx)(ui_1.ToastProvider, { children: children });
    }
    const logout = (collapsed = false) => authEnabled ? ((0, jsx_runtime_1.jsx)("form", { action: "/api/auth/logout", method: "post", className: collapsed ? "p-2 pt-0" : "p-3 pt-0", children: (0, jsx_runtime_1.jsxs)("button", { type: "submit", title: collapsed ? "خروج از پنل" : undefined, className: `flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 ${collapsed ? "justify-center px-2" : ""}`, children: [(0, jsx_runtime_1.jsx)(icons_1.IconLogout, { className: "h-5 w-5 shrink-0" }), !collapsed && (0, jsx_runtime_1.jsx)("span", { children: "\u062E\u0631\u0648\u062C \u0627\u0632 \u067E\u0646\u0644" })] }) })) : null;
    return ((0, jsx_runtime_1.jsx)(ui_1.ToastProvider, { children: (0, jsx_runtime_1.jsxs)("div", { className: "flex min-h-dvh", children: [(0, jsx_runtime_1.jsxs)("aside", { className: `sticky top-0 hidden h-dvh shrink-0 flex-col border-l border-slate-200 bg-white transition-[width] duration-200 lg:flex ${sidebarCollapsed ? "w-[76px]" : "w-64"}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between border-b border-slate-100", children: [(0, jsx_runtime_1.jsx)("div", { className: "min-w-0 flex-1", children: (0, jsx_runtime_1.jsx)(Brand, { collapsed: sidebarCollapsed }) }), !sidebarCollapsed && ((0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => writeLocalFlag("cp-sidebar-collapsed", true), "aria-label": "\u062C\u0645\u0639 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648\u06CC \u06A9\u0646\u0627\u0631\u06CC", title: "\u062C\u0645\u0639 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648\u06CC \u06A9\u0646\u0627\u0631\u06CC", className: "ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700", children: (0, jsx_runtime_1.jsx)(icons_1.IconPanelCollapse, { className: "h-4 w-4" }) }))] }), sidebarCollapsed && ((0, jsx_runtime_1.jsx)("div", { className: "flex justify-center border-b border-slate-100 py-2", children: (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => writeLocalFlag("cp-sidebar-collapsed", false), "aria-label": "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648\u06CC \u06A9\u0646\u0627\u0631\u06CC", title: "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648\u06CC \u06A9\u0646\u0627\u0631\u06CC", className: "flex h-9 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600", children: (0, jsx_runtime_1.jsx)(icons_1.IconPanelExpand, { className: "h-4 w-4" }) }) })), (0, jsx_runtime_1.jsx)("div", { className: "flex-1 overflow-y-auto", children: (0, jsx_runtime_1.jsx)(NavList, { pathname: pathname, collapsed: sidebarCollapsed }) }), logout(sidebarCollapsed)] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 flex-1 flex-col", children: [(0, jsx_runtime_1.jsxs)("header", { className: "sticky top-0 z-30 hidden h-14 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-8 backdrop-blur-md lg:flex", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 items-center gap-2.5", children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600", children: (0, jsx_runtime_1.jsx)(activeNav.Icon, { className: "h-4 w-4" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-sm font-bold text-slate-900", children: activeNav.label }), (0, jsx_runtime_1.jsx)("span", { className: "mx-2 text-slate-300", children: "/" }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-slate-500", children: activeNav.desc })] })] }), (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => {
                                        setQuickQuery("");
                                        setQuickJumpOpen(true);
                                    }, className: "inline-flex h-9 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-800", children: [(0, jsx_runtime_1.jsx)(icons_1.IconSearch, { className: "h-3.5 w-3.5 text-slate-400" }), (0, jsx_runtime_1.jsx)("span", { children: "\u067E\u0631\u0634 \u0633\u0631\u06CC\u0639 \u0628\u0647 \u0628\u062E\u0634\u200C\u0647\u0627\u2026" }), (0, jsx_runtime_1.jsxs)("kbd", { className: "inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500", dir: "ltr", children: [(0, jsx_runtime_1.jsx)(icons_1.IconCommand, { className: "h-2.5 w-2.5" }), "K"] })] })] }), (0, jsx_runtime_1.jsx)("header", { className: "safe-top sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md lg:hidden", children: (0, jsx_runtime_1.jsxs)("div", { className: "flex h-14 items-center gap-2 px-3", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setDrawerOpen(true), "aria-label": "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0645\u0646\u0648", "aria-expanded": drawerOpen, className: "btn-icon h-11 w-11", children: (0, jsx_runtime_1.jsx)(icons_1.IconMenu, { className: "h-5 w-5" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 flex-1 items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-xs", children: (0, jsx_runtime_1.jsx)(icons_1.IconBolt, { className: "h-4 w-4" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "min-w-0", children: [(0, jsx_runtime_1.jsx)("div", { className: "truncate text-sm font-extrabold text-slate-900", children: activeNav.label }), (0, jsx_runtime_1.jsx)("div", { className: "truncate text-[10px] text-slate-400", children: "\u0642\u06CC\u0645\u062A\u200C\u06AF\u0630\u0627\u0631 \u0647\u0648\u0634\u0645\u0646\u062F" })] })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => {
                                            setQuickQuery("");
                                            setQuickJumpOpen(true);
                                        }, "aria-label": "\u062C\u0633\u062A\u062C\u0648\u06CC \u0633\u0631\u06CC\u0639 \u0628\u062E\u0634\u200C\u0647\u0627", className: "btn-icon h-10 w-10", children: (0, jsx_runtime_1.jsx)(icons_1.IconSearch, { className: "h-4 w-4" }) })] }) }), !authEnabled && !devBannerDismissed && ((0, jsx_runtime_1.jsx)("div", { className: "border-b border-amber-200 bg-amber-50 px-3.5 py-2 text-xs leading-6 text-amber-900 sm:px-6 lg:px-8", children: (0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-between gap-2", children: [(0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 flex-1 break-words", children: [(0, jsx_runtime_1.jsx)("span", { className: "ml-1.5 inline-flex translate-y-0.5 items-center text-amber-700", children: (0, jsx_runtime_1.jsx)(icons_1.IconShield, { className: "h-4 w-4" }) }), "\u062D\u0627\u0644\u062A \u062A\u0648\u0633\u0639\u0647 \u0628\u062F\u0648\u0646 \u0631\u0645\u0632 (", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: "ALLOW_INSECURE_DEV_AUTH=true" }), ") \u0641\u0639\u0627\u0644 \u0627\u0633\u062A \u2014 \u0628\u0631\u0627\u06CC \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0642\u0641\u0644 Fail-Closed\u060C \u0645\u062A\u063A\u06CC\u0631\u0647\u0627\u06CC", " ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: "ADMIN_PASSWORD" }), " \u0648", " ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: "SESSION_SECRET" }), " \u0631\u0627 \u062F\u0631 \u0641\u0627\u06CC\u0644 ", (0, jsx_runtime_1.jsx)("code", { dir: "ltr", className: "rounded bg-amber-100 px-1", children: ".env" }), " \u062A\u0646\u0638\u06CC\u0645 \u06A9\u0646\u06CC\u062F."] }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => writeSessionFlag("cp-dev-banner-dismissed", true), "aria-label": "\u0628\u0633\u062A\u0646 \u0647\u0634\u062F\u0627\u0631 \u062D\u0627\u0644\u062A \u062A\u0648\u0633\u0639\u0647", className: "shrink-0 rounded-lg p-1 text-amber-700 transition hover:bg-amber-100", children: (0, jsx_runtime_1.jsx)(icons_1.IconClose, { className: "h-3.5 w-3.5" }) })] }) })), (0, jsx_runtime_1.jsx)("main", { className: "pb-nav-safe mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-3.5 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:py-7", children: children })] }), (0, jsx_runtime_1.jsx)("nav", { "aria-label": "\u0645\u0646\u0648\u06CC \u0633\u0631\u06CC\u0639 \u0645\u0648\u0628\u0627\u06CC\u0644", className: "safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-md lg:hidden", children: (0, jsx_runtime_1.jsxs)("div", { className: "grid grid-cols-5", children: [BOTTOM_NAV_HREFS.map((href) => {
                                const item = NAV.find((n) => n.href === href);
                                const active = isActive(pathname, item.href);
                                return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: item.href, "aria-current": active ? "page" : undefined, className: `flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition active:bg-slate-100 ${active ? "font-bold text-indigo-600" : "font-medium text-slate-500"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `flex h-7 w-12 items-center justify-center rounded-full transition ${active ? "bg-indigo-50 text-indigo-600" : ""}`, children: (0, jsx_runtime_1.jsx)(item.Icon, { className: "h-5 w-5" }) }), (0, jsx_runtime_1.jsx)("span", { className: "truncate max-w-full", children: item.shortLabel })] }, item.href));
                            }), (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => setDrawerOpen(true), "aria-expanded": drawerOpen, className: `flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition active:bg-slate-100 ${isOverflowRouteActive || drawerOpen ? "font-bold text-indigo-600" : "font-medium text-slate-500"}`, children: [(0, jsx_runtime_1.jsx)("span", { className: `flex h-7 w-12 items-center justify-center rounded-full transition ${isOverflowRouteActive || drawerOpen ? "bg-indigo-50 text-indigo-600" : ""}`, children: (0, jsx_runtime_1.jsx)(icons_1.IconMore, { className: "h-5 w-5" }) }), (0, jsx_runtime_1.jsx)("span", { children: "\u0628\u06CC\u0634\u062A\u0631" })] })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: `fixed inset-0 z-50 lg:hidden ${drawerOpen ? "visible" : "invisible pointer-events-none delay-300"}`, "aria-hidden": !drawerOpen, children: [(0, jsx_runtime_1.jsx)("div", { onClick: () => setDrawerOpen(false), className: `absolute inset-0 bg-slate-900/55 backdrop-blur-[2px] transition-opacity duration-300 ${drawerOpen ? "opacity-100" : "opacity-0"}` }), (0, jsx_runtime_1.jsxs)("aside", { onTouchStart: (e) => {
                                touchStartX.current = e.touches[0]?.clientX ?? null;
                            }, onTouchMove: (e) => {
                                if (touchStartX.current == null)
                                    return;
                                const deltaX = (e.touches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
                                if (deltaX > 0)
                                    setDragOffset(Math.min(deltaX, 280));
                            }, onTouchEnd: () => {
                                if (dragOffset > 72) {
                                    setDrawerOpen(false);
                                }
                                touchStartX.current = null;
                                setDragOffset(0);
                            }, style: dragOffset > 0 ? { transform: `translateX(${dragOffset}px)`, transition: "none" } : undefined, className: `safe-top safe-bottom absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${drawerOpen ? "translate-x-0" : "translate-x-full"}`, role: "dialog", "aria-modal": "true", "aria-label": "\u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between border-b border-slate-100", children: [(0, jsx_runtime_1.jsx)(Brand, {}), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: () => setDrawerOpen(false), "aria-label": "\u0628\u0633\u062A\u0646 \u0645\u0646\u0648", className: "btn-icon ml-3 h-9 w-9", children: (0, jsx_runtime_1.jsx)(icons_1.IconClose, { className: "h-4 w-4" }) })] }), (0, jsx_runtime_1.jsx)("div", { className: "flex-1 overflow-y-auto overscroll-contain", children: (0, jsx_runtime_1.jsx)(NavList, { pathname: pathname, onNavigate: () => setDrawerOpen(false) }) }), logout(false)] })] }), (0, jsx_runtime_1.jsx)(ui_1.ModalSheet, { open: quickJumpOpen, onClose: () => setQuickJumpOpen(false), title: "\u067E\u0631\u0634 \u0633\u0631\u06CC\u0639 \u0628\u06CC\u0646 \u0628\u062E\u0634\u200C\u0647\u0627", subtitle: "\u0628\u062E\u0634 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06CC\u0627 \u0639\u0628\u0627\u0631\u062A \u0631\u0627 \u062A\u0627\u06CC\u067E \u06A9\u0646\u06CC\u062F", maxWidth: "sm", children: (0, jsx_runtime_1.jsxs)("div", { className: "space-y-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "relative", children: [(0, jsx_runtime_1.jsx)(icons_1.IconSearch, { className: "pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" }), (0, jsx_runtime_1.jsx)("input", { autoFocus: true, className: "input pr-10", placeholder: "\u062C\u0633\u062A\u062C\u0648 \u062F\u0631 \u0645\u0646\u0648\u0647\u0627 (\u0645\u062B\u0644\u0627\u064B \u0645\u062D\u0635\u0648\u0644\u0627\u062A\u060C \u062A\u0646\u0638\u06CC\u0645\u0627\u062A\u060C \u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632)\u2026", value: quickQuery, onChange: (e) => setQuickQuery(e.target.value), onKeyDown: (e) => {
                                            if (e.key === "Enter" && filteredNav[0]) {
                                                router.push(filteredNav[0].href);
                                                setQuickJumpOpen(false);
                                            }
                                        } })] }), (0, jsx_runtime_1.jsxs)("div", { className: "space-y-1", children: [filteredNav.map(({ href, label, desc, Icon }) => {
                                        const active = isActive(pathname, href);
                                        return ((0, jsx_runtime_1.jsxs)(link_1.default, { href: href, onClick: () => setQuickJumpOpen(false), className: `flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-indigo-50 font-semibold text-indigo-700" : "hover:bg-slate-50 text-slate-700"}`, children: [(0, jsx_runtime_1.jsx)(Icon, { className: `h-5 w-5 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}` }), (0, jsx_runtime_1.jsxs)("span", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsx)("span", { className: "block truncate", children: label }), (0, jsx_runtime_1.jsx)("span", { className: "block truncate text-xs font-normal text-slate-400", children: desc })] }), active && (0, jsx_runtime_1.jsx)("span", { className: "badge bg-indigo-100 text-indigo-700", children: "\u0641\u0639\u0644\u06CC" })] }, href));
                                    }), filteredNav.length === 0 && ((0, jsx_runtime_1.jsx)("div", { className: "py-6 text-center text-xs text-slate-400", children: "\u0645\u0648\u0631\u062F\u06CC \u0628\u0627 \u0627\u06CC\u0646 \u0639\u0646\u0648\u0627\u0646 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F." }))] })] }) })] }) }));
}
