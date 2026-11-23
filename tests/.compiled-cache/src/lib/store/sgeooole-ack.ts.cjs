"use strict";
/**
 * ۴.۲.۱ — تفسیر پاسخ اندپوینت `pricing-sync` فروشگاه sgeooole.
 *
 * بدون وابستگی به پایگاه داده و شبکه است تا بتوان آن را آزمون کرد (tests/store-ack.test.cjs)؛
 * `connectors.ts` فقط پاسخ HTTP را می‌گیرد و برای تصمیم‌گیری به این توابع می‌دهد.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpretSgeoooleDryRun = interpretSgeoooleDryRun;
exports.interpretSgeoooleAck = interpretSgeoooleAck;
/**
 * رد صریح dry-run (ok:false یا valid:false) ⇒ شکست push.
 * کد خطای فروشگاه داخل [] در پیام می‌آید تا در `price_decisions.push_error` قابل جست‌وجو باشد
 * (کوئری K4 در راهنمای پیاده‌سازی). پاسخ بدون بدنه یا پذیرفته ⇒ null (push اصلی ادامه می‌یابد).
 */
function interpretSgeoooleDryRun(res) {
    if (!res)
        return null;
    const tag = typeof res.code === "string" && res.code ? ` [${res.code}]` : "";
    const detail = res.message ?? res.reason ?? "دلیل نامشخص";
    if (res.ok === false)
        return { ok: false, message: `dry-run فروشگاه رد کرد${tag}: ${detail}` };
    if (res.valid === false)
        return { ok: false, message: `dry-run فروشگاه payload را نامعتبر دانست${tag}: ${detail}` };
    return null;
}
/**
 * تأیید حلقه‌بسته: اگر فروشگاه اعلام کرد «قیمت مؤثر» با قیمت تصمیم فرق دارد (کمپین/Sale دستی، گارد کف،
 * تنوع کانونیکال…) «اعمال موفق» گزارش نمی‌شود. فروشگاه‌های قدیمی‌تر که این فیلدها را نمی‌فرستند ⇒ null (رفتار قبلی).
 */
function interpretSgeoooleAck(ack, decidedPrice) {
    if (ack?.data?.effectiveMismatch !== true)
        return null;
    const eff = ack.data.effective;
    const fmt = (n) => n.toLocaleString("fa-IR");
    const effPart = typeof eff?.currentPrice === "number" && Number.isFinite(eff.currentPrice) ? `${fmt(eff.currentPrice)} تومان است` : "نامشخص است";
    return {
        ok: false,
        message: `sgeooole: قیمت ثبت شد ولی قیمت مؤثر برای مشتری/ترب ${effPart}، نه ${fmt(decidedPrice)} (منبع: ${eff?.source ?? "نامشخص"}) — احتمال کمپین/Sale دستی یا محصول متغیر؛ در فروشگاه بررسی کنید`,
    };
}
