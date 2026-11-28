/**
 * تجزیهٔ ساختاریافتهٔ عنوان محصول: برند، کدهای مدل، رده (head noun)، مشخصات تایپ‌شده، پک/استوک/کپی و واژه‌های توصیفی.
 */
import {
  analyzeTitleDescriptors,
  classifyDescriptorToken,
  DEFAULT_GROUP_TERMS,
  namedFamilyRootsCompatible,
  type ClassifiedDescriptors,
} from "./descriptors";
import {
  COMPANION_MARKERS,
  COMPAT_MARKERS,
  COUNTERFEIT_PHRASES,
  DEFECTIVE_PHRASES,
  GENERIC_WORDS,
  PACK_WORDS,
  QTY_UNIT_WORDS,
  STOPWORDS,
  USED_PHRASES,
  brandForCodePrefix,
  brandFromCodeShape,
  isAccessoryClass,
  scanBrands,
  scanClasses,
  scanFeatures,
  type ClassHit,
} from "./lexicon";
import { isInternalOrDatabaseId, normalizeText, numberFromToken, readWordNumber, tokenize } from "./text";

export interface ParsedCode {
  raw: string;
  /** حروف و ارقام بزرگ بدون جداکننده: DS2CD1023G0EI */
  canon: string;
  segs: string[];
  /** کد داخل بند «مناسب برای …» لوازم جانبی؛ هویت خود کالا نیست */
  inCompat: boolean;
  brandHint: string | null;
}

export type AttrValue = number | string;

export interface PackInfo {
  qty: number | null;
  word: string;
}

export interface ParsedTitle {
  norm: string;
  tokens: string[];
  brands: string[];
  impliedBrands: string[];
  family: "remotag" | null;
  evidenceConflicts?: string[];
  codes: ParsedCode[];
  head: ClassHit | null;
  hits: ClassHit[];
  features: Record<string, string[]>;
  attrs: Record<string, AttrValue[]>;
  pack: PackInfo | null;
  packageUnits?: number;
  used: string | null;
  counterfeit: string | null;
  /** Descriptive design/style qualifier like «طرح بنزی» that is not automatically counterfeit. */
  designStyle?: string | null;
  /** §5 سند رخداد — خانوادهٔ طراحی نام‌دار (توکن پس از «طرح» که صفت بازاریابی/ظاهری/جنس/رنگ نیست).
   * فقط از مجرای متنی «طرح X» (عنوان) یا کلید spec «طرح» می‌آید؛ واژه‌های خنثی («طرح لوکس/جدید/مات») خانواده نمی‌سازند. */
  designFamily?: string | null;
  defective: string | null;
  bundleWith: string[];
  withAccessories: string[];
  /** قطعه/لوازم جانبی که در انتهای عنوان پس از نام دستگاه اصلی آمده است (مثل «دوربین ... پایه دیواری» یا «کلید اتوماتیک ... کنتاکت کمکی») */
  trailingAccessory: string | null;
  words: string[];
  /** توصیف‌گرهای ساختاریافته (تبلیغاتی، ظاهری، رنگ، شکل، جنس، ناشناخته) با حفظ واژه‌های غیرکمرا مثل «رنگی» */
  descriptors?: ClassifiedDescriptors;
  /** واژه‌های توصیفی کامل شامل رنگ/جنسِ غیرفنی (مثلاً «رنگی» برای ریموت) جهت رده‌بندی حساس به دسته */
  descriptorWords?: string[];
  /** اطلاعات کمکی استخراج‌شده از مشخصات کارت (مثل باتری یا جنس بدنه) بدون تزریق تعارض اشتباه */
  specDescriptors?: string[];
}

// ───────────────────────────── کد مدل ─────────────────────────────

const SPEC_TOKEN_PATTERNS: RegExp[] = [
  /^\d+(?:\.\d+)?(?:mp|mm2|mm|cm|m|kv|mv|v|vdc|vac|ka|ma|mah|ah|a|kw|w|kva|va|kvar|uf|mf|hp|hz|khz|mhz|ghz|mbps|gbps|kbps|tb|gb|mb|kb|ch|p|k|x|inch|db|dbi|lux|fps|ohm|pin|port|ports|pole|poles|ph|phase|core|pcs|pc|pack)$/,
  /^\d+(?:\.\d+)?v[/-]\d+(?:\.\d+)?a$/,
  /^\d+-?(?:port|ports|pole|poles)$/,
  /^\d+(?:\.\d+)?-(?:hz|khz|mhz|ghz)$/,
  /^\d{1,2}-?(?:buttons?|keys?)$/,
  /^(?:[1-4]p(?:\+n)?|n\+[1-4]p|[13]ph|x\d{1,3})$/,
  /^(?:ir\d{1,3}m?|\d{1,2}led|led\d{1,2}|smd\d*|wdr\d*|dwdr|v\d(?:\.\d+)?|\d+db|\d+fps|\d+x)$/,
  /^(?:h\.?26[45]\+?|ip\d{2}[a-z]?|cat\.?\d[ae]?|rg-?\d{1,2}(?:\+\d)?|usb\d?(?:\.\d)?|sata\d?|poe\+?|hdmi\d?|wifi\d?|wi-fi\d?|ac\d{3,4}|ax\d{3,5}|n\d{3,4}|sfp\+?|ddr\d|nvme|m\.2|802\.11[a-z]*|\d+k|\d{3,4}p|hd-?tvi|hd-?cvi|ahd\d?|tvi\d?|cvi\d?|lte|[2-5]g|\d+x\d+(?:x\d+)?|\d+\/\d+(?:\/\d+)*)$/,
];

export function isSpecToken(tok: string): boolean {
  return SPEC_TOKEN_PATTERNS.some((re) => re.test(tok));
}

/** واژه‌هایی که با عدد/حرف بعدی ترکیب می‌شوند و کد مدل می‌سازند (Archer C6 ⇒ ARCHERC6 ، Note 12 ⇒ NOTE12) */
const SERIES_WORDS = new Set(["archer", "deco", "tapo", "hap", "note", "نوت", "buds"]);

/** پیشوندهای صنعتی/برند که گاه با فاصله از بخش بعدی کد نوشته می‌شوند (NSX 100F ، LC1D 18) */
const SPACED_CODE_PREFIXES = new Set(["ds", "ids", "dh", "dhi", "tl", "ipc", "hac", "nsx", "lc1d", "lc1f", "gv2", "gv3", "ic60", "ic60n", "ez9", "sm", "mz"]);

/** پسوندهای فنی کد مدل که گاه با فاصله از بدنهٔ کد نوشته می‌شوند (DS 2CE16H0T ITPF) */
const MODEL_SUFFIX_TOKENS = new Set([
  "itpf", "itpfs", "itmfs", "itmf", "irpf", "irmf", "ipf", "imf",
  "it1f", "it3f", "it5f", "it1", "it3", "it5", "exipf", "lpf", "lpfs",
  "izs", "iz", "s2", "s3", "s4", "s5",
]);

/** پیشوندهای خطِ محصول که فروشندگان اغلب حذف می‌کنند (DS- ، DH- ، DHI- ، TL- ، IPC- ، HAC-) و ترکیب‌شان (DH-IPC- ، DH-HAC-) */
const ALIAS_PREFIX_WORDS = ["IDS", "DHI", "DS", "DH", "TL", "IPC", "HAC"];

export function isAliasPrefix(prefix: string): boolean {
  const u = prefix.toUpperCase();
  if (!u || u.length > 8) return false;
  // تجزیهٔ u به دنبالهٔ واژه‌های پیشوند (حداکثر ۲ تکه)
  const rec = (rest: string, depth: number): boolean => {
    if (!rest) return true;
    if (depth >= 2) return false;
    return ALIAS_PREFIX_WORDS.some((w) => rest.startsWith(w) && rec(rest.slice(w.length), depth + 1));
  };
  return rec(u, 0);
}

function alnumCount(s: string): number {
  return s.replace(/[^a-z0-9]/g, "").length;
}

