/**
 * واژگان دامنهٔ موتور تطابق v2: برندها، رده‌های کالا (head noun)، نشانگرها (پک/استوک/کپی/سازگاری) و واژه‌های بی‌اثر.
 * همهٔ عبارت‌ها هنگام بارگذاری با همان نرمال‌ساز متن عنوان‌ها یکسان‌سازی می‌شوند.
 * توسعه: برای افزودن برند/دستهٔ جدید فقط همین فایل را ویرایش کنید.
 */
import { normalizeText, tokenize } from "./text";

// ───────────────────────────── برندها ─────────────────────────────

interface BrandDef {
  /** عبارت‌های معادل (فارسی/انگلیسی/املاهای رایج) */
  aliases: string[];
  /** برند مادر (زیر‌برند ⇒ مادر): تضاد برند را نرم می‌کند */
  parent?: string;
  /** پیشوند کد مدل که این برند استفاده می‌کند و فروشندگان اغلب حذفش می‌کنند (DS- ، DH- ، TL-) */
  codePrefixes?: string[];
}

const BRAND_DEFS: Record<string, BrandDef> = {
  hikvision: { aliases: ["هایک ویژن", "هایکویژن", "هایک", "hikvision", "hik vision", "hik"], codePrefixes: ["ds", "ids"] },
  hilook: { aliases: ["هایلوک", "های لوک", "hilook"], parent: "hikvision" },
  ezviz: { aliases: ["ایزویز", "ezviz"], parent: "hikvision" },
  dahua: { aliases: ["داهوا", "دهوا", "dahua"], codePrefixes: ["dh", "dhi"] },
  imou: { aliases: ["ایمو", "imou"], parent: "dahua" },
  uniview: { aliases: ["یونی ویو", "یونیویو", "uniview", "unv"] },
  uniarch: { aliases: ["یونی آرک", "uniarch"] },
  tiandy: { aliases: ["تیاندی", "tiandy"] },
  vivotek: { aliases: ["ویوتک", "vivotek"] },
  axis: { aliases: ["اکسیس", "axis"] },
  bosch: { aliases: ["بوش", "bosch"] },
  sony: { aliases: ["سونی", "sony"] },
  panasonic: { aliases: ["پاناسونیک", "panasonic"] },
  reolink: { aliases: ["ریولینک", "reolink"] },
  zkteco: { aliases: ["زد کی تکو", "زدکی تکو", "zkteco"] },
  wd: { aliases: ["وسترن دیجیتال", "وسترن", "western digital", "westerndigital", "wdc", "wd"] },
  seagate: { aliases: ["سیگیت", "seagate"] },
  toshiba: { aliases: ["توشیبا", "toshiba"] },
  samsung: { aliases: ["سامسونگ", "samsung"] },
  sandisk: { aliases: ["سن دیسک", "سندیسک", "sandisk"] },
  kingston: { aliases: ["کینگستون", "kingston"] },
  lexar: { aliases: ["لکسار", "lexar"] },
  adata: { aliases: ["ای دیتا", "ایدیتا", "adata"] },
  transcend: { aliases: ["ترنسند", "transcend"] },
  tplink: { aliases: ["تی پی لینک", "تیپیلینک", "tp link", "tp-link", "tplink"], codePrefixes: ["tl"] },
  tapo: { aliases: ["تاپو", "tapo"], parent: "tplink" },
  dlink: { aliases: ["دی لینک", "دیلینک", "d link", "d-link", "dlink"] },
  mikrotik: { aliases: ["میکروتیک", "mikrotik"] },
  tenda: { aliases: ["تندا", "tenda"] },
  mercusys: { aliases: ["مرکوسیس", "mercusys"] },
  totolink: { aliases: ["توتولینک", "totolink"] },
  netgear: { aliases: ["نت گیر", "نتگیر", "netgear"] },
  linksys: { aliases: ["لینکسیس", "linksys"] },
  cisco: { aliases: ["سیسکو", "cisco"] },
  huawei: { aliases: ["هواوی", "huawei"] },
  zyxel: { aliases: ["زایکسل", "zyxel"] },
  ubiquiti: { aliases: ["یوبیکوییتی", "ubiquiti", "ubnt"] },
  asus: { aliases: ["ایسوس", "asus"] },
  hp: { aliases: ["اچ پی", "hp"] },
  dell: { aliases: ["دل", "dell"] },
  lg: { aliases: ["ال جی", "lg"] },
  aoc: { aliases: ["ای او سی", "aoc"] },
  benq: { aliases: ["بنکیو", "benq"] },
  dnet: { aliases: ["دی نت", "دینت", "d net", "d-net", "dnet"] },
  legrand: { aliases: ["لگراند", "legrand"] },
  nexans: { aliases: ["نگزنس", "نکسانس", "nexans"] },
  belden: { aliases: ["بلدن", "belden"] },
  apc: { aliases: ["ای پی سی", "apc"] },
  silex: { aliases: ["سایلکس", "silex"] },
  nice: { aliases: ["نایس"] },
  xiaomi: { aliases: ["شیائومی", "شیاومی", "xiaomi", "mi"] },
  redmi: { aliases: ["ردمی", "redmi"], parent: "xiaomi" },
  logitech: { aliases: ["لاجیتک", "logitech"] },
};

