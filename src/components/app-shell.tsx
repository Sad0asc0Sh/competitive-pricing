"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconBolt,
  IconCampaigns,
  IconClose,
  IconDashboard,
  IconDocs,
  IconLogout,
  IconMenu,
  IconProducts,
  IconReview,
  IconRuns,
  IconSettings,
  IconShield,
  IconSimulate,
} from "./icons";

const NAV = [
  { href: "/", label: "داشبورد", desc: "نمای کلی و آخرین تصمیم‌ها", Icon: IconDashboard },
  { href: "/products", label: "محصولات", desc: "کارت‌های محصول و استعلام", Icon: IconProducts },
  { href: "/review", label: "بازبینی", desc: "صف تأیید انسانی", Icon: IconReview },
  { href: "/runs", label: "اجراها", desc: "تاریخچه استعلام‌ها", Icon: IconRuns },
  { href: "/campaigns", label: "کمپین‌های تخفیف", desc: "۳ سیستم تخفیف فروشگاه", Icon: IconCampaigns },
  { href: "/settings", label: "تنظیمات موتور", desc: "پروفایل، زمان‌بندی، اتصال", Icon: IconSettings },
  { href: "/simulate", label: "شبیه‌ساز", desc: "آزمایشگاه کف و سقف بازار", Icon: IconSimulate },
  { href: "/docs", label: "منطق سیستم", desc: "مستندات موتور قیمت‌گذاری", Icon: IconDocs },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="ناوبری اصلی">
      {NAV.map(({ href, label, desc, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
              active
                ? "bg-indigo-600 font-semibold text-white shadow-sm shadow-indigo-200"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-indigo-500"}`} />
            <span className="min-w-0">
              <span className="block truncate">{label}</span>
              <span className={`block truncate text-[11px] font-normal ${active ? "text-indigo-100" : "text-slate-400"}`}>{desc}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200">
        <IconBolt className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-extrabold text-slate-900">قیمت‌گذار هوشمند</span>
        <span className="block truncate text-[11px] text-slate-500">Torob-driven Pricing Engine</span>
      </span>
    </div>
  );
}

export function AppShell({ children, authEnabled }: { children: ReactNode; authEnabled: boolean }) {
  const pathname = usePathname() ?? "/";
  const [drawerOpen, setDrawerOpen] = useState(false);

  // با هر جابه‌جایی بین صفحات، دراور موبایل بسته شود
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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

  // صفحه ورود پوسته ندارد
  if (pathname === "/login") return <>{children}</>;

  const logout = authEnabled ? (
    <form action="/api/auth/logout" method="post" className="p-3 pt-0">
      <button
        type="submit"
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
      >
        <IconLogout className="h-5 w-5 shrink-0" />
        خروج از پنل
      </button>
    </form>
  ) : null;

  return (
    <div className="flex min-h-screen">
      {/* سایدبار دسکتاپ */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-100">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavList pathname={pathname} />
        </div>
        {logout}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* تاپ‌بار موبایل / تبلت با دکمه همبرگری */}
        <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="باز کردن منو"
            aria-expanded={drawerOpen}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-slate-50 active:bg-slate-100"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
              <IconBolt className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-extrabold text-slate-900">قیمت‌گذار هوشمند</span>
          </span>
          <span className="mr-auto truncate text-xs font-medium text-slate-400">
            {NAV.find((n) => isActive(pathname, n.href))?.label ?? ""}
          </span>
        </header>

        {!authEnabled && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-6 text-amber-800 md:px-8">
            <span className="ml-1 inline-flex translate-y-0.5 items-center">
              <IconShield className="h-4 w-4" />
            </span>
            ورود مدیر تنظیم نشده است — برای واقعی و امن‌کردن پنل، متغیر <code dir="ltr" className="rounded bg-amber-100 px-1">ADMIN_PASSWORD</code> را
            در فایل <code dir="ltr" className="rounded bg-amber-100 px-1">.env</code> سرور تنظیم و سرویس را ری‌استارت کنید.
          </div>
        )}

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6 md:p-8">{children}</main>
      </div>

      {/* دراور موبایل (منوی همبرگری) — از سمت راست (RTL) */}
      <div className={`fixed inset-0 z-50 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`} aria-hidden={!drawerOpen}>
        <div
          onClick={() => setDrawerOpen(false)}
          className={`absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-300 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          className={`absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
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
              className="ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </div>
          {logout}
        </aside>
      </div>
    </div>
  );
}