function looksLikeCode(tok: string): boolean {
  if (!/^[a-z0-9][a-z0-9\-_/.+]*$/.test(tok)) return false;
  if (!/[a-z]/.test(tok) || !/\d/.test(tok)) return false;
  if (alnumCount(tok) < 3) return false;
  if (isSpecToken(tok)) return false;
  if (/^(?:www|http|https)/.test(tok)) return false;
  return true;
}

function makeCode(raw: string, inCompat: boolean): ParsedCode {
  const canon = raw.replace(/[^a-z0-9]/g, "").toUpperCase();
  const segs = raw
    .split(/[-_/.]/)
    .map((s) => s.replace(/[^a-z0-9+]/g, "").toUpperCase())
    .filter(Boolean);
  let brandHint: string | null = null;
  const first = segs[0]?.toLowerCase();
  if (first && segs.length >= 2 && isAliasPrefix(first)) brandHint = brandForCodePrefix(first) ?? null;
  if (!brandHint) brandHint = brandFromCodeShape(raw.replace(/[^a-z0-9]/g, "")) ?? null;
  // کد بدون جداکننده با پیشوند شناخته‌شده: DS2CD1023… ، DHIPC… — فقط راهنمای برند، نه جداسازی
  if (!brandHint) {
    const m = /^(ds|ids|dhi|dh|tl)(?=[a-z]*\d)/.exec(raw.replace(/[^a-z0-9]/g, ""));
    if (m && canon.length >= 8) brandHint = brandForCodePrefix(m[1]) ?? null;
  }
  return { raw, canon, segs, inCompat, brandHint };
}

// ───────────────────────────── واحدها و مشخصات ─────────────────────────────

const UNIT_SOURCE: Record<string, string[]> = {
  mp: ["mp", "مگاپیکسل", "مگاپیکسلی", "مگا", "مگ", "megapixel"],
  ch: ["ch", "channel", "channels", "کانال", "کانالی", "کاناله"],
  tb: ["tb", "ترابایت", "ترابایتی", "ترا", "terabyte"],
  gb: ["gb", "گیگابایت", "گیگابایتی", "گیگ", "gigabyte"],
  port: ["port", "ports", "پورت", "پورتی", "پورته"],
  v: ["v", "ولت", "ولتی", "volt", "vdc", "vac"],
  a: ["a", "آمپر", "امپر", "امپری", "amp", "ampere"],
  ma: ["ma", "میلیامپر"],
  ka: ["ka", "کیلوامپر", "کیلوآمپر"],
  w: ["w", "وات", "watt", "watts"],
  kw: ["kw", "کیلووات", "kilowatt"],
  va: ["va", "ولتامپر"],
  kva: ["kva", "کیلوولتامپر"],
  ah: ["ah", "امپرساعت", "آمپرساعت"],
  mah: ["mah", "میلیامپرساعت"],
  uf: ["uf", "mf", "میکروفاراد"],
  kvar: ["kvar", "کیلووار"],
  m: ["m", "متر", "متری", "meter", "metre"],
  cm: ["cm", "سانتیمتر", "سانتیمتری", "سانت"],
  mm: ["mm", "میلیمتر", "میلیمتری"],
  mm2: ["mm2", "میلیمترمربع"],
  inch: ["inch", "اینچ", "اینچی"],
  poles: ["پل", "پله", "قطب", "pole", "poles"],
};
const UNIT_MAP = new Map<string, string>();
for (const [unit, words] of Object.entries(UNIT_SOURCE)) for (const w of words) UNIT_MAP.set(normalizeText(w), unit);

const WORD_NUMBERS_FA_PERSIAN_RE = /^\d+(?:\.\d+)?$/;

function addAttr(attrs: Record<string, AttrValue[]>, key: string, value: AttrValue): void {
  const arr = (attrs[key] ??= []);
  if (!arr.includes(value)) arr.push(value);
}

const RES_P_TO_MP: Record<string, number> = { "720p": 1, "960p": 1.3, "1080p": 2, "1440p": 4, "2k": 4, "4k": 8, "8k": 33 };

const BREAKER_CONTEXT_WORDS = new Set([
  "mcb", "mccb", "rccb", "rcbo", "rcd", "mpcb", "مینیاتوری", "فیوز", "اتوماتیک", "کمپکت",
  "اشنایدر", "schneider", "لگراند", "legrand", "زیمنس", "siemens", "abb", "هیوندای", "hyundai",
  "پارس", "چینت", "chint", "دلیکسی", "delixi", "کاویان", "خزر", "تکپل", "دوپل", "سهپل", "چهارپل",
  "1p", "2p", "3p", "4p", "1p+n", "3p+n", "6ka", "10ka", "4.5ka",
]);

