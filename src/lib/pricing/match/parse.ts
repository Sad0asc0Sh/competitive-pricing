/**
 * تجزیهٔ ساختاریافتهٔ عنوان محصول: برند، کدهای مدل، رده (head noun)، مشخصات تایپ‌شده، پک/استوک/کپی و واژه‌های توصیفی.
 */
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
  codes: ParsedCode[];
  head: ClassHit | null;
  hits: ClassHit[];
  features: Record<string, string[]>;
  attrs: Record<string, AttrValue[]>;
  pack: PackInfo | null;
  used: string | null;
  counterfeit: string | null;
  defective: string | null;
  bundleWith: string[];
  withAccessories: string[];
  words: string[];
}

// ───────────────────────────── کد مدل ─────────────────────────────

const SPEC_TOKEN_PATTERNS: RegExp[] = [
  /^\d+(?:\.\d+)?(?:mp|mm|cm|m|v|vdc|vac|a|w|hz|khz|mhz|ghz|mbps|gbps|kbps|tb|gb|mb|kb|ch|p|k|x|inch|ma|mah|ah|db|dbi|lux|fps|ohm|pin|port|ports|core|pcs|pc)$/,
  /^\d+(?:\.\d+)?v[/-]\d+(?:\.\d+)?a$/,
  /^\d+-?(?:port|ports)$/,
  /^(?:ir\d{1,3}m?|\d{1,2}led|led\d{1,2}|smd\d*|wdr\d*|dwdr|v\d(?:\.\d+)?|\d+db|\d+fps|\d+x)$/,
  /^(?:h\.?26[45]\+?|ip\d{2}|cat\.?\d[ae]?|rg-?\d{1,2}(?:\+\d)?|usb\d?(?:\.\d)?|sata\d?|poe\+?|hdmi\d?|wifi\d?|wi-fi\d?|ac\d{3,4}|ax\d{3,5}|n\d{3,4}|sfp\+?|ddr\d|nvme|m\.2|802\.11[a-z]*|\d+k|\d{3,4}p|hd-?tvi|hd-?cvi|ahd\d?|tvi\d?|cvi\d?|lte|[2-5]g|\d+x\d+|\d+\/\d+(?:\/\d+)*)$/,
];

export function isSpecToken(tok: string): boolean {
  return SPEC_TOKEN_PATTERNS.some((re) => re.test(tok));
}

/** واژه‌هایی که با عدد/حرف بعدی ترکیب می‌شوند و کد مدل می‌سازند (Archer C6 ⇒ ARCHERC6) */
const SERIES_WORDS = new Set(["archer", "deco", "tapo", "hap"]);

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
  v: ["v", "ولت", "volt", "vdc"],
  a: ["a", "آمپر", "امپر", "amp", "ampere"],
  m: ["m", "متر", "متری", "meter", "metre"],
  mm: ["mm", "میلیمتر", "میلیمتری"],
  inch: ["inch", "اینچ", "اینچی"],
};
const UNIT_MAP = new Map<string, string>();
for (const [unit, words] of Object.entries(UNIT_SOURCE)) for (const w of words) UNIT_MAP.set(normalizeText(w), unit);

const WORD_NUMBERS_FA_PERSIAN_RE = /^\d+(?:\.\d+)?$/;

function addAttr(attrs: Record<string, AttrValue[]>, key: string, value: AttrValue): void {
  const arr = (attrs[key] ??= []);
  if (!arr.includes(value)) arr.push(value);
}

const RES_P_TO_MP: Record<string, number> = { "720p": 1, "960p": 1.3, "1080p": 2, "1440p": 4, "2k": 4, "4k": 8, "8k": 33 };

