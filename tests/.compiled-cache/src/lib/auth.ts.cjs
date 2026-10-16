"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SESSION_COOKIE = void 0;
exports.createSessionToken = createSessionToken;
exports.isAuthEnabled = isAuthEnabled;
exports.isValidSessionToken = isValidSessionToken;
/**
 * احراز هویت ساده مدیر پنل — بدون دیتابیس و بدون وابستگی خارجی.
 *
 * فعال‌سازی: کافی است متغیر محیطی ADMIN_PASSWORD روی سرور تنظیم شود.
 * تا وقتی این متغیر خالی است، پنل باز می‌ماند (سازگاری با دیپلوهای قبلی)
 * و بنر هشدار در بالای پنل نمایش داده می‌شود؛ به‌محض تنظیم آن، همه صفحات
 * و APIها (به‌جز لاگین، سلامت و اندپوینت‌های کرونِ دارای سکرت جدا) قفل می‌شوند.
 *
 * نشست: کوکی httpOnly که مقدارش HMAC-SHA256 روی یک پیام ثابت است؛ کلید HMAC
 * از AUTH_SECRET (یا در نبودش CRON_SECRET / خود ADMIN_PASSWORD) ساخته می‌شود،
 * پس با چرخش هرکدام از این سکرت‌ها همه نشست‌ها باطل می‌شوند.
 */

const SESSION_COOKIE = "pricing_admin_session";
exports.SESSION_COOKIE = SESSION_COOKIE;
const SESSION_MESSAGE = "pricing-admin-session-v1";
function isAuthEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0);
}
function authSecret() {
  return process.env.AUTH_SECRET || process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "";
}
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function createSessionToken() {
  return hmacHex(authSecret(), SESSION_MESSAGE);
}
async function isValidSessionToken(token) {
  if (!token || !isAuthEnabled()) return false;
  const expected = await createSessionToken();
  if (token.length !== expected.length) return false;
  // مقایسه ثابت‌زمان ساده (هر دو رشته هگز هم‌طول‌اند)
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}