function extractAttrs(tokens: string[], end: number, consumed: Set<number>): Record<string, AttrValue[]> {
  const attrs: Record<string, AttrValue[]> = {};
  const n = Math.min(end, tokens.length);
  const inBreakerContext = tokens.slice(0, n).some((t) => BREAKER_CONTEXT_WORDS.has(t));

  const isRamContext = (idxs: number[], num: number): boolean => {
    const firstIdx = idxs[0] ?? 0;
    const lastIdx = idxs[idxs.length - 1] ?? 0;
    const prev = tokens[firstIdx - 1] ?? "";
    const next = tokens[lastIdx + 1] ?? "";
    if (prev === "ram" || next === "ram") return true;
    if ((prev === "رم" || next === "رم") && num <= 64) {
      // اگر «رم» در ابتدای عنوان کارت حافظه نباشد یا ظرفیت دیگری در عنوان باشد، منظور حافظهٔ رم است
      if (firstIdx > 1 || (attrs.cap?.length ?? 0) > 0) return true;
    }
    return false;
  };

  const putUnit = (num: number, unit: string, idxs: number[]): boolean => {
    switch (unit) {
      case "mp":
        addAttr(attrs, "mp", num);
        break;
      case "ch":
        addAttr(attrs, "ch", num);
        break;
      case "tb":
        addAttr(attrs, "cap", Math.round(num * 1000));
        break;
      case "gb":
        if (isRamContext(idxs, num)) addAttr(attrs, "ram", Math.round(num));
        else addAttr(attrs, "cap", Math.round(num));
        break;
      case "port":
        addAttr(attrs, "ports", num);
        break;
      case "v":
        addAttr(attrs, "volt", num);
        break;
      case "a":
        addAttr(attrs, "amp", num);
        break;
      case "ma":
        addAttr(attrs, "amp", Number((num / 1000).toFixed(4)));
        break;
      case "ka":
        addAttr(attrs, "ka", num);
        break;
      case "w":
        addAttr(attrs, "watt", num);
        break;
      case "kw":
        addAttr(attrs, "watt", Math.round(num * 1000));
        break;
      case "va":
        addAttr(attrs, "va", num);
        break;
      case "kva":
        addAttr(attrs, "va", Math.round(num * 1000));
        break;
      case "ah":
        addAttr(attrs, "ah", num);
        break;
      case "mah":
        addAttr(attrs, "ah", Number((num / 1000).toFixed(3)));
        break;
      case "uf":
        addAttr(attrs, "uf", num);
        break;
      case "kvar":
        addAttr(attrs, "kvar", num);
        break;
      case "m":
        addAttr(attrs, "len", num);
        break;
      case "cm":
        addAttr(attrs, "cm", num);
        break;
      case "mm":
        addAttr(attrs, "lens", num);
        break;
      case "mm2":
        addAttr(attrs, "mm2", num);
        break;
      case "inch":
        addAttr(attrs, "inch", num);
        break;
      case "poles":
        if (num >= 1 && num <= 4) addAttr(attrs, "poles", String(num));
        else return false;
        break;
      default:
        return false;
    }
    for (const k of idxs) consumed.add(k);
    return true;
  };

  for (let i = 0; i < n; i++) {
    const tok = tokens[i];

    // 12v/2a
    let m = /^(\d+(?:\.\d+)?)v[/-](\d+(?:\.\d+)?)a$/.exec(tok);
    if (m) {
      addAttr(attrs, "volt", Number(m[1]));
      addAttr(attrs, "amp", Number(m[2]));
      consumed.add(i);
      continue;
    }
    // 8-port / 8port
    m = /^(\d+)-?(?:port|ports)$/.exec(tok);
    if (m) {
      addAttr(attrs, "ports", Number(m[1]));
      consumed.add(i);
      continue;
    }
    // قطب/پل کلید برق: 1p, 2p, 3p, 4p, 1p+n, 3p+n, تکپل, دوپل, سهپل, چهارپل
    m = /^([1-4])p(\+n)?$/.exec(tok);
    if (m) {
      addAttr(attrs, "poles", `${m[1]}${m[2] ?? ""}`);
      consumed.add(i);
      continue;
    }
    m = /^n\+([1-4])p$/.exec(tok);
    if (m) {
      addAttr(attrs, "poles", `${m[1]}+n`);
      consumed.add(i);
      continue;
    }
    if (tok === "تکپل" || tok === "دوپل" || tok === "سهپل" || tok === "چهارپل") {
      const pMap: Record<string, string> = { تکپل: "1", دوپل: "2", سهپل: "3", چهارپل: "4" };
      addAttr(attrs, "poles", pMap[tok]);
      consumed.add(i);
      continue;
    }
    // فاز: تکفاز / سهفاز / 1ph / 3ph
    if (tok === "تکفاز" || tok === "1ph" || (tok === "single" && tokens[i + 1] === "phase")) {
      addAttr(attrs, "phase", "1");
      consumed.add(i);
      if (tok === "single") consumed.add(i + 1);
      continue;
    }
    if (tok === "سهفاز" || tok === "3ph" || (tok === "three" && tokens[i + 1] === "phase")) {
      addAttr(attrs, "phase", "3");
      consumed.add(i);
      if (tok === "three") consumed.add(i + 1);
      continue;
    }
    // تیپ/منحنی کلید مینیاتوری: «تیپ C»، «منحنی B»، «کرو D»، «curve C»
    if ((tok === "تیپ" || tok === "منحنی" || tok === "کرو" || tok === "curve") && i + 1 < n && /^[bcdkz]$/.test(tokens[i + 1])) {
      addAttr(attrs, "curve", tokens[i + 1].toUpperCase());
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    // کد ترکیبی تیپ+آمپر مینیاتوری در بافت برق: C16, B25, D32, C63
    if (inBreakerContext) {
      m = /^([bcd])(2|4|6|10|16|20|25|32|40|50|63|80|100|125)$/.exec(tok);
      if (m) {
        addAttr(attrs, "curve", m[1].toUpperCase());
        addAttr(attrs, "amp", Number(m[2]));
        consumed.add(i);
        continue;
      }
    }
    // «رم 8» بدون ذکر واحد گیگ در گوشی/لپ‌تاپ
    if ((tok === "رم" || tok === "ram") && i > 0 && i + 1 < n && /^(?:2|3|4|6|8|12|16|24|32|64)$/.test(tokens[i + 1]) && !UNIT_MAP.has(tokens[i + 2] ?? "")) {
      addAttr(attrs, "ram", Number(tokens[i + 1]));
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    // ابعاد/سطح مقطع چسبیده: 40x60 ، 3x2.5
    m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/.exec(tok);
    if (m) {
      const d1 = Number(m[1]);
      const d2 = Number(m[2]);
      if (d1 < 500 && d2 < 500) {
        addAttr(attrs, "dim", m[3] ? `${d1}x${d2}x${Number(m[3])}` : `${d1}x${d2}`);
        consumed.add(i);
        continue;
      }
    }
    // ابعاد/سطح مقطع جدا: «40 x 60» یا «3 در 2.5»
    if (WORD_NUMBERS_FA_PERSIAN_RE.test(tok) && i + 2 < n && (tokens[i + 1] === "x" || tokens[i + 1] === "در") && WORD_NUMBERS_FA_PERSIAN_RE.test(tokens[i + 2])) {
      const d1 = Number(tok);
      const d2 = Number(tokens[i + 2]);
      const hasDimContext =
        tokens[i + 1] === "x" ||
        ["ابعاد", "سایز", "اندازه", "کابل", "سیم", "تابلو", "باکس", "جعبه", "فریم", "سینی", "کاور", "پالت"].includes(tokens[i - 1] ?? "") ||
        ["cm", "mm", "سانتیمتر", "سانت", "میلیمتر", "اینچ"].includes(tokens[i + 3] ?? "");
      if (hasDimContext && d1 > 0 && d1 < 500 && d2 > 0 && d2 < 500) {
        addAttr(attrs, "dim", `${d1}x${d2}`);
        consumed.add(i);
        consumed.add(i + 1);
        consumed.add(i + 2);
        i += 2;
        continue;
      }
    }
    // 2mp ، 4tb ، 2.8mm ، 100m ، 12v ، 6ka ، 50uf ، 2.2kw …
    m = /^(\d+(?:\.\d+)?)([a-z0-9]+)$/.exec(tok);
    if (m && UNIT_MAP.has(m[2])) {
      if (putUnit(Number(m[1]), UNIT_MAP.get(m[2]) as string, [i])) continue;
    }
    // 2.8-12mm (لنز متغیر)
    m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)mm$/.exec(tok);
    if (m) {
      addAttr(attrs, "lens", `${m[1]}-${m[2]}`);
      consumed.add(i);
      continue;
    }
    // 1080p ، 4k ، 2k
    if (/^(?:\d{3,4}p|[248]k)$/.test(tok) && RES_P_TO_MP[tok] != null) {
      addAttr(attrs, "res", RES_P_TO_MP[tok]);
      consumed.add(i);
      continue;
    }
    // عدد (رقم/حروفی، شامل «سی و دو») + واحد جداگانه
    let num: number | null = null;
    let numLen = 1;
    if (WORD_NUMBERS_FA_PERSIAN_RE.test(tok)) num = Number(tok);
    else {
      const w = readWordNumber(tokens, i);
      if (w) {
        num = w.value;
        numLen = w.len;
      }
    }
    if (num != null && i + numLen < n) {
      const nxt = tokens[i + numLen];
      if (nxt === "مگا" && tokens[i + numLen + 1] === "هرتز") continue;
      const span = (k: number): number[] => Array.from({ length: k }, (_, q) => i + q);
      // «میلی متر»
      if (nxt === "میلی" && tokens[i + numLen + 1] === "متر") {
        if (putUnit(num, "mm", span(numLen + 2))) {
          i += numLen + 1;
          continue;
        }
      }
      // «میلی آمپر»
      if (nxt === "میلی" && tokens[i + numLen + 1] === "امپر") {
        if (putUnit(num, "ma", span(numLen + 2))) {
          i += numLen + 1;
          continue;
        }
      }
      const unit = UNIT_MAP.get(nxt);
      if (unit && putUnit(num, unit, span(numLen + 1))) {
        i += numLen;
        continue;
      }
    }
    // «لنز 2.8»
    if (tok === "لنز" && i + 1 < n && WORD_NUMBERS_FA_PERSIAN_RE.test(tokens[i + 1])) {
      addAttr(attrs, "lens", Number(tokens[i + 1]));
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    // Cat5e/6/6a/7 ، کت 6
    m = /^cat\.?(\d[ae]?)$/.exec(tok);
    if (m) {
      addAttr(attrs, "cat", m[1]);
      consumed.add(i);
      continue;
    }
    if ((tok === "cat" || tok === "کت") && i + 1 < n && /^\d[ae]?$/.test(tokens[i + 1])) {
      addAttr(attrs, "cat", tokens[i + 1]);
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    if (tok === "کت6" || tok === "کت5") {
      addAttr(attrs, "cat", tok.slice(2));
      consumed.add(i);
      continue;
    }
    if (/^(?:utp|ftp|sftp|stp)$/.test(tok)) {
      addAttr(attrs, "ctype", tok);
      consumed.add(i);
      continue;
    }
    m = /^rg-?(\d{1,2})(\+\d)?$/.exec(tok);
    if (m) {
      addAttr(attrs, "rg", `${m[1]}${m[2] ?? ""}`);
      consumed.add(i);
      continue;
    }
    if (tok === "poe" || tok === "poe+" || tok === "pse") {
      const neg = i > 0 && (tokens[i - 1] === "بدون" || tokens[i - 1] === "فاقد" || tokens[i - 1] === "non" || tokens[i - 1] === "no");
      addAttr(attrs, "poe", neg ? "no" : "yes");
      consumed.add(i);
      continue;
    }
    if (tok === "پی" && tokens[i + 1] === "او" && tokens[i + 2] === "ای") {
      const neg = i > 0 && (tokens[i - 1] === "بدون" || tokens[i - 1] === "فاقد");
      addAttr(attrs, "poe", neg ? "no" : "yes");
      consumed.add(i);
      consumed.add(i + 1);
      consumed.add(i + 2);
      i += 2;
      continue;
    }
    if (tok === "10/100/1000" || tok === "gigabit" || tok === "گیگابیت" || tok === "گیگابیتی" || tok === "1000mbps") {
      addAttr(attrs, "speed", "gigabit");
      consumed.add(i);
      continue;
    }
    if (tok === "10/100" || tok === "100mbps" || (tok === "فست" && tokens[i + 1] === "اترنت")) {
      addAttr(attrs, "speed", "fast");
      consumed.add(i);
      if (tok === "فست") consumed.add(i + 1);
      continue;
    }
    m = /^(?:ac|ax|n)(\d{3,5})$/.exec(tok);
    if (m && /^(?:ac|ax|n)/.test(tok)) {
      addAttr(attrs, "wifi", tok);
      consumed.add(i);
      continue;
    }
    m = /^ip(\d{2})[a-z]?$/.exec(tok);
    if (m) {
      addAttr(attrs, "ingress", Number(m[1]));
      consumed.add(i);
      continue;
    }
    if (tok === "ip" && i + 1 < n && /^\d{2}$/.test(tokens[i + 1])) {
      addAttr(attrs, "ingress", Number(tokens[i + 1]));
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
  }

  return attrs;
}

function addGenerationAttrs(tokens: string[], end: number, attrs: ParsedTitle["attrs"], consumed: Set<number>) {
  // ۴.۲.۱ — «نسل/شمارهٔ سری» در نام‌های لاتین: «Buds 4 Lite» ≠ «Buds 3 Lite»، «Band 8» ≠ «Band 7»، «Watch 5» ≠ «Watch 6»،
  // «iPhone 14» ≠ «iPhone 13». قبلاً عددِ بعد از واژهٔ سری هیچ مشخصه‌ای نبود و کالای بدون کد با نسل دیگر تأیید خودکار می‌شد
  // (اندازه‌گیری: eval/matching/realistic3.cjs، N12). فقط ترتیب «واژه ← عدد» (نه «عدد ← واژه» که تعداد/واحد است) و فقط
  // عدد یک‌ یا دورقمی صحیح؛ عدد مصرف‌شده در مشخصات واحددار (۲ MP، ۶۴ GB، ۱۲ V …) نادیده گرفته می‌شود.
  for (let i = 0; i < end; i++) {
    const tok = tokens[i];
    let word: string | null = null;
    let num: string | null = null;
    const attached = /^([a-z]{3,})(\d{1,2})$/.exec(tok);
    if (attached) {
      word = attached[1];
      num = attached[2];
    } else if (/^[a-z]{3,}$/.test(tok) && i + 1 < end && /^\d{1,2}$/.test(tokens[i + 1]) && !consumed.has(i + 1)) {
      word = tok;
      num = tokens[i + 1];
    }
    if (!word || !num || GEN_STOP_WORDS.has(word)) continue;
    addAttr(attrs, "gen", `${word}:${Number(num)}`);
  }
}

/** واژه‌هایی که عددِ بعدشان «شمارهٔ سری/نسل» نیست (تعداد، نسخه، بستهٔ چندتایی، واحد…) */
const GEN_STOP_WORDS = new Set([
  "with", "for", "and", "the", "pack", "set", "pcs", "piece", "pieces", "size", "type", "model", "code", "version", "ver",
  "channel", "port", "ports", "meter", "meters", "inch", "mah", "ghz", "mhz", "gen", "core", "cores", "year", "years",
  "month", "months", "warranty", "volt", "watt", "amp", "ampere", "pin", "pins", "key", "keys", "button", "buttons",
  "cat", // «Cat6/Cat 6» پیش‌تر مشخصهٔ تایپ‌شدهٔ cat است؛ دوبار شمرده نمی‌شود
]);

// ───────────────────────────── عبارات و نشانگرها ─────────────────────────────

function findPhrase(tokens: string[], phrases: string[][]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    for (const ph of phrases) {
      if (ph.every((t, k) => tokens[i + k] === t)) return ph.join(" ");
    }
  }
  return null;
}

function firstMarker(tokens: string[], markers: string[][], from = 0): number {
  for (let i = from; i < tokens.length; i++) {
    for (const ph of markers) if (ph.every((t, k) => tokens[i + k] === t)) return i;
  }
  return -1;
}

const PART_COUNT_WORDS = new Set(["پورت", "انتن", "آنتن", "کانال", "ورودی", "خروجی", "فن", "اسلات", "تیغه", "پل", "کنتاکت", "هسته", "رشته", "زوج", "سیم"]);

function detectPack(tokens: string[]): PackInfo | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // «بسته بندی» (بسته‌بندی اصلی/شرکتی) پک چندعددی نیست
    if (tok === "بسته" && tokens[i + 1] === "بندی") continue;

    // 4pcs ، 2pack ، x4
    const mAttached = /^(?:(\d+)(?:pcs|pc|pack)|x(\d+))$/.exec(tok);
    if (mAttached) {
      const q = Number(mAttached[1] ?? mAttached[2]);
      if (q >= 2) return { qty: q, word: tok };
    }

    // «جفت» / «جفتی» / «pair»
    if (tok === "جفت" || tok === "جفتی" || tok === "pair") {
      const prevNum = i > 0 ? numberFromToken(tokens[i - 1]) : null;
      if (prevNum != null && prevNum >= 1) {
        return { qty: prevNum === 1 ? 2 : prevNum * 2, word: `${tokens[i - 1]} ${tok}` };
      }
      const nextNum = numberFromToken(tokens[i + 1]);
      if (nextNum != null && nextNum >= 2) {
        return { qty: nextNum, word: tok };
      }
      return { qty: 2, word: tok };
    }

    if (PACK_WORDS.has(tok)) {
      if (tokens[i + 1] === "تکی" || tokens[i + 1] === "تک") continue;
      // پک 4 عددی ، پکیج 4 دوربین ، ست هشت تایی ، پک بیست و چهار عددی
      let sawSingle = false;
      for (let k = 1; k <= 3 && i + k < tokens.length; k++) {
        let num = numberFromToken(tokens[i + k]);
        let numLen = 1;
        if (!/^\d+(?:\.\d+)?$/.test(tokens[i + k] ?? "")) {
          const w = readWordNumber(tokens, i + k);
          if (w) {
            num = w.value;
            numLen = w.len;
          }
        }
        if (num === 1) {
          sawSingle = true;
          break;
        }
        if (num != null && num >= 2) {
          // «ست 2 پورت» یا «پک 2 مگاپیکسل» (مشخصات) نباید پک حساب شود مگر واحد شمارشی باشد
          const afterNum = tokens[i + k + numLen] ?? "";
          const unit = UNIT_MAP.get(afterNum);
          if (unit && !QTY_UNIT_WORDS.has(afterNum)) break;
          return { qty: num, word: tok };
        }
      }
      if (sawSingle) continue;
      if (tokens[i + 1] === "کامل" || tokens[i + 1] === "چندتایی" || tokens[i + 1] === "مجموعه") return { qty: null, word: `${tok} ${tokens[i + 1]}` };
      if (tok === "پکیج" || tok === "باندل" || tok === "bundle" || tok === "combo" || tok === "کمبو" || tok === "ست") return { qty: null, word: tok };
      continue;
    }

    // «4 عددی» ، «دو تایی» ، «۱۰ عدد» ، «بیست و چهار عددی»
    let num = numberFromToken(tok);
    let numLen = 1;
    if (!/^\d+(?:\.\d+)?$/.test(tok)) {
      const w = readWordNumber(tokens, i);
      if (w) {
        num = w.value;
        numLen = w.len;
      }
    }
    if (num != null && num >= 2 && i + numLen < tokens.length && QTY_UNIT_WORDS.has(tokens[i + numLen])) {
      const unitWord = tokens[i + numLen];
      const afterUnit = tokens[i + numLen + 1] ?? "";
      // «2 عدد پورت / 2 عدد آنتن / 2 عدد تیغه» ویژگی داخلی دستگاه است نه پک چندعددی
      if (unitWord === "عدد" && PART_COUNT_WORDS.has(afterUnit)) continue;
      const finalQty = unitWord === "جفت" || unitWord === "جفتی" || unitWord === "pair" ? num * 2 : num;
      return { qty: finalQty, word: `${tokens.slice(i, i + numLen + 1).join(" ")}` };
    }
  }
  return null;
}

// ───────────────────────────── تجزیهٔ اصلی ─────────────────────────────

const PRIMARY_NON_ACCESSORY = (cls: string): boolean => !isAccessoryClass(cls);

export interface ParseOptions {
  sku?: string | null;
  brand?: string | null;
}

function accessModelName(value: string): string {
  const name = normalizeText(value);
  if (name === "smart") return "هوشمند";
  if (["standard", "basic", "ساده", "استاندارد"].includes(name)) return "معمولی";
  return name;
}

function addAccessControlModel(tokens: string[], attrs: ParsedTitle["attrs"], consumed: Set<number>) {
  const modelIndex = tokens.findIndex((token) => token === "مدل" || token === "model");
  const label = tokens[modelIndex + 1];
  if (modelIndex >= 0 && label && !isSpecToken(label) && !looksLikeCode(label)) {
    addAttr(attrs, "access_model", accessModelName(label));
    consumed.add(modelIndex + 1);
  }
}

const FREQUENCY_UNITS = new Map([
  ["hz", 1], ["هرتز", 1], ["khz", 1_000], ["کیلوهرتز", 1_000],
  ["mhz", 1_000_000], ["مگاهرتز", 1_000_000], ["ghz", 1_000_000_000], ["گیگاهرتز", 1_000_000_000],
]);
const FREQUENCY_LABELS = new Set(["فرکانس", "frequency"]);
const REMOTE_RF_MHZ = new Set([315, 433, 433.92, 868]);
const BUTTON_UNITS = new Set(["دکمه", "دکمهای", "کلید", "کلیده", "کلیدی", "شاسی", "button", "buttons", "key", "keys"]);
const BLUETOOTH_WORDS = new Set(["بلوتوث", "بلوتوثی", "bluetooth", "non-bluetooth"]);
const NON_RF_UNITS = new Set([
  ...UNIT_MAP.keys(), ...QTY_UNIT_WORDS, ...BUTTON_UNITS, ...PART_COUNT_WORDS,
  "میلی", "کیلو", "مگا", "گیگا", "گرم", "کیلوگرم", "ماه", "روز", "سال", "ثانیه", "تومان", "ریال", "درصد", "percent",
  "اهم", "ohm", "g", "kg", "km", "kv", "mv", "rpm", "db", "dbi", "lux", "fps",
]);

function addFrequencyAttrs(tokens: string[], attrs: ParsedTitle["attrs"], consumed: Set<number>, remote: boolean) {
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+(?:\.\d+)?)(?:-?([a-z]+))?$/.exec(tokens[i]);
    if (!match) continue;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) continue;
    const prev = tokens[i - 1] ?? "";
    const next = tokens[i + 1] ?? "";
    const labeled = FREQUENCY_LABELS.has(prev);
    const splitUnit = !match[2] && tokens[i + 2] === "هرتز" && ["کیلو", "مگا", "گیگا"].includes(next);
    const multiplier = FREQUENCY_UNITS.get(match[2] ?? (splitUnit ? `${next}هرتز` : next));
    if (multiplier == null) {
      if (match[2] || consumed.has(i) || NON_RF_UNITS.has(next)) continue;
      if (!labeled && (!remote || !REMOTE_RF_MHZ.has(num) || ["مدل", "model", "کد", "code"].includes(prev))) continue;
    }
    addAttr(attrs, "frequency", num * (multiplier ?? 1_000_000));
    if (labeled) consumed.add(i - 1);
    consumed.add(i);
    if (multiplier != null && !match[2]) consumed.add(i + 1);
    if (splitUnit) consumed.add(i + 2);
  }
}