export interface BrandInfo {
  id: string;
  parent?: string;
  codePrefixes: string[];
}

const BRAND_INFO = new Map<string, BrandInfo>();
/** شاخص عبارت‌های برند: توکن‌های اول → فهرست [aliasTokens, brandId] به ترتیب طولانی‌ترین */
const BRAND_INDEX = new Map<string, Array<{ tokens: string[]; id: string }>>();

for (const [id, def] of Object.entries(BRAND_DEFS)) {
  BRAND_INFO.set(id, { id, parent: def.parent, codePrefixes: def.codePrefixes ?? [] });
  for (const alias of def.aliases) {
    const tokens = tokenize(normalizeText(alias));
    if (!tokens.length) continue;
    const bucket = BRAND_INDEX.get(tokens[0]) ?? [];
    bucket.push({ tokens, id });
    bucket.sort((a, b) => b.tokens.length - a.tokens.length);
    BRAND_INDEX.set(tokens[0], bucket);
  }
}

export function brandInfo(id: string): BrandInfo | undefined {
  return BRAND_INFO.get(id);
}

/** برند مادر را هم اضافه می‌کند (tapo ⇒ tplink) */
export function expandBrands(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    const parent = BRAND_INFO.get(id)?.parent;
    if (parent) out.add(parent);
  }
  return out;
}

/** اسکن برندهای صریح در توکن‌ها؛ شاخص توکن‌های مصرف‌شده را هم برمی‌گرداند */
export function scanBrands(tokens: string[]): { ids: string[]; consumed: Set<number> } {
  const ids = new Set<string>();
  const consumed = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const bucket = BRAND_INDEX.get(tokens[i]);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (cand.tokens.every((t, k) => tokens[i + k] === t)) {
        ids.add(cand.id);
        for (let k = 0; k < cand.tokens.length; k++) consumed.add(i + k);
        i += cand.tokens.length - 1;
        break;
      }
    }
  }
  return { ids: [...ids], consumed };
}

/** پیشوند کد که معمولاً حذف می‌شود ⇒ برند مربوط (DS ⇒ hikvision) */
const PREFIX_TO_BRAND = new Map<string, string>();
for (const [id, def] of Object.entries(BRAND_DEFS)) for (const p of def.codePrefixes ?? []) PREFIX_TO_BRAND.set(p, id);

export function brandForCodePrefix(prefix: string): string | undefined {
  return PREFIX_TO_BRAND.get(prefix.toLowerCase());
}

/** برند مستتر در ظاهر کد (بدون پیشوند جداکننده): WD40PURZ ⇒ wd ، ST4000VX016 ⇒ seagate */
const CODE_SHAPE_BRANDS: Array<{ re: RegExp; brand: string }> = [
  { re: /^wd\d/i, brand: "wd" },
  { re: /^st\d{3,}[a-z]{2}\d/i, brand: "seagate" },
  { re: /^hdw[tn]\d/i, brand: "toshiba" },
  { re: /^(?:rb|crs|ccr|css|rbd|hap)\d/i, brand: "mikrotik" },
  { re: /^mb-?m[a-z]\d/i, brand: "samsung" },
  { re: /^sdsq/i, brand: "sandisk" },
  { re: /^(?:dgs|des|dir|dwr)-?\d/i, brand: "dlink" },
  { re: /^(?:eap|archer|deco)/i, brand: "tplink" },
];

