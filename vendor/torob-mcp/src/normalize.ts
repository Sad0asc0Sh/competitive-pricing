// Pure helpers: Persian numbers, coercions and the small URL/shape fixes the
// projection layer needs. Built-in Persian/Arabic folding without external deps.

export const ZWNJ = "\u200c";

export function faFold(input: unknown): string {
  if (input == null) return "";
  return String(input)
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[يئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/[\u200c\u200d\u200e\u200f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function faSearchVariants(input: unknown): string[] {
  const raw = String(input ?? "").trim();
  if (!raw) return [];
  const folded = faFold(raw);
  const joined = folded.replace(/\s+/g, ZWNJ);
  return [...new Set([raw, folded, joined].filter(Boolean))];
}

export function foldKey(v: unknown): string {
  return faFold(str(v)).toLowerCase();
}

export function searchTerm(v: unknown): string {
  let s = str(v);
  for (const code of [0x200c, 0x200d]) s = s.split(String.fromCharCode(code)).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

export function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

export function num(v: unknown, fallback: number): number {
  const text = str(v).replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
  const n = typeof v === "number" ? v : parseFloat(text);
  return Number.isFinite(n) ? n : fallback;
}

export function short(s: unknown, n = 220): string | null {
  const t = str(s).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, Math.max(1, n - 3)) + "..." : t;
}

export function clampLimit(v: unknown, def = 10, max = 30): number {
  return Math.min(Math.max(Math.floor(num(v, def)) || def, 1), max);
}

export function clampPage(v: unknown, max = 50): number {
  return Math.min(Math.max(Math.floor(num(v, 1)) || 1, 1), max);
}

export function pageClampNote(v: unknown, max = 50): Record<string, unknown> {
  const requested = Math.floor(num(v, 1)) || 1;
  if (requested <= max) return {};
  return {
    page_clamped: true,
    page_requested: requested,
    page_note: `Torob serves at most ${max} pages per search here; page ${requested} was clamped to ${max}.`,
  };
}

const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function tomanFromText(s: unknown): number | null {
  const t = str(s).replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
  const m = t.match(/\d[\d٬,\s٫\.]*/);
  if (!m) return null;
  const digits = m[0].replace(/[٬,\s٫\.]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

export function toman(v: unknown): number | null {
  return num(v, 0) > 0 ? Math.round(num(v, 0)) : null;
}

export function availableFrom(price: number | null): boolean {
  return price !== null && price > 0;
}

export function formatToman(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return n.toLocaleString("en-US").replace(/,/g, "٬");
}

export function productUrl(path: unknown, prk: unknown): string | null {
  const key = str(prk).trim();
  if (key) return `https://torob.com/p/${key}/`;
  const p = str(path).trim();
  if (!p) return null;
  if (p.startsWith("http")) return p;
  return `https://torob.com${p.startsWith("/") ? "" : "/"}${p}`;
}
