"use strict";
"use client";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = LoginPage;
var _navigation = require("next/navigation");
var _react = require("react");
var _icons = require("@/components/icons");
function LoginForm() {
  const router = (0, _navigation.useRouter)();
  const search = (0, _navigation.useSearchParams)();
  const next = search.get("next") || "/";
  const [password, setPassword] = (0, _react.useState)("");
  const [err, setErr] = (0, _react.useState)(null);
  const [pending, start] = (0, _react.useTransition)();
  const submit = e => {
    e.preventDefault();
    start(async () => {
      setErr(null);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password
        })
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
  return <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-200">
            <_icons.IconBolt className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-extrabold text-slate-900">ورود به پنل قیمت‌گذار هوشمند</h1>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <_icons.IconShield className="h-3.5 w-3.5" />
            این بخش فقط برای مدیر سیستم است
          </p>
        </div>
        <label className="label" htmlFor="admin-password">
          رمز عبور مدیر
        </label>
        <input id="admin-password" type="password" autoComplete="current-password" className="input" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
        {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <button type="submit" className="btn-primary mt-5 w-full py-2.5" disabled={pending || !password}>
          {pending ? "در حال بررسی…" : "ورود"}
        </button>
      </form>
    </div>;
}
function LoginPage() {
  return <_react.Suspense>
      <LoginForm />
    </_react.Suspense>;
}