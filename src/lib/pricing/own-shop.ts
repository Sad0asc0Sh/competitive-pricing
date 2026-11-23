/**
 * تشخیص «پیشنهاد خودِ فروشگاه» در لیستینگ ترب (۴.۲.۱).
 *
 * چرا اهمیت دارد: فروشگاه خودمان هم در ترب فروشنده است. اگر پیشنهاد خودمان به‌عنوان «رقیب» شمرده شود،
 * موتور در هر اجرا قیمت جدیدِ خودش را می‌بیند و یک پلهٔ undercut دیگر زیرش می‌گذارد؛ یعنی مسابقهٔ کاهشی
 * با خودمان تا کف سود (اندازه‌گیری: tests/own-shop.test.cjs، «مسابقهٔ کاهشی»).
 *
 * قواعد:
 *  - مقایسه روی «کلید فشرده» انجام می‌شود (حروف فارسی/عربی یکسان، بدون فاصله/نیم‌فاصله/نقطه/خط‌تیره/اعراب،
 *    لاتین کوچک)؛ پس «EKG Kala»، «ekgkala.ir»، «ای‌کا‌جی‌کالا» و «ای.کا.جی کالا» یکی‌اند.
 *  - املاهای پرکاربرد برند همیشه (فارغ از پروفایل ذخیره‌شده در دیتابیس) به نام‌های پیکربندی اضافه می‌شوند؛
 *    پروفایل‌های قدیمی هم از اصلاح بهره می‌برند.
 *  - شناسهٔ فروشندهٔ ترب (`ownShopIds`) در صورت تنظیم، دقیق‌ترین راه است (برابری کامل کلید فشرده).
 *  - نام کوتاه‌تر از ۵ نویسهٔ فشرده برای زیررشته‌یابی استفاده نمی‌شود (جلوگیری از حذف رقیب بی‌گناه).
 */
import { normalizeFaText } from "./sourcing";

/** املاهای متداول برند «ای‌کا‌جی کالا / EKG Kala»؛ «کا» و «کی» هر دو در گفتار رایج‌اند. */
export const BUILTIN_OWN_SHOP_ALIASES: readonly string[] = [
  "sgeooole",
  "ekgkala",
  "ای کا جی کالا",
  "ای کی جی کالا",
  "ایکاجی کالا",
  "ایکیجی کالا",
];

const MIN_ALIAS_KEY_LENGTH = 5;

// اعراب، کشیده و علائم ترکیبی که در نام فروشگاه‌ها گاهی می‌آیند
const MARKS_RE = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** کلید فشرده: بدون فاصله/نشانه‌گذاری/نیم‌فاصله/اعراب، حروف یکسان‌سازی‌شده، lower-case. */
export function compactShopKey(value: unknown): string {
  return normalizeFaText(value)
    .replace(MARKS_RE, "")
    .replace(/ى/g, "ی") // ى (الف مقصوره) → ی
    .replace(/ۀ/g, "ه") // ۀ → ه
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface OwnShopCandidate {
  shopName?: string | null;
  shopId?: string | null;
}

export type OwnShopMatcher = ((o: OwnShopCandidate) => boolean) & {
  /** کلیدهای فشردهٔ نام‌های شناخته‌شده (برای لاگ/آزمون) */
  readonly aliasKeys: readonly string[];
  readonly idKeys: readonly string[];
};

/**
 * ساخت تشخیص‌دهندهٔ فروشگاه خودمان.
 * @param names نام‌های پیکربندی‌شده در پروفایل (`filters.ownShopNames`)؛ املاهای داخلی همیشه افزوده می‌شوند
 * @param ids   شناسهٔ فروشندهٔ ترب (`filters.ownShopIds`، اختیاری؛ برابری دقیقِ کلید فشرده)
 */
export function makeOwnShopMatcher(names: readonly string[] | undefined | null, ids?: readonly string[] | null): OwnShopMatcher {
  const aliasKeys = Array.from(
    new Set(
      [...BUILTIN_OWN_SHOP_ALIASES, ...(names ?? [])]
        .map((n) => compactShopKey(n))
        .filter((k) => k.length >= MIN_ALIAS_KEY_LENGTH),
    ),
  );
  const idKeys = Array.from(new Set((ids ?? []).map((i) => compactShopKey(i)).filter(Boolean)));

  const fn = ((o: OwnShopCandidate): boolean => {
    const nameKey = compactShopKey(o.shopName);
    const idKey = compactShopKey(o.shopId);
    if (idKey && idKeys.includes(idKey)) return true;
    if (nameKey && idKeys.includes(nameKey)) return true;
    for (const a of aliasKeys) {
      if ((nameKey && nameKey.includes(a)) || (idKey && idKey.includes(a))) return true;
    }
    return false;
  }) as OwnShopMatcher;
  Object.defineProperty(fn, "aliasKeys", { value: aliasKeys, enumerable: true });
  Object.defineProperty(fn, "idKeys", { value: idKeys, enumerable: true });
  return fn;
}

export interface PriceEchoReport {
  /** ارزان‌ترین پیشنهاد معتبر دقیقاً برابر یکی از قیمت‌های اخیرِ خودمان است */
  cheapestIsEcho: boolean;
  /** قیمت ارزان‌ترین پیشنهاد معتبر (در صورت وجود) */
  cheapestPrice: number | null;
  /** نام فروشگاه‌هایی که در آن قیمت هستند (برای افزودن به «نام فروشگاه خودمان» توسط مدیر) */
  shopNames: string[];
}

/**
 * «پژواک قیمت خودی»: پشتیبان دوم وقتی نام فروشگاه خودمان به‌درستی شناسایی نشده است.
 * اگر ارزان‌ترین پیشنهاد معتبر دقیقاً برابر قیمتی باشد که خودمان اخیراً داشته‌ایم (فعلی یا push‌شده)،
 * احتمالاً همان پیشنهاد خودمان است؛ اعمال خودکار نباید زیرش undercut کند (مسابقهٔ کاهشی).
 * برابری دقیق (تومان) لازم است؛ برای هم‌قیمتیِ اتفاقیِ یک رقیب، هزینهٔ این گارد فقط یک بازبینی انسانی است.
 */
export function detectOwnPriceEcho(
  offers: ReadonlyArray<{ price: number; included: boolean; shopName: string }>,
  ownRecentPrices: ReadonlyArray<number> | null | undefined,
): PriceEchoReport {
  const own = new Set(
    (ownRecentPrices ?? []).map((p) => Math.round(Number(p))).filter((p) => Number.isFinite(p) && p > 0),
  );
  const valid = offers.filter((o) => o.included && Number.isFinite(o.price) && o.price > 0);
  if (!valid.length || !own.size) return { cheapestIsEcho: false, cheapestPrice: valid.length ? Math.min(...valid.map((o) => o.price)) : null, shopNames: [] };
  const min = Math.min(...valid.map((o) => o.price));
  const atMin = valid.filter((o) => o.price === min);
  const isEcho = own.has(Math.round(min));
  return {
    cheapestIsEcho: isEcho,
    cheapestPrice: min,
    shopNames: isEcho ? Array.from(new Set(atMin.map((o) => o.shopName))).slice(0, 5) : [],
  };
}
