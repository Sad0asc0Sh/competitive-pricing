"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  IconBolt,
  IconCampaigns,
  IconClose,
  IconCommand,
  IconDashboard,
  IconDocs,
  IconLogout,
  IconMenu,
  IconMore,
  IconPanelCollapse,
  IconPanelExpand,
  IconProducts,
  IconReview,
  IconRuns,
  IconSearch,
  IconSettings,
  IconShield,
  IconSimulate,
} from "./icons";
import { ModalSheet, ToastProvider } from "./ui";

const NAV = [
  { href: "/", label: "داشبورد", shortLabel: "داشبورد", desc: "نمای کلی و آخرین تصمیم‌ها", Icon: IconDashboard },
  { href: "/products", label: "محصولات", shortLabel: "محصولات", desc: "کارت‌های محصول و استعلام", Icon: IconProducts },
  { href: "/review", label: "بازبینی", shortLabel: "بازبینی", desc: "صف تأیید انسانی", Icon: IconReview },
  { href: "/runs", label: "اجراها", shortLabel: "اجراها", desc: "تاریخچه استعلام‌ها", Icon: IconRuns },
  { href: "/campaigns", label: "کمپین‌های تخفیف", shortLabel: "کمپین‌ها", desc: "۳ سیستم تخفیف فروشگاه", Icon: IconCampaigns },
  { href: "/settings", label: "تنظیمات موتور", shortLabel: "تنظیمات", desc: "پروفایل، زمان‌بندی، اتصال", Icon: IconSettings },
  { href: "/simulate", label: "شبیه‌ساز", shortLabel: "شبیه‌ساز", desc: "آزمایشگاه کف و سقف بازار", Icon: IconSimulate },
  { href: "/docs", label: "منطق سیستم", shortLabel: "مستندات", desc: "مستندات موتور قیمت‌گذاری", Icon: IconDocs },
] as const;

const BOTTOM_NAV_HREFS = ["/", "/products", "/review", "/campaigns"] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener("cp-ui-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("cp-ui-storage", cb);
  };
}

function readLocalFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeLocalFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
    window.dispatchEvent(new Event("cp-ui-storage"));
  } catch {
    // ignore storage errors
  }
}

function readSessionFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, value: boolean) {
  try {
    window.sessionStorage.setItem(key, value ? "1" : "0");
    window.dispatchEvent(new Event("cp-ui-storage"));
  } catch {
    // ignore storage errors
  }
}

