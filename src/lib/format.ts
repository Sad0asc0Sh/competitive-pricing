export const toman = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("fa-IR")} تومان`);
export const faNum = (n: number | null | undefined, digits = 0) => (n == null ? "—" : Number(n).toLocaleString("fa-IR", { maximumFractionDigits: digits }));
export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${Number(n).toLocaleString("fa-IR", { maximumFractionDigits: digits })}٪`);
export const faDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";

export const statusLabel: Record<string, string> = {
  applied: "اعمال شد",
  pending_review: "در انتظار بازبینی",
  rejected: "رد شد",
  failed: "ناموفق",
  skipped: "رد شد",
  active: "فعال",
  paused: "متوقف",
  needs_review: "نیاز به بازبینی",
  running: "در حال اجرا",
  done: "پایان یافته",
};

export const statusColor: Record<string, string> = {
  applied: "bg-emerald-100 text-emerald-800",
  pending_review: "bg-amber-100 text-amber-800",
  rejected: "bg-slate-200 text-slate-700",
  failed: "bg-rose-100 text-rose-800",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-slate-200 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  running: "bg-sky-100 text-sky-800",
  done: "bg-emerald-100 text-emerald-800",
};

export const campaignLabel: Record<string, string> = {
  flash: "لحظه‌ای",
  featured: "منتخب / شگفت‌انگیز",
  none: "بدون کمپین",
};

export const strategyLabel: Record<string, string> = {
  rank1_undercut: "رتبه اول (زیر کف معتبر)",
  match_lowest: "برابر کف",
  reference: "قیمت مرجع بازار",
  cost_plus: "تمام‌شده + سود",
  no_data: "بدون داده",
};
