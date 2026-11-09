"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategyLabel = exports.badgeThemeLabel = exports.campaignColor = exports.campaignLabel = exports.statusColor = exports.statusLabel = exports.faDate = exports.pct = exports.faNum = exports.toman = void 0;
const toman = (n) => (n == null ? "—" : `${Math.round(n).toLocaleString("fa-IR")} تومان`);
exports.toman = toman;
const faNum = (n, digits = 0) => (n == null ? "—" : Number(n).toLocaleString("fa-IR", { maximumFractionDigits: digits }));
exports.faNum = faNum;
const pct = (n, digits = 1) => (n == null ? "—" : `${Number(n).toLocaleString("fa-IR", { maximumFractionDigits: digits })}٪`);
exports.pct = pct;
const faDate = (d) => d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";
exports.faDate = faDate;
exports.statusLabel = {
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
exports.statusColor = {
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
exports.campaignLabel = {
    flash: "پیشنهاد لحظه‌ای (صفحه اصلی)",
    featured: "پیشنهاد شگفت‌انگیز (صفحه اصلی)",
    timed_sale: "فرصت زمان‌دار (مالی و تخفیف / منتخب‌ها)",
    none: "بدون کمپین",
    auto: "تشخیص خودکار موتور",
};
exports.campaignColor = {
    flash: "bg-amber-100 text-amber-900 border-amber-300",
    featured: "bg-rose-100 text-rose-800 border-rose-300",
    timed_sale: "bg-emerald-100 text-emerald-900 border-emerald-300",
    none: "bg-slate-100 text-slate-600 border-slate-200",
};
exports.badgeThemeLabel = {
    "green-orange": "سبز - نارنجی (فروش ویژه)",
    "gold-red": "طلایی - قرمز (پیشنهاد لحظه‌ای)",
    "red-purple": "قرمز - بنفش (جشنواره / شگفت‌انگیز)",
};
exports.strategyLabel = {
    national_rank1_undercut: "رتبه ۱ کل ترب و مشهد",
    local_city_rank1_undercut: "رتبه ۱ شهر مشهد",
    local_cluster_rank1: "صدر گروه فروشندگان مشهد",
    national_cluster_rank1: "صدر گروه فروشندگان ترب (سود کم، فروش زیاد)",
    high_trust_cluster_rank1: "صدر فروشندگان خوش‌امتیاز ترب",
    local_monopoly_leader: "تک‌فروشنده برتر مشهد",
    market_maker_consensus: "قیمت‌گذار معیار بازار (کشف هوشمند بدون لیست خرید)",
    volume_floor_min_margin: "کف مجاز تامین (بیشترین فروش بدون ضرر)",
    rank1_undercut: "رتبه اول (زیر کف معتبر)",
    match_lowest: "برابر کف",
    reference: "قیمت مرجع بازار",
    cost_plus: "تمام‌شده همکار + سود هدف",
    no_data: "بدون داده",
};