function NavList({
  pathname,
  collapsed = false,
  onNavigate,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className={`flex flex-col gap-1 ${collapsed ? "p-2" : "p-3"}`} aria-label="ناوبری اصلی">
      {NAV.map(({ href, label, desc, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? `${label} — ${desc}` : undefined}
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
              collapsed ? "justify-center px-2" : ""
            } ${
              active
                ? "bg-indigo-600 font-semibold text-white shadow-sm shadow-indigo-200"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-500"}`} />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate">{label}</span>
                <span className={`block truncate text-[11px] font-normal ${active ? "text-indigo-100" : "text-slate-400"}`}>
                  {desc}
                </span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${collapsed ? "justify-center px-3 py-4" : "px-4 py-4 sm:px-5"}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200">
        <IconBolt className="h-5 w-5" />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-base font-extrabold text-slate-900">قیمت‌گذار هوشمند</span>
          <span className="block truncate text-[11px] text-slate-500">Torob-driven Pricing Engine</span>
        </span>
      )}
    </div>
  );
}

export function AppShell({ children, authEnabled }: { children: ReactNode; authEnabled: boolean }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const sidebarCollapsed = useSyncExternalStore(
    subscribeStorage,
    () => readLocalFlag("cp-sidebar-collapsed"),
    () => false,
  );
  const devBannerDismissed = useSyncExternalStore(
    subscribeStorage,
    () => readSessionFlag("cp-dev-banner-dismissed"),
    () => false,
  );

  // با هر جابه‌جایی بین صفحات، دراور و جستجوی سریع بسته شوند
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (drawerOpen) setDrawerOpen(false);
    if (quickJumpOpen) setQuickJumpOpen(false);
    if (dragOffset !== 0) setDragOffset(0);
  }

  // قفل اسکرول بدنه + بستن با Escape وقتی دراور باز است
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  // کلید میانبر Ctrl+K / Cmd+K برای جستجوی سریع بین بخش‌ها
  useEffect(() => {
    if (pathname === "/login") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickQuery("");
        setQuickJumpOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  const activeNav = useMemo(() => NAV.find((n) => isActive(pathname, n.href)) ?? NAV[0], [pathname]);
  const isOverflowRouteActive = useMemo(
    () => !BOTTOM_NAV_HREFS.some((href) => isActive(pathname, href)),
    [pathname],
  );

  const filteredNav = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.desc.toLowerCase().includes(q) ||
        n.href.toLowerCase().includes(q),
    );
  }, [quickQuery]);

  // صفحه ورود پوسته ندارد اما ToastProvider دارد
  if (pathname === "/login") {
    return <ToastProvider>{children}</ToastProvider>;
  }

  const logout = (collapsed = false) =>
    authEnabled ? (
      <form action="/api/auth/logout" method="post" className={collapsed ? "p-2 pt-0" : "p-3 pt-0"}>
        <button
          type="submit"
          title={collapsed ? "خروج از پنل" : undefined}
          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 ${
            collapsed ? "justify-center px-2" : ""
          }`}
        >
          <IconLogout className="h-5 w-5 shrink-0" />
          {!collapsed && <span>خروج از پنل</span>}
        </button>
      </form>
    ) : null;

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        {/* سایدبار دسکتاپ با قابلیت جمع‌شدن */}
        <aside
          className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-l border-slate-200 bg-white transition-[width] duration-200 lg:flex ${
            sidebarCollapsed ? "w-[76px]" : "w-64"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100">
            <div className="min-w-0 flex-1">
              <Brand collapsed={sidebarCollapsed} />
            </div>
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => writeLocalFlag("cp-sidebar-collapsed", true)}
                aria-label="جمع کردن منوی کناری"
                title="جمع کردن منوی کناری"
                className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <IconPanelCollapse className="h-4 w-4" />
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <div className="flex justify-center border-b border-slate-100 py-2">
              <button
                type="button"
                onClick={() => writeLocalFlag("cp-sidebar-collapsed", false)}
                aria-label="باز کردن منوی کناری"
                title="باز کردن منوی کناری"
                className="flex h-9 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600"
              >
                <IconPanelExpand className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <NavList pathname={pathname} collapsed={sidebarCollapsed} />
          </div>
          {logout(sidebarCollapsed)}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* هدر دسکتاپ برای دسترسی سریع و نمایش صفحه فعال */}
          <header className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-8 backdrop-blur-md lg:flex">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <activeNav.Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <span className="text-sm font-bold text-slate-900">{activeNav.label}</span>
                <span className="mx-2 text-slate-300">/</span>
                <span className="text-xs text-slate-500">{activeNav.desc}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setQuickQuery("");
                setQuickJumpOpen(true);
              }}
              className="inline-flex h-9 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-xs text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-800"
            >
              <IconSearch className="h-3.5 w-3.5 text-slate-400" />
              <span>پرش سریع به بخش‌ها…</span>
              <kbd className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500" dir="ltr">
                <IconCommand className="h-2.5 w-2.5" />K
              </kbd>
            </button>
          </header>

          {/* تاپ‌بار موبایل / تبلت */}
          <header className="safe-top sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-md lg:hidden">
            <div className="flex h-14 items-center gap-2 px-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="باز کردن منو"
                aria-expanded={drawerOpen}
                className="btn-icon h-11 w-11"
              >
                <IconMenu className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-xs">
                  <IconBolt className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900">{activeNav.label}</div>
                  <div className="truncate text-[10px] text-slate-400">قیمت‌گذار هوشمند</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickQuery("");
                  setQuickJumpOpen(true);
                }}
                aria-label="جستجوی سریع بخش‌ها"
                className="btn-icon h-10 w-10"
              >
                <IconSearch className="h-4 w-4" />
              </button>
            </div>
          </header>

          {!authEnabled && !devBannerDismissed && (
            <div className="border-b border-amber-200 bg-amber-50 px-3.5 py-2 text-xs leading-6 text-amber-900 sm:px-6 lg:px-8">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 break-words">
                  <span className="ml-1.5 inline-flex translate-y-0.5 items-center text-amber-700">
                    <IconShield className="h-4 w-4" />
                  </span>
                  حالت توسعه بدون رمز (<code dir="ltr" className="rounded bg-amber-100 px-1">ALLOW_INSECURE_DEV_AUTH=true</code>) فعال است — برای فعال‌سازی قفل Fail-Closed، متغیرهای{" "}
                  <code dir="ltr" className="rounded bg-amber-100 px-1">ADMIN_PASSWORD</code> و{" "}
                  <code dir="ltr" className="rounded bg-amber-100 px-1">SESSION_SECRET</code> را در فایل <code dir="ltr" className="rounded bg-amber-100 px-1">.env</code> تنظیم کنید.
                </div>
                <button
                  type="button"
                  onClick={() => writeSessionFlag("cp-dev-banner-dismissed", true)}
                  aria-label="بستن هشدار حالت توسعه"
                  className="shrink-0 rounded-lg p-1 text-amber-700 transition hover:bg-amber-100"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          <main className="pb-nav-safe mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-3.5 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:py-7">
            {children}
          </main>
        </div>

        {/* نوار ناوبری پایین مخصوص اندروید و موبایل */}
        <nav
          aria-label="منوی سریع موبایل"
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-md lg:hidden"
        >
          <div className="grid grid-cols-5">
            {BOTTOM_NAV_HREFS.map((href) => {
              const item = NAV.find((n) => n.href === href)!;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition active:bg-slate-100 ${
                    active ? "font-bold text-indigo-600" : "font-medium text-slate-500"
                  }`}
                >
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                      active ? "bg-indigo-50 text-indigo-600" : ""
                    }`}
                  >
                    <item.Icon className="h-5 w-5" />
                  </span>
                  <span className="truncate max-w-full">{item.shortLabel}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition active:bg-slate-100 ${
                isOverflowRouteActive || drawerOpen ? "font-bold text-indigo-600" : "font-medium text-slate-500"
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                  isOverflowRouteActive || drawerOpen ? "bg-indigo-50 text-indigo-600" : ""
                }`}
              >
                <IconMore className="h-5 w-5" />
              </span>
              <span>بیشتر</span>
            </button>
          </div>
        </nav>

        {/* دراور موبایل (منوی همبرگری) — از سمت راست (RTL) با کشیدن برای بستن */}
        <div
          className={`fixed inset-0 z-50 lg:hidden ${
            drawerOpen ? "visible" : "invisible pointer-events-none delay-300"
          }`}
          aria-hidden={!drawerOpen}
        >
          <div
            onClick={() => setDrawerOpen(false)}
            className={`absolute inset-0 bg-slate-900/55 backdrop-blur-[2px] transition-opacity duration-300 ${
              drawerOpen ? "opacity-100" : "opacity-0"
            }`}
          />
          <aside
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchMove={(e) => {
              if (touchStartX.current == null) return;
              const deltaX = (e.touches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
              if (deltaX > 0) setDragOffset(Math.min(deltaX, 280));
            }}
            onTouchEnd={() => {
              if (dragOffset > 72) {
                setDrawerOpen(false);
              }
              touchStartX.current = null;
              setDragOffset(0);
            }}
            style={dragOffset > 0 ? { transform: `translateX(${dragOffset}px)`, transition: "none" } : undefined}
            className={`safe-top safe-bottom absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
              drawerOpen ? "translate-x-0" : "translate-x-full"
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="منوی اصلی"
          >
            <div className="flex items-center justify-between border-b border-slate-100">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="بستن منو"
                className="btn-icon ml-3 h-9 w-9"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
            {logout(false)}
          </aside>
        </div>

        {/* پنجره جستجو و پرش سریع به بخش‌ها */}
        <ModalSheet
          open={quickJumpOpen}
          onClose={() => setQuickJumpOpen(false)}
          title="پرش سریع بین بخش‌ها"
          subtitle="بخش مورد نظر را انتخاب یا عبارت را تایپ کنید"
          maxWidth="sm"
        >
          <div className="space-y-3">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                className="input pr-10"
                placeholder="جستجو در منوها (مثلاً محصولات، تنظیمات، شبیه‌ساز)…"
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredNav[0]) {
                    router.push(filteredNav[0].href);
                    setQuickJumpOpen(false);
                  }
                }}
              />
            </div>

            <div className="space-y-1">
              {filteredNav.map(({ href, label, desc, Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setQuickJumpOpen(false)}
                    className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                      active ? "bg-indigo-50 font-semibold text-indigo-700" : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{label}</span>
                      <span className="block truncate text-xs font-normal text-slate-400">{desc}</span>
                    </span>
                    {active && <span className="badge bg-indigo-100 text-indigo-700">فعلی</span>}
                  </Link>
                );
              })}
              {filteredNav.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400">موردی با این عنوان پیدا نشد.</div>
              )}
            </div>
          </div>
        </ModalSheet>
      </div>
    </ToastProvider>
  );
}