function addRemoteButtons(tokens: string[], attrs: ParsedTitle["attrs"], consumed: Set<number>) {
  for (let i = 0; i < tokens.length; i++) {
    const wordNumber = readWordNumber(tokens, i);
    if (wordNumber && wordNumber.len > 1) {
      i += wordNumber.len - 1;
      continue;
    }
    const attached = /^(\d{1,2})-?(?:buttons?|keys?)$/.exec(tokens[i]);
    const count = numberFromToken(attached?.[1] ?? tokens[i]);
    if (count == null || !Number.isInteger(count) || count < 1 || count > 16) continue;
    const unit = tokens[i + 1];
    if (!attached && !BUTTON_UNITS.has(unit)) continue;
    addAttr(attrs, "buttons", count);
    consumed.add(i);
    if (!attached) {
      consumed.add(++i);
      if (unit === "دکمه" && tokens[i + 1] === "ای") consumed.add(++i);
    }
  }
}

const COUNTERFEIT_TARH_WORDS = new Set(
  [
    "اصل", "اصلی", "اورجینال", "شرکتی", "فیک", "کپی", "تقلبی", "درجه",
    "ایفون", "آیفون", "گلکسی", "ایرپاد", "ایرپادز", "اپل", "واچ",
  ].map((word) => normalizeText(word)),
);