export function brandFromCodeShape(canonLower: string): string | undefined {
  for (const { re, brand } of CODE_SHAPE_BRANDS) if (re.test(canonLower)) return brand;
  return undefined;
}

// ───────────────────────────── رده‌های کالا ─────────────────────────────

export interface ClassDef {
  cls: string;
  sub?: string;
  phrase: string;
}

/** رده‌های «لوازم جانبی/قطعه» با پیشوند acc: — اگر محصول سایت از این رده‌ها نباشد، کارت ترب از رده acc: رد می‌شود */
export const isAccessoryClass = (cls: string | null | undefined): boolean => Boolean(cls && cls.startsWith("acc:"));

const CLASS_DEFS: ClassDef[] = [
  // ── دوربین
  { cls: "camera", phrase: "دوربین" },
  { cls: "camera", phrase: "camera" },
  { cls: "camera", sub: "ptz", phrase: "اسپید دام" },
  { cls: "camera", sub: "ptz", phrase: "اسپیددام" },
  { cls: "camera", sub: "ptz", phrase: "speed dome" },
  // ── دستگاه ضبط
  { cls: "recorder", phrase: "دستگاه ضبط" },
  { cls: "recorder", phrase: "ضبط کننده" },
  { cls: "recorder", phrase: "ضبط کننده" },
  { cls: "recorder", phrase: "ریکوردر" },
  { cls: "recorder", phrase: "رکوردر" },
  { cls: "recorder", phrase: "recorder" },
  { cls: "recorder", sub: "dvr", phrase: "dvr" },
  { cls: "recorder", sub: "xvr", phrase: "xvr" },
  { cls: "recorder", sub: "nvr", phrase: "nvr" },
  { cls: "recorder", sub: "hvr", phrase: "hvr" },
  // ── ذخیره‌سازی
  { cls: "hdd", phrase: "هارددیسک" },
  { cls: "hdd", phrase: "هارد" },
  { cls: "hdd", phrase: "hdd" },
  { cls: "hdd", phrase: "harddisk" },
  { cls: "hdd", phrase: "hard drive" },
  { cls: "ssd", phrase: "ssd" },
  { cls: "ssd", phrase: "اس اس دی" },
  { cls: "sdcard", phrase: "کارت حافظه" },
  { cls: "sdcard", phrase: "مموری کارت" },
  { cls: "sdcard", phrase: "میکرو اس دی" },
  { cls: "sdcard", phrase: "micro sd" },
  { cls: "sdcard", phrase: "microsd" },
  { cls: "sdcard", phrase: "microsdxc" },
  { cls: "sdcard", phrase: "microsdhc" },
  { cls: "sdcard", phrase: "sdxc" },
  { cls: "sdcard", phrase: "sdhc" },
  { cls: "sdcard", phrase: "sd card" },
  { cls: "sdcard", phrase: "memory card" },
  { cls: "flash", phrase: "فلش مموری" },
  { cls: "flash", phrase: "فلش" },
  { cls: "flash", phrase: "flash drive" },
  // ── شبکه
  { cls: "switch", phrase: "سوییچ" },
  { cls: "switch", phrase: "switch" },
  { cls: "router", phrase: "روتر" },
  { cls: "router", phrase: "router" },
  { cls: "router", sub: "modem", phrase: "مودم" },
  { cls: "router", sub: "modem", phrase: "modem" },
  { cls: "ap", phrase: "اکسس پوینت" },
  { cls: "ap", phrase: "اکسسپوینت" },
  { cls: "ap", phrase: "access point" },
  { cls: "repeater", phrase: "ریپیتر" },
  { cls: "repeater", phrase: "اکستندر" },
  { cls: "repeater", phrase: "repeater" },
  { cls: "repeater", phrase: "extender" },
  { cls: "nic", phrase: "کارت شبکه" },
  // ── برق
  { cls: "psu", phrase: "منبع تغذیه" },
  { cls: "psu", phrase: "پاور" },
  { cls: "psu", phrase: "power supply" },
  { cls: "psu", phrase: "آداپتور" },
  { cls: "psu", phrase: "اداپتور" },
  { cls: "psu", phrase: "adapter" },
  { cls: "psu", phrase: "adaptor" },
  { cls: "psu", phrase: "ترانس" },
  { cls: "psu", phrase: "شارژر" },
  { cls: "ups", phrase: "یو پی اس" },
  { cls: "ups", phrase: "ups" },
  { cls: "surge", phrase: "محافظ برق" },
  { cls: "surge", phrase: "محافظ ولتاژ" },
  { cls: "surge", phrase: "محافظ صاعقه" },
  // ── کابل
  { cls: "cable", sub: "patch", phrase: "پچ کورد" },
  { cls: "cable", sub: "patch", phrase: "پچ" },
  { cls: "cable", sub: "patch", phrase: "patch cord" },
  { cls: "cable", sub: "patch", phrase: "patch cable" },
  { cls: "cable", phrase: "کابل" },
  { cls: "cable", phrase: "cable" },
  { cls: "cable", phrase: "سیم" },
  // ── نمایش و جانبی کامپیوتر
  { cls: "monitor", phrase: "مانیتور" },
  { cls: "monitor", phrase: "نمایشگر" },
  { cls: "monitor", phrase: "monitor" },
  { cls: "mouse", phrase: "ماوس" },
  { cls: "mouse", phrase: "موس" },
  { cls: "mouse", phrase: "mouse" },
  // ── لوازم جانبی/قطعات (head اگر اول بیاید ⇒ کارت «لوازم جانبی» است)
  { cls: "acc:mount", phrase: "پایه" },
  { cls: "acc:mount", phrase: "براکت" },
  { cls: "acc:mount", phrase: "bracket" },
  { cls: "acc:mount", phrase: "mount" },
  { cls: "acc:mount", phrase: "stand" },
  { cls: "acc:tripod", phrase: "سه پایه" },
  { cls: "acc:cover", phrase: "کاور" },
  { cls: "acc:cover", phrase: "قاب" },
  { cls: "acc:cover", phrase: "هوزینگ" },
  { cls: "acc:cover", phrase: "housing" },
  { cls: "acc:cover", phrase: "سایبان" },
  { cls: "acc:cover", phrase: "پوسته" },
  { cls: "acc:cover", phrase: "محافظ" },
  { cls: "acc:junction", phrase: "جعبه تقسیم" },
  { cls: "acc:junction", phrase: "جعبه اتصال" },
  { cls: "acc:junction", phrase: "جانکشن" },
  { cls: "acc:junction", phrase: "junction" },
  { cls: "acc:junction", phrase: "باکس اتصال" },
  { cls: "acc:junction", phrase: "کم باکس" },
  { cls: "acc:connector", phrase: "فیش" },
  { cls: "acc:connector", phrase: "سوکت" },
  { cls: "acc:connector", phrase: "کانکتور" },
  { cls: "acc:connector", phrase: "connector" },
  { cls: "acc:connector", phrase: "جک" },
  { cls: "acc:connector", phrase: "jack" },
  { cls: "acc:connector", phrase: "بالون" },
  { cls: "acc:connector", phrase: "balun" },
  { cls: "acc:remote", phrase: "ریموت" },
  { cls: "acc:remote", phrase: "remote" },
  { cls: "acc:reader", phrase: "ریدر" },
  { cls: "acc:reader", phrase: "reader" },
  { cls: "acc:case", phrase: "کیس هارد" },
  { cls: "acc:case", phrase: "کیس" },
  { cls: "acc:case", phrase: "داک" },
  { cls: "acc:case", phrase: "dock" },
  { cls: "acc:case", phrase: "enclosure" },
  { cls: "acc:module", phrase: "ماژول" },
  { cls: "acc:module", phrase: "module" },
  { cls: "acc:module", phrase: "sfp" },
  { cls: "acc:lens", phrase: "لنز" },
  { cls: "acc:lens", phrase: "lens" },
  { cls: "acc:antenna", phrase: "آنتن" },
  { cls: "acc:antenna", phrase: "antenna" },
  { cls: "acc:screw", phrase: "پیچ" },
  { cls: "acc:screw", phrase: "رولپلاک" },
  { cls: "acc:pad", phrase: "پد" },
  { cls: "acc:bag", phrase: "کیف" },
  { cls: "acc:rack", phrase: "رک" },
  { cls: "acc:rack", phrase: "rack" },
  { cls: "acc:board", phrase: "برد" },
  { cls: "acc:manual", phrase: "دفترچه" },
  { cls: "acc:box", phrase: "کارتن" },
  { cls: "acc:box", phrase: "جعبه خالی" },
];

