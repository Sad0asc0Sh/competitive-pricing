"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[panel] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto my-8 max-w-xl">
      <div className="card space-y-4 border-rose-200 bg-white">
        <div className="space-y-1.5">
          <span className="badge bg-rose-100 text-rose-800">خطای سرور</span>
          <h1 className="text-lg font-extrabold text-slate-900">بارگذاری این صفحه با خطا متوقف شد</h1>
          <p className="text-sm leading-6 text-slate-600">
            خطایی هنگام پردازش اطلاعات در سرور رخ داد. در صورت تکرار پس از به‌روزرسانی سامانه، اتصال پایگاه‌داده، اجرای
            مهاجرت‌های دیتابیس (<code dir="ltr">npm run db:migrate</code>) و لاگ سرور را بررسی کنید.
          </p>
        </div>

        {error?.digest && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            کد پیگیری سرور: <code dir="ltr" className="font-mono font-semibold text-slate-800">{error.digest}</code>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => reset()} className="btn-primary">
            تلاش مجدد
          </button>
          <button type="button" onClick={() => window.location.reload()} className="btn-secondary">
            بارگذاری کامل صفحه
          </button>
          <Link href="/" className="btn-secondary">
            بازگشت به داشبورد
          </Link>
        </div>
      </div>
    </div>
  );
}