const NEUTRAL_STYLE_WORDS = new Set([
  // دستی فعلی (رفتار تاریخی حفظ می‌شود) ∪ گروه‌های نرم توصیف‌گر (بازاریابی/ظاهر/رنگ/جنس) از سیاست رده‌محور.
  // «طرح لوکس/ممتاز/فانتزی/سیلیکونی/رنگی» خانوادهٔ نام‌دار نمی‌سازند؛ «طرح پرلا/بنزی/درپا» می‌سازند.
  ...[
    "جدید", "قدیم", "قدیمی", "نوین", "لبخند", "لبخندی", "دام", "بولت", "سقفی", "دیواری",
    "چوب", "چوبی", "سنگ", "سنگی", "چرم", "چرمی", "کربن", "مات", "براق", "کلاسیک", "مدرن", "اسپرت",
  ].map((word) => normalizeText(word)),
  ...(["marketing", "cosmetic_style", "color", "material"] as const).flatMap((group) =>
    (DEFAULT_GROUP_TERMS[group] ?? []).map((term) => normalizeText(term))),
]);

/** برچسب‌های مشخصهٔ انکودینگ/چیپ در عنوان یا کلید spec — چیپ هرگز کد مدل یا توصیف واژگانی نمی‌شود. */
const ENCODING_LABELS = new Set(
  ["انکودینگ", "نوع انکودینگ", "انکودینگ کد", "کد انکودینگ", "encoding", "chip", "چیپ"].map((w) => normalizeText(w)),
);

/** نرمال‌سازی مقدار چیپ: «EV 1527»→«ev1527» ، «PT-2262»→«pt2262»؛ مقدار غیرچیپی (فارسی/کوتاه) null است. */
export function normalizeChipEncoding(value: string): string | null {
  const cleaned = normalizeText(value).toLowerCase().replace(/[\s\-_.]/g, "");
  return /^[a-z0-9]{3,20}$/.test(cleaned) ? cleaned : null;
}

/** استخراج خانوادهٔ نام‌دار از مقدار spec «طرح»: واژهٔ «طرح» حذف و واژهٔ خنثی/کانترفیت پرش می‌شود. */
function designFamilyFromValue(value: string): string | null {
  const tokens = tokenize(value);
  const next = tokens.find((t) => t !== "طرح" && t.length >= 2) ?? "";
  if (!next || next === "طرح") return null;
  if (COUNTERFEIT_TARH_WORDS.has(next) || NEUTRAL_STYLE_WORDS.has(next)) return null;
  return next;
}

const SINGLE_UNIT_PHRASES = [
  ["تکی"], ["تک", "عددی"], ["1", "عددی"], ["یک", "عددی"],
  ["single", "unit"], ["1", "pc"], ["1", "piece"],
];