export interface ClassHit {
  cls: string;
  sub?: string;
  /** شاخص توکن آغاز */
  at: number;
  len: number;
}

const CLASS_INDEX = new Map<string, Array<{ tokens: string[]; def: ClassDef }>>();
for (const def of CLASS_DEFS) {
  const tokens = tokenize(normalizeText(def.phrase));
  if (!tokens.length) continue;
  const bucket = CLASS_INDEX.get(tokens[0]) ?? [];
  bucket.push({ tokens, def });
  bucket.sort((a, b) => b.tokens.length - a.tokens.length);
  CLASS_INDEX.set(tokens[0], bucket);
}

/** همهٔ برخوردهای رده در توکن‌ها (بلندترین عبارت اول، بدون هم‌پوشانی) */
export function scanClasses(tokens: string[]): ClassHit[] {
  const hits: ClassHit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const bucket = CLASS_INDEX.get(tokens[i]);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (cand.tokens.every((t, k) => tokens[i + k] === t)) {
        hits.push({ cls: cand.def.cls, sub: cand.def.sub, at: i, len: cand.tokens.length });
        i += cand.tokens.length - 1;
        break;
      }
    }
  }
  return hits;
}

// ───────────────────────────── ویژگی‌های فرعی (فرم/فناوری) ─────────────────────────────

