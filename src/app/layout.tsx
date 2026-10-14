import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "سامانه قیمت‌گذاری هوشمند",
  description: "اتوماسیون قیمت‌گذاری رقابتی بر اساس بازار ترب",
};

const nav = [
  { href: "/", label: "داشبورد" },
  { href: "/products", label: "محصولات" },
  { href: "/review", label: "بازبینی" },
  { href: "/runs", label: "اجراها" },
  { href: "/campaigns", label: "کمپین‌های تخفیف" },
  { href: "/settings", label: "تنظیمات موتور" },
  { href: "/simulate", label: "شبیه‌ساز" },
  { href: "/docs", label: "منطق سیستم" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-l border-slate-200 bg-white lg:block">
            <div className="border-b border-slate-200 px-5 py-5">
              <div className="text-lg font-bold text-slate-900">قیمت‌گذار هوشمند</div>
              <div className="mt-1 text-xs text-slate-500">Torob‑driven Pricing Engine</div>
            </div>
            <nav className="flex flex-col gap-1 p-3">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="whitespace-nowrap text-sm text-slate-700">
                  {n.label}
                </Link>
              ))}
            </header>
            <main className="flex-1 p-4 md:p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
