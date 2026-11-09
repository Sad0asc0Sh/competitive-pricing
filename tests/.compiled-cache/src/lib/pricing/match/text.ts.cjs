"use strict";
/**
 * نرمال‌سازی متن عنوان محصول (فارسی/عربی/انگلیسی) برای موتور تطابق v2.
 *
 * اصول:
 *  - ارقام فارسی/عربی → ASCII؛ حروف عربی (ي ك ة …) → فارسی؛ اعراب/کشیده حذف؛ نیم‌فاصله → فاصله.
 *  - در توکن‌ها فقط [a-z0-9 - _ / . +] و حروف فارسی می‌مانند (برای حفظ کدهای مدل مثل DS-7104NI-Q1/4P/M).
 *  - مرز بین فارسی و لاتین/عدد جدا می‌شود («2مگاپیکسل» → «2 مگاپیکسل»، «مدلDS-2CD» → «مدل DS-2CD»).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NUMBER_WORDS = void 0;
exports.toAsciiDigits = toAsciiDigits;
exports.normalizeText = normalizeText;
exports.tokenize = tokenize;
exports.numberFromToken = numberFromToken;
exports.clip = clip;
exports.isInternalOrDatabaseId = isInternalOrDatabaseId;
exports.readWordNumber = readWordNumber;
/** «+» انتهایی فقط در این استانداردها معنادار است (H.265+ ، PoE+) */
const KEEP_TRAILING_PLUS = /^(?:h\.?26[45]|poe|ac\d*|ax\d*)\+$/;
const FA_DIGIT_BASE = 0x06f0;
const AR_DIGIT_BASE = 0x0660;
/** تبدیل ارقام فارسی/عربی به ASCII */
function toAsciiDigits(input) {
    return input.replace(/[۰-۹٠-٩]/g, (ch) => {
        const code = ch.charCodeAt(0);
        return String(code >= FA_DIGIT_BASE ? code - FA_DIGIT_BASE : code - AR_DIGIT_BASE);
    });
}
/** اعداد حروفی فارسی که در عنوان کالا رایج‌اند («چهار کانال»، «دو مگاپیکسل») */
exports.NUMBER_WORDS = {
    یک: 1,
    دو: 2,
    سه: 3,
    چهار: 4,
    پنج: 5,
    شش: 6,
    هفت: 7,
    هشت: 8,
    نه: 9,
    ده: 10,
    یازده: 11,
    دوازده: 12,
    سیزده: 13,
    چهارده: 14,
    پانزده: 15,
    شانزده: 16,
    هفده: 17,
    هجده: 18,
    نوزده: 19,
    بیست: 20,
    سی: 30,
    چهل: 40,
    پنجاه: 50,
    شصت: 60,
    هفتاد: 70,
    هشتاد: 80,
    نود: 90,
    صد: 100,
};
/** «اچ دی ام آی» → hdmi و … (پس از نرمال‌سازی حروف: آ→ا) */
const ACRONYM_RULES = [
    [/(^|\s)ا[چ]\s*دی\s*ام\s*[ای]ی?(?=\s|$)/g, "$1hdmi"],
    [/(^|\s)ایکس\s*وی\s*ار(?=\s|$)/g, "$1xvr"],
    [/(^|\s)دی\s*وی\s*ار(?=\s|$)/g, "$1dvr"],
    [/(^|\s)ان\s*وی\s*ار(?=\s|$)/g, "$1nvr"],
    [/(^|\s)اچ\s*وی\s*ار(?=\s|$)/g, "$1hvr"],
    [/(^|\s)یو\s*اس\s*بی(?=\s|$)/g, "$1usb"],
    [/(^|\s)بی\s*ان\s*سی(?=\s|$)/g, "$1bnc"],
    [/(^|\s)اس\s*اس\s*دی(?=\s|$)/g, "$1ssd"],
    [/(^|\s)اچ\s*دی\s*دی(?=\s|$)/g, "$1hdd"],
    [/(^|\s)اس\s*دی(?=\s|$)/g, "$1sd"],
    [/(^|\s)ار\s*جی\s*(45)(?=\s|$)/g, "$1rj$2"],
    [/(^|\s)ار\s*جی\s*(\d{1,2})(?=\s|$)/g, "$1rg$2"],
    [/(^|\s)ای\s*پی(?!\s*سی)(?=\s|$)/g, "$1ip"],
];
function normalizeText(input) {
    if (input == null)
        return "";
    let s = String(input);
    if (!s)
        return "";
    try {
        s = s.normalize("NFKC");
    }
    catch {
        // محیط‌های بدون ICU کامل: ادامه بدون NFKC
    }
    s = toAsciiDigits(s)
        .replace(/٫/g, ".")
        .replace(/٬/g, "")
        .replace(/[يى]/g, "ی")
        .replace(/[كک]/g, "ک")
        .replace(/[ةۀ]/g, "ه")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ؤ/g, "و")
        .replace(/[ً-ٰٟـ]/g, "")
        .replace(/[​-‏‪-‮⁠﻿]/g, " ")
        .toLowerCase()
        // جداکننده‌های مرسوم قبل از حذف نویسه‌های غیرمجاز
        .replace(/[×✕]/g, " x ")
        .replace(/[–—−]/g, "-")
        .replace(/[،؛,;:|()\[\]{}«»"'“”‘’`~!?؟*#@^&=<>\\%$]/g, " ")
        // فقط حروف فارسی + [a-z0-9 - _ / . +]
        .replace(/[^a-z0-9؀-ۿ\-_/.+\s]/g, " ");
    // مرز فارسی ⇄ لاتین/عدد
    s = s
        .replace(/([؀-ۿ])([a-z0-9])/g, "$1 $2")
        .replace(/([a-z0-9])([؀-ۿ])/g, "$1 $2");
    // «+» جداافتاده (دوربین + هارد) نشانهٔ «همراه با» است؛ قبل از پاک‌سازی لبه‌ها به یک توکن تبدیل شود
    s = s.replace(/(^|\s)\+(?=\s|$)/g, "$1plus");
    // لبه‌های توکن: جداکننده‌های اضافی را بردار (نقطهٔ پایان جمله، خط تیرهٔ آویزان)
    s = s
        .split(/\s+/)
        .map((t) => {
        let u = t.replace(/^[-_/.+]+/, "").replace(/[-_/.]+$/, "");
        if (u.endsWith("+") && !KEEP_TRAILING_PLUS.test(u))
            u = u.replace(/\++$/, "");
        return u;
    })
        .filter(Boolean)
        .join(" ");
    // خط تیره بین دو حرف فارسی = فاصله (دی-نت ، تی-پی-لینک)
    s = s.replace(/([\u0600-\u06FF])-(?=[\u0600-\u06FF])/g, "$1 ").replace(/([\u0600-\u06FF])-(?=[\u0600-\u06FF])/g, "$1 ");
    // اختصارهای لاتینِ نوشته‌شده با حروف فارسی
    for (const [re, to] of ACRONYM_RULES)
        s = s.replace(re, to);
    // واژه‌های ترکیبی/املاهای رایج را یکسان کن
    s = s
        .replace(/مدار\s+بسته/g, "مداربسته")
        .replace(/سو[ئیی]*چ/g, "سوییچ")
        .replace(/هارد\s+دیسک/g, "هارددیسک")
        .replace(/\bhard\s+disk\b/g, "harddisk");
    return s.replace(/\s+/g, " ").trim();
}
function tokenize(norm) {
    return norm ? norm.split(" ") : [];
}
/** عدد از توکن (رقم یا عدد حروفی) */
function numberFromToken(tok) {
    if (!tok)
        return null;
    if (/^\d+(?:\.\d+)?$/.test(tok))
        return Number(tok);
    const w = exports.NUMBER_WORDS[tok];
    return w == null ? null : w;
}
/** نمایش کوتاه برای پیام‌ها */
function clip(s, n = 60) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
/** تشخیص شناسه‌های داخلی دیتابیس/فروشگاه که کد مدل سازنده نیستند (ObjectId مونگو، UUID، KY-0001234 …) */
function isInternalOrDatabaseId(token) {
    const clean = String(token ?? "").trim();
    if (!clean)
        return true;
    if (/^[a-f0-9]{24}$/i.test(clean))
        return true; // MongoDB ObjectId
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clean))
        return true; // UUID
    if (/^(ky|sku|prd|prod|product|id|item|code|ekg)[-_]?\d+(?:[-_]\d+)?$/i.test(clean))
        return true;
    if (/^(ky|ekg)[-_]?[a-f0-9]{5,8}$/i.test(clean))
        return true; // KY-A1B2C3 (شناسهٔ تولیدشدهٔ واردکننده)
    if (/^\d{1,9}$/.test(clean))
        return true; // SKU صرفاً عددی (۱۰۱۲، ۳، ۷ …)
    return false;
}
const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);
/**
 * خواندن عدد حروفیِ ترکیبی از توکن i: «سی و دو» → 32 ، «بیست و چهار» → 24 ، «صد و بیست و هشت» → 128 ، «شانزده» → 16.
 * خروجی: مقدار و تعداد توکن مصرف‌شده (null اگر عددی نیست).
 */
function readWordNumber(tokens, i) {
    const first = exports.NUMBER_WORDS[tokens[i]];
    if (first == null)
        return null;
    let value = first;
    let len = 1;
    const andNext = (k) => {
        if (tokens[i + k] !== "و")
            return null;
        const w = exports.NUMBER_WORDS[tokens[i + k + 1]];
        return w == null ? null : w;
    };
    if (first === 100) {
        // صد و بیست و هشت
        const a = andNext(len);
        if (a != null) {
            value += a;
            len += 2;
            if (TENS.has(a)) {
                const b = andNext(len);
                if (b != null && b < 10) {
                    value += b;
                    len += 2;
                }
            }
        }
        return { value, len };
    }
    if (TENS.has(first)) {
        const b = andNext(len);
        if (b != null && b < 10) {
            value += b;
            len += 2;
        }
    }
    return { value, len };
}