interface FeatureDef {
  feature: string;
  value: string;
  phrase: string;
}

const FEATURE_DEFS: FeatureDef[] = [
  // شکل دوربین
  { feature: "form", value: "bullet", phrase: "بولت" },
  { feature: "form", value: "bullet", phrase: "بالت" },
  { feature: "form", value: "bullet", phrase: "bullet" },
  { feature: "form", value: "dome", phrase: "دام" },
  { feature: "form", value: "dome", phrase: "dome" },
  { feature: "form", value: "dome", phrase: "گنبدی" },
  { feature: "form", value: "ptz", phrase: "ptz" },
  { feature: "form", value: "ptz", phrase: "اسپید دام" },
  { feature: "form", value: "ptz", phrase: "اسپیددام" },
  { feature: "form", value: "ptz", phrase: "speed dome" },
  { feature: "form", value: "ptz", phrase: "چرخشی" },
  { feature: "form", value: "fisheye", phrase: "فیش آی" },
  { feature: "form", value: "fisheye", phrase: "fisheye" },
  // فناوری دوربین/دستگاه
  { feature: "tech", value: "ip", phrase: "تحت شبکه" },
  { feature: "tech", value: "ip", phrase: "تحتشبکه" },
  { feature: "tech", value: "ip", phrase: "ip" },
  { feature: "tech", value: "analog", phrase: "انالوگ" },
  { feature: "tech", value: "analog", phrase: "analog" },
  { feature: "tech", value: "analog", phrase: "ahd" },
  { feature: "tech", value: "analog", phrase: "tvi" },
  { feature: "tech", value: "analog", phrase: "cvi" },
  { feature: "tech", value: "analog", phrase: "hd-tvi" },
  { feature: "tech", value: "analog", phrase: "hdtvi" },
  { feature: "tech", value: "analog", phrase: "hd-cvi" },
  { feature: "tech", value: "analog", phrase: "hdcvi" },
  { feature: "tech", value: "analog", phrase: "cvbs" },
  // نوع هارد
  { feature: "hddkind", value: "internal", phrase: "اینترنال" },
  { feature: "hddkind", value: "internal", phrase: "internal" },
  { feature: "hddkind", value: "internal", phrase: "داخلی" },
  { feature: "hddkind", value: "external", phrase: "اکسترنال" },
  { feature: "hddkind", value: "external", phrase: "external" },
  { feature: "hddkind", value: "external", phrase: "پرتابل" },
  { feature: "hddkind", value: "external", phrase: "portable" },
  // محیط نصب
  { feature: "wireless", value: "yes", phrase: "وای فای" },
  { feature: "wireless", value: "yes", phrase: "wifi" },
  { feature: "wireless", value: "yes", phrase: "wi-fi" },
  { feature: "wireless", value: "yes", phrase: "بیسیم" },
  { feature: "wireless", value: "yes", phrase: "بی سیم" },
];