const CACHE = new Map<string, ParsedTitle>();
const CACHE_MAX = 600;

export function parseTitle(text: string | null | undefined, opts: ParseOptions = {}): ParsedTitle {
  let source = String(text ?? "");
  const sku = opts.sku && !isInternalOrDatabaseId(opts.sku) ? String(opts.sku) : "";
  if (sku) source = `${source} ${sku}`;
  if (opts.brand) source = `${source} ${opts.brand}`;
  const cached = CACHE.get(source);
  if (cached) return cached;

  const norm = normalizeText(source);
  const tokens = tokenize(norm);
  const consumed = new Set<number>();

  // رده/head
  const hits = scanClasses(tokens);
  // عنوان لاتین «سر-راست» است: در «Ceiling Mount Access Point» هستهٔ عبارت آخرین واژهٔ زنجیرهٔ چسبیده است (Access Point)
  let headIdx = 0;
  while (
    headIdx + 1 < hits.length &&
    /^[a-z]/.test(tokens[hits[headIdx].at] ?? "") &&
    /^[a-z]/.test(tokens[hits[headIdx + 1].at] ?? "") &&
    hits[headIdx + 1].at === hits[headIdx].at + hits[headIdx].len
  ) {
    headIdx++;
  }
  const head = hits.length ? hits[headIdx] : null;
  for (const h of hits) for (let k = 0; k < h.len; k++) consumed.add(h.at + k);

  const accessoryHead = head ? isAccessoryClass(head.cls) : false;
  const canHaveHostCompat = accessoryHead || !head || ["psu", "cable", "battery", "access_control"].includes(head.cls);
  const compatStart = canHaveHostCompat ? firstMarker(tokens, COMPAT_MARKERS, head ? head.at + head.len : 0) : -1;
  const companionStart = head ? firstMarker(tokens, COMPANION_MARKERS, head.at + head.len) : -1;

  // مشخصات: برای لوازم جانبی فقط قبل از بند سازگاری؛ برای کالای اصلی تا قبل از بند «همراه با»
  let attrEnd = tokens.length;
  if (compatStart >= 0) attrEnd = compatStart;
  else if (companionStart >= 0) attrEnd = companionStart;
  const body = tokens.slice(0, attrEnd);
  const family = body.includes("ریموتگ") ? "remotag" : null;
  const brandScan = scanBrands(family ? body : tokens);
  for (const k of brandScan.consumed) consumed.add(k);
  const attrs = extractAttrs(tokens, attrEnd, consumed);
  const accessControl = family != null || head?.cls === "access_control";
  const remote = head?.cls === "acc:remote";
  if (accessControl) addAccessControlModel(body, attrs, consumed);
  if (accessControl || remote) addFrequencyAttrs(body, attrs, consumed, remote);
  if (remote) {
    addRemoteButtons(body, attrs, consumed);
    body.forEach((word, i) => {
      if (!BLUETOOTH_WORDS.has(word)) return;
      const negated = word === "non-bluetooth" || ["بدون", "غیر", "فاقد", "no", "non"].includes(body[i - 1]);
      addAttr(attrs, "bluetooth", negated ? "no" : "yes");
      consumed.add(i);
      if (negated && word !== "non-bluetooth") consumed.add(i - 1);
    });
  }
  addGenerationAttrs(tokens, attrEnd, attrs, consumed);

  // نوع کابل (فقط برای رده کابل): شبکه/کواکسیال/HDMI/SATA/برق/…
  if (head?.cls === "cable") {
    const has = (w: string): boolean => body.includes(w);
    if (has("hdmi")) addAttr(attrs, "cabletype", "hdmi");
    else if (has("sata")) addAttr(attrs, "cabletype", "sata");
    else if (has("usb")) addAttr(attrs, "cabletype", "usb");
    else if (has("vga")) addAttr(attrs, "cabletype", "vga");
    else if (attrs.rg?.length || has("کواکسیال") || has("coaxial") || has("coax")) addAttr(attrs, "cabletype", "coax");
    else if (attrs.cat?.length || attrs.ctype?.length) addAttr(attrs, "cabletype", "net");
    else if (has("برق") && !has("شبکه")) addAttr(attrs, "cabletype", "power");
    for (let i = 0; i < body.length; i++) if (["hdmi", "sata", "usb", "vga", "کواکسیال", "coaxial", "coax"].includes(body[i])) consumed.add(i);
  }

  // ویژگی‌های فرعی (فرم/فناوری/نوع هارد) از بدنهٔ اصلی عنوان
  const featSets = scanFeatures(tokens, attrEnd);
  const features: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(featSets)) features[k] = [...v];

  // عبارت «انکودینگ/چیپ X» در عنوان: چیپ مشخصهٔ فنی است و به attrs.encoding می‌رود —
  // هرگز کد مدل (codes) یا توصیف واژگانی نمی‌شود؛ پیش از اسکن کدها مصرف می‌شود تا «EV1527» کد مدل نشود.
  const encodingConsumed = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!ENCODING_LABELS.has(tokens[i])) continue;
    const next = tokens[i + 1] ?? "";
    let chip = normalizeChipEncoding(next);
    let chipLen = 1;
    if (!chip && next && i + 2 < tokens.length) {
      // چیپ دو-تکه: «EV 1527»
      const joined = normalizeChipEncoding(`${next} ${tokens[i + 2]}`);
      if (joined) {
        chip = joined;
        chipLen = 2;
      }
    }
    if (chip) {
      addAttr(attrs, "encoding", chip);
      consumed.add(i);
      for (let k = 1; k <= chipLen; k++) {
        consumed.add(i + k);
        encodingConsumed.add(i + k);
      }
    }
  }

  // کدهای مدل
  const codes: ParsedCode[] = [];
  const seenCanon = new Set<string>();
  const pushCode = (raw: string, idx: number): void => {
    const inCompat = compatStart >= 0 && idx > compatStart;
    const c = makeCode(raw, inCompat);
    if (c.canon.length < 3) return;
    const key = `${c.canon}|${inCompat}`;
    if (seenCanon.has(key)) return;
    seenCanon.add(key);
    codes.push(c);
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // توکن چیپِ مصرف‌شدهٔ مجرای انکودینگ هرگز کد مدل نمی‌شود (حتی اگر شکل کد داشته باشد مثل EV1527).
    if (encodingConsumed.has(i)) continue;
    if (consumed.has(i) && !looksLikeCode(tok)) continue;
    // ترکیب سری با شماره/کد بعدی: Archer C6 ⇒ archer-c6 ، Note 12 ⇒ note-12 ، نوت 12 ⇒ note-12
    if (SERIES_WORDS.has(tok) && i + 1 < tokens.length && /^(?:[a-z]{1,3}\d{1,4}[a-z]{0,2}|\d{1,3}[a-z]{0,2})$/.test(tokens[i + 1]) && !isSpecToken(tokens[i + 1])) {
      const prefixCanon = tok === "نوت" ? "note" : tok;
      pushCode(`${prefixCanon}-${tokens[i + 1]}`, i);
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    // ترکیب پیشوندهای جداافتاده با بخش بعدی کد: DS 2CE16H0T ITPF ⇒ ds-2ce16h0t-itpf ، NSX 100F ⇒ nsx-100f
    if (
      (isAliasPrefix(tok) || SPACED_CODE_PREFIXES.has(tok)) &&
      i + 1 < tokens.length &&
      !isSpecToken(tokens[i + 1]) &&
      (looksLikeCode(tokens[i + 1]) || (SPACED_CODE_PREFIXES.has(tok) && /^\d{2,4}[a-z]{0,3}$/.test(tokens[i + 1])))
    ) {
      let combined = `${tok}-${tokens[i + 1]}`;
      const startIdx = i;
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      while (i + 1 < tokens.length && MODEL_SUFFIX_TOKENS.has(tokens[i + 1])) {
        combined = `${combined}-${tokens[i + 1]}`;
        consumed.add(i + 1);
        i += 1;
      }
      pushCode(combined, startIdx);
      continue;
    }
    if (looksLikeCode(tok)) {
      let combined = tok;
      const startIdx = i;
      consumed.add(i);
      if (alnumCount(combined) >= 6) {
        while (i + 1 < tokens.length && MODEL_SUFFIX_TOKENS.has(tokens[i + 1])) {
          combined = `${combined}-${tokens[i + 1]}`;
          consumed.add(i + 1);
          i += 1;
        }
      }
      pushCode(combined, startIdx);
    }
  }

  const impliedBrands = new Set<string>();
  for (const c of codes) if (!c.inCompat && c.brandHint) impliedBrands.add(c.brandHint);

  // پک/استوک/کپی/معیوب (پک فقط پیش از بند «همراه با» معنا دارد: «به همراه ۲ عدد پایه» پک نیست)
  const pack = detectPack(tokens.slice(0, companionStart >= 0 ? companionStart : tokens.length));
  const singleUnit = findPhrase(body, SINGLE_UNIT_PHRASES);
  if (singleUnit) {
    const phrase = tokenize(singleUnit);
    const start = firstMarker(body, [phrase]);
    phrase.forEach((_, i) => consumed.add(start + i));
  }
  const used = findPhrase(tokens, USED_PHRASES);
  let counterfeit = findPhrase(tokens, COUNTERFEIT_PHRASES);
  let designStyle: string | null = null;
  let designFamily: string | null = null;
  if (!counterfeit) {
    // «قابلیت کپی»، «دستگاه کپی» و «کپی خور» نشانگر غیراصل بودن کالا نیستند.
    const standaloneCopy = tokens.some((token, i) => token === "کپی" &&
      !["قابلیت", "امکان", "دستگاه", "ماشین", "پرینتر", "اسکن", "فتوکپی"].includes(tokens[i - 1]) &&
      !["برداری", "کارت", "خور"].includes(tokens[i + 1]));
    if (standaloneCopy) counterfeit = "کپی";
  }
  if (!counterfeit) {
    for (let kTarh = 0; kTarh < tokens.length; kTarh++) {
      if (tokens[kTarh] !== "طرح") continue;
      const next = tokens[kTarh + 1] ?? "";
      if (!next || brandScan.consumed.has(kTarh + 1) || COUNTERFEIT_TARH_WORDS.has(next)) {
        counterfeit = next ? `طرح ${next}` : "طرح";
        break;
      }
      if (NEUTRAL_STYLE_WORDS.has(next)) {
        consumed.add(kTarh);
        continue;
      }
      designStyle = `طرح ${next}`;
      // §5 سند رخداد: توکن پس از «طرح» نام خانوادهٔ نام‌دار است (مثل پرلا/بنزی) — جدا از توصیف ظاهری.
      designFamily = next;
      consumed.add(kTarh);
    }
  }
  const defective = findPhrase(tokens, DEFECTIVE_PHRASES);

  // ترکیب با اقلام دیگر (پکیج دوربین + دستگاه + هارد)، لوازم همراه، و قطعات جانبی انتهایی بدون حرف اضافه
  const bundleWith: string[] = [];
  const withAccessories: string[] = [];
  let trailingAccessory: string | null = null;
  if (head && !accessoryHead) {
    for (const h of hits.slice(headIdx + 1)) {
      const prev = tokens[h.at - 1] ?? "";
      const afterCompanion = companionStart >= 0 && h.at > companionStart;
      const conj = prev === "و" || prev === "plus" || prev === "+";
      if (afterCompanion || conj) {
        if (h.cls === head.cls) continue;
        if (PRIMARY_NON_ACCESSORY(h.cls)) bundleWith.push(h.cls);
        else withAccessories.push(h.cls);
        continue;
      }
      // قطعه/لوازم جانبی بدون حرف اضافه پس از نام دستگاه اصلی (مثل «دوربین ... پایه دیواری» یا «کلید اتوماتیک ... کنتاکت کمکی»)
      if (isAccessoryClass(h.cls) && prev !== "بدون" && prev !== "فاقد" && prev !== "دارای" && prev !== "با") {
        const nextTok = tokens[h.at + h.len] ?? "";
        const isStandaloneAcc =
          h.cls === "acc:aux" ||
          h.cls === "acc:handle" ||
          h.cls === "acc:junction" ||
          h.cls === "acc:frame" ||
          (h.cls === "acc:box" && tokens[h.at] !== "باکس") ||
          (h.cls === "acc:mount" && (tokens[h.at] === "براکت" || tokens[h.at] === "bracket" || ["دیواری", "سقفی", "ستونی", "نبشی"].includes(nextTok))) ||
          (h.cls === "acc:cover" && ["گلس", "درپوش"].includes(tokens[h.at] ?? "")) ||
          (h.cls === "acc:coil" && (tokens[h.at] !== "بوبین" && tokens[h.at] !== "کویل" ? true : !WORD_NUMBERS_FA_PERSIAN_RE.test(nextTok)));
        if (isStandaloneAcc && !trailingAccessory) {
          trailingAccessory = h.cls;
        }
      }
    }
  }
  if (head?.cls === "access_control" && companionStart >= 0) {
    const accessories = tokens.slice(companionStart + 1);
    if (accessories.some((token) => ["کارت", "تگ", "card", "tag", "fob"].includes(token))) withAccessories.push("acc:tag");
    if (accessories.some((token) => ["ریموت", "remote"].includes(token))) withAccessories.push("acc:remote");
  }

  // واژه‌های توصیفی (هر آنچه مصرف نشده و بی‌اثر نیست)
  const words: string[] = [];
  const descriptorWords: string[] = [];
  const COLOR_MATERIAL_KEEP = new Set(["رنگی", "فلزی", "پلاستیکی"]);
  for (let i = 0; i < (family ? attrEnd : tokens.length); i++) {
    if (consumed.has(i)) continue;
    const tok = tokens[i];
    if (tok.length < 2 || /^\d/.test(tok) || /^[\d.]+$/.test(tok)) continue;
    if (STOPWORDS.has(tok)) continue;
    if (/^[a-z]+$/.test(tok) && tok.length < 3 && tok !== "fe" && tok !== "se") continue;
    const isCameraColor = head?.cls === "camera" && tok === "رنگی";
    if (!GENERIC_WORDS.has(tok)) {
      if (!words.includes(tok)) words.push(tok);
      if (!descriptorWords.includes(tok)) descriptorWords.push(tok);
    } else if (!isCameraColor && COLOR_MATERIAL_KEEP.has(tok)) {
      if (!descriptorWords.includes(tok)) descriptorWords.push(tok);
    }
  }
  const descriptors = analyzeTitleDescriptors(descriptorWords, head?.cls);

  const parsed: ParsedTitle = {
    norm,
    tokens,
    brands: brandScan.ids,
    impliedBrands: [...impliedBrands],
    family,
    codes,
    head,
    hits,
    features,
    attrs,
    pack,
    packageUnits: singleUnit ? 1 : pack?.qty ?? undefined,
    ...(singleUnit && pack ? { evidenceConflicts: ["واحد تکی و پک چندعددی هم‌زمان در عنوان ذکر شده‌اند"] } : {}),
    used,
    counterfeit,
    designStyle,
    designFamily,
    defective,
    bundleWith,
    withAccessories,
    trailingAccessory,
    words,
    descriptors,
    descriptorWords,
  };
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(source, parsed);
  return parsed;
}