function extractAttrs(tokens: string[], end: number, consumed: Set<number>): Record<string, AttrValue[]> {
  const attrs: Record<string, AttrValue[]> = {};
  const n = Math.min(end, tokens.length);

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
        addAttr(attrs, "cap", Math.round(num));
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
      case "m":
        addAttr(attrs, "len", num);
        break;
      case "mm":
        addAttr(attrs, "lens", num);
        break;
      case "inch":
        addAttr(attrs, "inch", num);
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
    // 2mp ، 4tb ، 2.8mm ، 100m ، 12v …
    m = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(tok);
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
      const span = (k: number): number[] => Array.from({ length: k }, (_, q) => i + q);
      // «میلی متر»
      if (nxt === "میلی" && tokens[i + numLen + 1] === "متر") {
        if (putUnit(num, "mm", span(numLen + 2))) {
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
      addAttr(attrs, "poe", "yes");
      consumed.add(i);
      continue;
    }
    if (tok === "پی" && tokens[i + 1] === "او" && tokens[i + 2] === "ای") {
      addAttr(attrs, "poe", "yes");
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
    m = /^ip(\d{2})$/.exec(tok);
    if (m) {
      addAttr(attrs, "ingress", Number(m[1]));
      consumed.add(i);
      continue;
    }
  }
  return attrs;
}

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

function detectPack(tokens: string[]): PackInfo | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (PACK_WORDS.has(tok)) {
      // پک 4 عددی ، پکیج 4 دوربین ، ست هشت تایی
      for (let k = 1; k <= 3 && i + k < tokens.length; k++) {
        const num = numberFromToken(tokens[i + k]);
        if (num != null && num >= 2) {
          // «پک 1»، «ست 2 پورت» (مشخصات) نباید پک حساب شود
          const unit = UNIT_MAP.get(tokens[i + k + 1] ?? "");
          if (unit && unit !== undefined) break;
          return { qty: num, word: tok };
        }
        if (num != null) break;
      }
      if (tokens[i + 1] === "کامل" || tokens[i + 1] === "کامل") return { qty: null, word: `${tok} کامل` };
      if (tok === "پکیج" || tok === "باندل" || tok === "bundle" || tok === "combo" || tok === "کمبو") return { qty: null, word: tok };
      continue;
    }
    // «4 عددی» ، «دو تایی» ، «۱۰ عدد»
    const num = numberFromToken(tok);
    if (num != null && num >= 2 && i + 1 < tokens.length && QTY_UNIT_WORDS.has(tokens[i + 1])) {
      return { qty: num, word: `${tok} ${tokens[i + 1]}` };
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

  // برند صریح
  const brandScan = scanBrands(tokens);
  for (const k of brandScan.consumed) consumed.add(k);

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
  const compatStart = accessoryHead && head ? firstMarker(tokens, COMPAT_MARKERS, head.at + head.len) : -1;
  const companionStart = head ? firstMarker(tokens, COMPANION_MARKERS, head.at + head.len) : -1;

  // مشخصات: برای لوازم جانبی فقط قبل از بند سازگاری؛ برای کالای اصلی تا قبل از بند «همراه با»
  let attrEnd = tokens.length;
  if (compatStart >= 0) attrEnd = compatStart;
  else if (companionStart >= 0) attrEnd = companionStart;
  const attrs = extractAttrs(tokens, attrEnd, consumed);

  // نوع کابل (فقط برای رده کابل): شبکه/کواکسیال/HDMI/SATA/برق/…
  if (head?.cls === "cable") {
    const body = tokens.slice(0, attrEnd);
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
    if (consumed.has(i) && !looksLikeCode(tok)) continue;
    if (SERIES_WORDS.has(tok) && i + 1 < tokens.length && /^[a-z]{1,3}\d{1,4}[a-z]{0,2}$/.test(tokens[i + 1]) && !isSpecToken(tokens[i + 1])) {
      pushCode(`${tok}-${tokens[i + 1]}`, i);
      consumed.add(i);
      consumed.add(i + 1);
      i += 1;
      continue;
    }
    if (looksLikeCode(tok)) {
      pushCode(tok, i);
      consumed.add(i);
    }
  }

  const impliedBrands = new Set<string>();
  for (const c of codes) if (!c.inCompat && c.brandHint) impliedBrands.add(c.brandHint);

  // پک/استوک/کپی/معیوب (پک فقط پیش از بند «همراه با» معنا دارد: «به همراه ۲ عدد پایه» پک نیست)
  const pack = detectPack(tokens.slice(0, companionStart >= 0 ? companionStart : tokens.length));
  const used = findPhrase(tokens, USED_PHRASES);
  let counterfeit = findPhrase(tokens, COUNTERFEIT_PHRASES);
  if (!counterfeit) {
    // «کپی» به‌تنهایی (قابلیت کپی/بک‌آپ) نشانهٔ تقلبی نیست؛ فقط «کپی <برند>»
    const k = tokens.indexOf("کپی");
    if (k >= 0 && brandScan.consumed.has(k + 1)) counterfeit = "کپی";
  }
  const defective = findPhrase(tokens, DEFECTIVE_PHRASES);

  // ترکیب با اقلام دیگر (پکیج دوربین + دستگاه + هارد) و لوازم همراه
  const bundleWith: string[] = [];
  const withAccessories: string[] = [];
  if (head && !accessoryHead) {
    for (const h of hits.slice(1)) {
      const prev = tokens[h.at - 1];
      const afterCompanion = companionStart >= 0 && h.at > companionStart;
      const conj = prev === "و" || prev === "plus" || prev === "+";
      if (!(afterCompanion || conj)) continue;
      if (h.cls === head.cls) continue;
      if (PRIMARY_NON_ACCESSORY(h.cls)) bundleWith.push(h.cls);
      else withAccessories.push(h.cls);
    }
  }

  // واژه‌های توصیفی (هر آنچه مصرف نشده و بی‌اثر نیست)
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const tok = tokens[i];
    if (tok.length < 2 || /^\d/.test(tok) || /^[\d.]+$/.test(tok)) continue;
    if (STOPWORDS.has(tok) || GENERIC_WORDS.has(tok)) continue;
    if (/^[a-z]+$/.test(tok) && tok.length < 3) continue;
    if (!words.includes(tok)) words.push(tok);
  }

  const parsed: ParsedTitle = {
    norm,
    tokens,
    brands: brandScan.ids,
    impliedBrands: [...impliedBrands],
    codes,
    head,
    hits,
    features,
    attrs,
    pack,
    used,
    counterfeit,
    defective,
    bundleWith,
    withAccessories,
    words,
  };
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(source, parsed);
  return parsed;
}