const FEATURE_INDEX = new Map<string, Array<{ tokens: string[]; def: FeatureDef }>>();
for (const def of FEATURE_DEFS) {
  const tokens = tokenize(normalizeText(def.phrase));
  if (!tokens.length) continue;
  const bucket = FEATURE_INDEX.get(tokens[0]) ?? [];
  bucket.push({ tokens, def });
  bucket.sort((a, b) => b.tokens.length - a.tokens.length);
  FEATURE_INDEX.set(tokens[0], bucket);
}

export function scanFeatures(tokens: string[], limitTo?: number): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const end = limitTo ?? tokens.length;
  for (let i = 0; i < end; i++) {
    const bucket = FEATURE_INDEX.get(tokens[i]);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (cand.tokens.every((t, k) => tokens[i + k] === t)) {
        (out[cand.def.feature] ??= new Set()).add(cand.def.value);
        i += cand.tokens.length - 1;
        break;
      }
    }
  }
  return out;
}

// ───────────────────────────── نشانگرها ─────────────────────────────

const phraseSet = (phrases: string[]): string[][] => phrases.map((p) => tokenize(normalizeText(p))).filter((t) => t.length);

/** نشانگر «سازگار با/مناسب برای» — پس از آن معمولاً دستگاه میزبان می‌آید */
export const COMPAT_MARKERS = phraseSet(["مناسب", "مخصوص", "ویژه", "برای", "سازگار", "جهت", "compatible", "for", "fits"]);
/** نشانگر «همراه با» — اقلام همراه */
export const COMPANION_MARKERS = phraseSet(["به همراه", "همراه", "بهمراه", "همراه با", "به علاوه", "بعلاوه", "plus", "with", "شامل"]);
export const PACK_WORDS = new Set(["پک", "بسته", "ست", "کیت", "پکیج", "باندل", "pack", "kit", "set", "bundle", "combo", "کمبو"]);
export const QTY_UNIT_WORDS = new Set(["عددی", "تایی", "عدد", "دستگاهی", "دانه", "تکی", "pcs", "pc"]);

export const USED_PHRASES = phraseSet([
  "استوک",
  "کارکرده",
  "کار کرده",
  "دست دوم",
  "دستدوم",
  "ریفربیش",
  "ریفرب",
  "refurbished",
  "refurb",
  "used",
  "second hand",
  "secondhand",
  "open box",
  "openbox",
  "اپن باکس",
  "بازبسته",
  "مرجوعی",
  "درجه 2",
  "درجه دو",
]);

export const COUNTERFEIT_PHRASES = phraseSet([
  "های کپی",
  "کپی برابر اصل",
  "کپی اصلی",
  "تقلبی",
  "غیر اصل",
  "غیراصل",
  "غیر اورجینال",
  "غیراورجینال",
  "فیک",
  "fake",
  "replica",
]);

export const DEFECTIVE_PHRASES = phraseSet(["خراب", "سوخته", "معیوب", "تعمیری", "اوراقی", "ایراد دار", "ایرادی", "برای قطعات", "جهت قطعات"]);

