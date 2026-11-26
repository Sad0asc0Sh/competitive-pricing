"use client";

import { IconBolt, IconEye, IconEyeOff, IconShield, IconSpinner } from "@/components/icons";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const authNotConfigured = search.get("error") === "auth_not_configured";
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setErr(null);
      try {
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
      } catch {
        setErr("خطا در ارتباط با سرور");
      }
    });
  };

  return (
    <div className="safe-top safe-bottom flex min-h-dvh items-center justify-center bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200">
            <IconBolt className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-extrabold text-slate-900">ورود به پنل قیمت‌گذار هوشمند</h1>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <IconShield className="h-3.5 w-3.5" />
            این بخش فقط برای مدیر سیستم است
          </p>
        </div>

        {authNotConfigured && (
          <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
            ⚠️ احراز هویت در حالت Fail-Closed قفل است: لطفاً متغیرهای <code dir="ltr">ADMIN_PASSWORD</code> و{" "}
            <code dir="ltr">SESSION_SECRET</code> را روی سرور تنظیم کنید.
          </p>
        )}

        <label className="label" htmlFor="admin-password">
          رمز عبور مدیر
        </label>
        <div className="relative">
          <input
            id="admin-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="input pl-11"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "مخفی کردن رمز عبور" : "نمایش رمز عبور"}
            className="absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
          </button>
        </div>

        {err && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

        <button type="submit" className="btn-primary mt-5 w-full" disabled={pending || !password}>
          {pending && <IconSpinner className="h-4 w-4" />}
          <span>{pending ? "در حال بررسی…" : "ورود به پنل"}</span>
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