export interface IdentitySpec {
  key: string;
  value: string;
}

/** Only named identity fields can add evidence to a card title. */
export function parseIdentityTitle(text: string, specs?: IdentitySpec[]): ParsedTitle {
  const title = parseTitle(text);
  if (!specs?.length) return title;
  const attrs = Object.fromEntries(Object.entries(title.attrs).map(([key, values]) => [key, [...values]]));
  const codes = [...title.codes];
  const brands = [...title.brands];
  const evidenceConflicts = [...(title.evidenceConflicts ?? [])];
  let pack = title.pack;
  let packageUnits = title.packageUnits;
  const titleCodes = title.codes.filter((code) => !code.inCompat);
  const specDescriptors = [...(title.specDescriptors ?? [])];
  const descriptorWords = [...(title.descriptorWords ?? title.words)];
  // §5 سند رخداد — خانوادهٔ نام‌دار: اگر عنوان خانواده ندارد و spec دارد، spec جایگزین می‌شود؛
  // اگر هر دو دارند و متناقض‌اند، evidenceConflict ثبت شده و مقدار عنوان دست‌نخورده می‌ماند.
  let designFamilyOverride: string | null = null;
  const specFamilyMarkers: string[] = [];
  const mergeAttr = (key: string, values: AttrValue[]) => {
    if (attrs[key]?.length && values.some((v) => !attrs[key].includes(v))) {
      evidenceConflicts.push(`مقادیر متناقض برای ${key} در عنوان و مشخصات ترب`);
    }
    for (const value of values) addAttr(attrs, key, value);
  };

  for (const spec of specs) {
    const key = normalizeText(spec.key);
    const value = normalizeText(spec.value);
    if (!value || value.length > 100) continue;
    if (/^(?:برند|نام برند|سازنده|نام سازنده|brand|manufacturer)$/.test(key)) {
      const specBrands = parseTitle(`برند ${value}`).brands;
      if (brands.length && specBrands.some((brand) => !brands.includes(brand))) {
        evidenceConflicts.push("برند در عنوان و مشخصات ترب متفاوت است");
      }
      for (const brand of specBrands) if (!brands.includes(brand)) brands.push(brand);
    } else if (/^(?:مدل|کد مدل|شماره مدل|مدل دستگاه|model|model number|model code|mpn)$/.test(key)) {
      const specCodes = parseTitle(value).codes.filter((code) => !code.inCompat);
      if (titleCodes.length && specCodes.some((code) => !titleCodes.some((other) => other.canon === code.canon))) {
        evidenceConflicts.push("کد مدل در عنوان و مشخصات ترب متفاوت است");
      }
      if (codes.some((code) => !code.inCompat) && specCodes.length &&
          !specCodes.some((code) => codes.some((other) => !other.inCompat && other.canon === code.canon))) {
        evidenceConflicts.push("کدهای مدل اعلام‌شده برای کارت ترب متفاوت‌اند");
      }
      for (const code of specCodes) if (!codes.some((other) => !other.inCompat && other.canon === code.canon)) codes.push(code);
      if (!specCodes.length && (title.family || title.head?.cls === "access_control")) {
        mergeAttr("access_model", [accessModelName(value)]);
      }
    } else if (/^(?:تعداد در بسته|تعداد اقلام بسته|تعداد در پک|تعداد در بسته بندی|pack quantity|units per pack|items per pack|package quantity)$/.test(key)) {
      const [num, unit, ...rest] = tokenize(value);
      const count = numberFromToken(num);
      if (!rest.length && (!unit || QTY_UNIT_WORDS.has(unit) || /^(?:units?|pieces?)$/.test(unit)) &&
          typeof count === "number" && Number.isSafeInteger(count) && count > 0) {
        if ((packageUnits != null && packageUnits !== count) || (pack && count === 1)) {
          evidenceConflicts.push("تعداد اقلام در بسته در عنوان و مشخصات ترب متناقض است");
        }
        packageUnits = count;
        if (count > 1) pack = { qty: count, word: key };
      }
    } else if (/^(?:تعداد دکمه|تعداد دکمه ها|تعداد کلید|تعداد شاسی|button count|number of buttons|buttons|number of keys)$/.test(key)
        && title.head?.cls === "acc:remote") {
      const typed: ParsedTitle["attrs"] = {};
      const tokens = tokenize(value);
      addRemoteButtons(tokens.length === 1 ? [...tokens, "دکمه"] : tokens, typed, new Set());
      if (typed.buttons?.length) mergeAttr("buttons", typed.buttons);
    } else if (/^(?:تعداد کانال|تعداد کانال ها|کانال|channel count|channels?)$/.test(key)) {
      const chAttrs = parseTitle(/^\d+$/.test(value) ? `${value} کانال` : value).attrs.ch;
      if (chAttrs?.length) mergeAttr("ch", chAttrs);
    } else if (title.head?.cls === "acc:remote" && /^(?:بلوتوث|bluetooth)$/.test(key)) {
      if (/^(?:دارد|بله|yes|true|supported)$/.test(value)) mergeAttr("bluetooth", ["yes"]);
      if (/^(?:ندارد|خیر|no|false|unsupported)$/.test(value)) mergeAttr("bluetooth", ["no"]);
    } else if (title.head?.cls === "acc:remote" && /^(?:نوع|نوع ریموت|فناوری|تکنولوژی|type|remote type)$/.test(key)) {
      const valTokens = tokenize(value);
      if (valTokens.some((t) => BLUETOOTH_WORDS.has(t))) {
        const negated = valTokens.some((t) => ["بدون", "غیر", "فاقد", "ندارد", "خیر", "no", "non", "non-bluetooth"].includes(t));
        mergeAttr("bluetooth", [negated ? "no" : "yes"]);
      }
    } else if (/^(?:ولتاژ|ولتاژ ورودی|ولتاژ تغذیه|input voltage|supply voltage|voltage)$/.test(key)) {
      const volts = parseTitle(/^\d+(?:\.\d+)?$/.test(value) ? `${value} v` : value).attrs.volt;
      if (volts?.length) mergeAttr("volt", volts);
    } else if (/^(?:فرکانس|فرکانس کاری|فرکانس عملکرد|frequency|operating frequency)$/.test(key)
        && (title.family || title.head?.cls === "access_control" || title.head?.cls === "acc:remote")) {
      const frequency: ParsedTitle["attrs"] = {};
      const text = title.head?.cls === "acc:remote" ? `فرکانس ${value}` : value;
      addFrequencyAttrs(tokenize(text), frequency, new Set(), false);
      if (frequency.frequency?.length) mergeAttr("frequency", frequency.frequency);
    } else if (ENCODING_LABELS.has(key)) {
      // §13 سند رخداد — انکودینگ/چیپ مشخصهٔ فنی است: به attrs.encoding می‌رود و هرگز به codes/descriptorWords نمی‌رود.
      const chip = normalizeChipEncoding(value);
      if (chip) mergeAttr("encoding", [chip]);
    } else if (/^(?:طرح|طرح بدنه|طرح رنگی|design|style)$/.test(key)) {
      // مجرای مستقل خانوادهٔ نام‌دار از spec؛ بازنویسی بی‌صدای مقدار عنوان ممنوع است.
      const specFamily = designFamilyFromValue(value);
      if (title.designFamily && specFamily && !namedFamilyRootsCompatible(title.designFamily, specFamily)) {
        evidenceConflicts.push("خانوادهٔ طراحی در عنوان و مشخصات کارت متفاوت است");
      }
      if (specFamily && !designFamilyOverride) designFamilyOverride = specFamily;
      if (specFamily) specFamilyMarkers.push(specFamily);
    } else if (/^(?:جنس|جنس بدنه|جنس قاب|رنگ|رنگ بندی|شکل|باتری|نوع باتری|material|color|shape|battery)$/.test(key)) {
      // توکن‌های ناشناختهٔ گروه توصیف‌گر (مثل کد باتری «12v/27a») دیگر به descriptorWords نمی‌روند تا
      // بلاکر قلابی «توضیحات اختصاصی بیشتر» نسازند (ریشهٔ علّی ۵ رخداد)؛ مقادیر گروه‌دار حفظ می‌شوند.
      specDescriptors.push(`${key}:${value}`);
      for (const tok of tokenize(value)) {
        if (tok.length >= 2 && !STOPWORDS.has(tok) && !descriptorWords.includes(tok) &&
            classifyDescriptorToken(tok, title.head?.cls).group !== "unknown") {
          descriptorWords.push(tok);
        }
      }
    }
  }
  const descriptors = analyzeTitleDescriptors(descriptorWords, title.head?.cls);
  const resolvedDesignFamily = title.designFamily ?? designFamilyOverride;
  return {
    ...title,
    attrs,
    codes,
    brands,
    pack,
    packageUnits,
    designFamily: resolvedDesignFamily,
    descriptorWords,
    descriptors,
    ...(specDescriptors.length || specFamilyMarkers.length ? { specDescriptors: [...new Set([...specDescriptors, ...specFamilyMarkers.map((f) => `طرح:${f}`)])] } : {}),
    evidenceConflicts: [...new Set(evidenceConflicts)],
  };
}