/** واژه‌های توقف/بی‌اثر (هیچ اطلاعات هویتی ندارند) */
export const STOPWORDS = new Set(
  [
    "و", "یا", "در", "به", "از", "با", "تا", "برای", "که", "این", "آن", "را", "هم", "یک", "دارای", "بدون", "مدل", "کد", "برند", "نوع", "طرح",
    "مشخصات", "قیمت", "خرید", "فروش", "فروشگاه", "ارسال", "فوری", "رایگان", "موجود", "پیش", "تحویل", "همراه", "بهمراه",
    "اصلی", "اصل", "اورجینال", "اصالت", "سلامت", "فیزیکی", "جدید", "جدیدترین", "نسخه", "نو", "اکبند", "پلمپ", "گارانتی", "ضمانت", "تضمینی",
    "شرکتی", "رسمی", "ماهه", "ساله", "سال", "ماه", "کیفیت", "عالی", "ظرفیت", "رزولوشن", "طول", "اندازه", "سایز", "کد", "مناسب", "ویژه", "مخصوص", "جهت", "سازگار",
    "of", "the", "and", "for", "with", "new", "original", "model", "code", "series", "ser",
  ].map((w) => normalizeText(w)),
);

/** کلمات عمومی دسته‌بندی (به‌تنهایی هویتی نیستند) */
export const GENERIC_WORDS = new Set(
  [
    "دوربین", "مداربسته", "دستگاه", "دیجیتال", "شبکه", "تحت", "امنیتی", "سیستم", "پکیج", "تصویر", "دید", "شب", "رنگی", "فلزی", "پلاستیکی",
    "بولت", "دام", "بزرگ", "کوچک", "نسل", "سنسور", "چشمی", "هوشمند", "بیسیم", "بی", "سیم", "وارم", "لایت", "ضد", "اب", "پشتیبانی", "قابلیت",
    "میکروفون", "میکروفن", "داخلی", "خارجی", "صدا", "ضبط", "ویدیو", "ویدئو", "کننده", "هارد", "دیسک", "اینترنال", "اکسترنال", "کارت", "حافظه",
    "سوییچ", "روتر", "کابل", "منبع", "تغذیه", "ip", "poe", "cctv", "camera", "dvr", "nvr", "xvr", "hdd", "switch", "router", "port", "gigabit",
    // معادل‌های انگلیسیِ توصیفی (عنوان انگلیسی ترب اغلب ترجمهٔ همان عنوان فارسی است و نشانهٔ «سری/نسخهٔ متفاوت» نیست)
    "network", "networking", "cable", "cables", "wireless", "wired", "internal", "external", "hard", "drive", "disk", "disc", "memory", "cards",
    "cameras", "dome", "bullet", "indoor", "outdoor", "surveillance", "security", "system", "power", "supply", "adapter", "adaptor", "wall",
    "bracket", "ethernet", "fixed", "kit", "black", "white", "original", "genuine", "new", "with", "for", "and", "the", "series", "model", "type",
    "access", "point", "wifi", "video", "recorder", "digital", "analog", "analogue", "hybrid", "channel", "channels", "ports", "modem",
    "storage", "flash", "connector", "cord", "patch", "remote", "control", "controller", "door", "gate", "opener", "automatic", "battery",
    "charger", "unit", "device", "mount", "ceiling", "desktop", "rack", "full", "high", "definition", "resolution", "night", "vision",
    "waterproof", "weatherproof", "metal", "plastic", "internal", "speed", "class", "capacity", "size", "length", "meter", "meters", "mouse",
  ].map((w) => normalizeText(w)),
);

/** واژه‌های فارسیِ نوع‌ساز: وجودشان فقط در یک طرف یعنی واریانت متفاوت (مدیریتی ≠ ساده ، پرو ≠ معمولی) */
export const VARIANT_WORDS = new Set(
  ["مدیریتی", "پرو", "پلاس", "مینی", "لایت", "اکستریم", "اولترا", "رکمونت", "دسکتاپ", "سقفی", "حرفه ای", "حرفهای", "اکسترنال", "اینترنال", "پرتابل", "بنفش", "قرمز", "مشکی", "سفید", "آبی"].map((w) =>
    normalizeText(w),
  ),
);
