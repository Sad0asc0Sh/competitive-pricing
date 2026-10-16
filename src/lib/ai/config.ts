import { DEFAULT_SUBQ_BASE_URL, DEFAULT_SUBQ_MODEL } from "@/lib/pricing/systemone-supervisor";
import type { SystemOneSupervisorConfig } from "@/lib/pricing/types";

/**
 * لایه پیکربندی واقعی هوش مصنوعی:
 *  - توکن/آدرس/مدل را می‌توان از پنل تنظیمات (ذخیره در جدول `settings`) وارد کرد.
 *  - در نبود مقدار دیتابیس، از متغیرهای محیطی (`.env`) استفاده می‌شود.
 *  - precedence: دیتابیس (پنل) > پروفایل قیمت‌گذاری > env > پیش‌فرض.
 *
 * نکته فنی: اتصال دیتابیس به‌صورت lazy (dynamic import) انجام می‌شود تا
 * موتور قیمت‌گذاری و تست‌های خالص آن به DATABASE_URL/درایور Postgres وابسته نشوند.
 */

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";
export const AI_SETTINGS_KEY = "ai_config";
export const SUBQ_SETTINGS_KEY = "subq_config";
export const MASKED_SECRET = "••••••••";

export type ProviderSource = "db" | "env" | "none";

export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ProviderStoredConfig {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ProviderStatus {
  enabled: boolean;
  configured: boolean;
  source: ProviderSource;
  baseUrl: string;
  model: string;
  apiKeyHint: string;
}

export interface AIStatus {
  ai: ProviderStatus;
  subq: ProviderStatus;
}

const CACHE_TTL_MS = 5000;
const cache = new Map<string, { at: number; value: ProviderStoredConfig | null }>();

function cleanUrl(v: string | undefined | null): string {
  return (v ?? "").trim().replace(/\/+$/, "");
}

export function maskApiKey(key: string | null | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return "";
  if (k.length <= 8) return MASKED_SECRET;
  return `${k.slice(0, 3)}${MASKED_SECRET}${k.slice(-4)}`;
}

export function invalidateAIConfigCache(): void {
  cache.clear();
}

/** خواندن پیکربندی ذخیره‌شده در جدول settings (با کش کوتاه‌مدت و بدون وابستگی استاتیک به db) */
export async function readStoredProvider(key: string): Promise<ProviderStoredConfig | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: ProviderStoredConfig | null = null;
  try {
    const { pool } = await import("@/db");
    const res = await pool.query<{ value: unknown }>("select value from settings where key = $1 limit 1", [key]);
    const raw = res.rows[0]?.value;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      value = raw as ProviderStoredConfig;
    }
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** ذخیره پیکربندی در جدول settings (upsert) */
export async function writeStoredProvider(key: string, value: ProviderStoredConfig): Promise<void> {
  const { pool } = await import("@/db");
  await pool.query(
    `insert into settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  invalidateAIConfigCache();
}

function providerFrom(stored: ProviderStoredConfig | null, env: { apiKey: string; baseUrl: string; model: string }, defaults: { baseUrl: string; model: string }): ProviderConfig {
  const dbKey = (stored?.apiKey ?? "").trim();
  const envKey = env.apiKey.trim();
  const apiKey = dbKey || envKey;
  const baseUrl = cleanUrl(stored?.baseUrl) || cleanUrl(env.baseUrl) || defaults.baseUrl;
  const model = (stored?.model ?? "").trim() || env.model.trim() || defaults.model;
  return {
    enabled: stored?.enabled !== false && Boolean(apiKey),
    apiKey,
    baseUrl,
    model,
  };
}

/** پیکربندی مؤثر هوش مصنوعی مکمل (OpenAI-compatible) */
export async function getAIConfig(): Promise<ProviderConfig> {
  return providerFrom(
    await readStoredProvider(AI_SETTINGS_KEY),
    {
      apiKey: process.env.AI_API_KEY ?? "",
      baseUrl: process.env.AI_BASE_URL ?? "",
      model: process.env.AI_MODEL ?? "",
    },
    { baseUrl: DEFAULT_AI_BASE_URL, model: DEFAULT_AI_MODEL },
  );
}

/** پیکربندی مؤثر ناظر SubQ SystemOne */
export async function getSubqConfig(): Promise<ProviderConfig> {
  return providerFrom(
    await readStoredProvider(SUBQ_SETTINGS_KEY),
    {
      apiKey: process.env.SUBQ_API_KEY ?? "",
      baseUrl: process.env.SUBQ_BASE_URL ?? "",
      model: process.env.SUBQ_MODEL ?? "",
    },
    { baseUrl: DEFAULT_SUBQ_BASE_URL, model: DEFAULT_SUBQ_MODEL },
  );
}

/** ترکیب توکن/آدرس/مدل واقعی ناظر با پروفایل قیمت‌گذاری برای اجرای درون‌خطی (runner) */
export async function resolveSubqRuntime(
  profile: SystemOneSupervisorConfig,
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const cfg = await getSubqConfig();
  const envKey = (process.env.SUBQ_API_KEY ?? "").trim();
  const envBase = cleanUrl(process.env.SUBQ_BASE_URL);
  const envModel = (process.env.SUBQ_MODEL ?? "").trim();
  return {
    apiKey: cfg.apiKey || profile.apiKey || envKey,
    baseUrl: cleanUrl(cfg.baseUrl) || cleanUrl(profile.baseUrl) || envBase || DEFAULT_SUBQ_BASE_URL,
    model: cfg.model || profile.model || envModel || DEFAULT_SUBQ_MODEL,
  };
}

function toStatus(cfg: ProviderConfig, envPresent: boolean, stored: ProviderStoredConfig | null): ProviderStatus {
  const dbKey = (stored?.apiKey ?? "").trim();
  const source: ProviderSource = dbKey ? "db" : envPresent ? "env" : "none";
  return {
    enabled: cfg.enabled,
    configured: Boolean(cfg.apiKey),
    source,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKeyHint: maskApiKey(cfg.apiKey),
  };
}

/** وضعیت تجمیعی هوش مصنوعی برای داشبورد، تنظیمات و /api/health (بدون افشای توکن) */
export async function getAIStatus(): Promise<AIStatus> {
  const [aiStored, subqStored, ai, subq] = await Promise.all([
    readStoredProvider(AI_SETTINGS_KEY),
    readStoredProvider(SUBQ_SETTINGS_KEY),
    getAIConfig(),
    getSubqConfig(),
  ]);
  return {
    ai: toStatus(ai, Boolean((process.env.AI_API_KEY ?? "").trim()), aiStored),
    subq: toStatus(subq, Boolean((process.env.SUBQ_API_KEY ?? "").trim()), subqStored),
  };
}

export interface SaveProviderInput {
  enabled?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  model?: string;
}

/**
 * ذخیره امن پیکربندی: اگر apiKey خالی/ناماسک باشد، توکن قبلی حفظ می‌شود؛
 * فقط با clearApiKey=true توکن پاک می‌شود. مقدار ماسک‌شده هرگز ذخیره نمی‌شود.
 */
export async function saveProviderConfig(key: string, input: SaveProviderInput): Promise<ProviderStoredConfig> {
  const existing = (await readStoredProvider(key)) ?? {};
  const next: ProviderStoredConfig = { ...existing };

  if (typeof input.enabled === "boolean") next.enabled = input.enabled;
  if (typeof input.baseUrl === "string") next.baseUrl = input.baseUrl.trim();
  if (typeof input.model === "string") next.model = input.model.trim();

  if (input.clearApiKey === true) {
    next.apiKey = "";
  } else if (typeof input.apiKey === "string") {
    const candidate = input.apiKey.trim();
    const looksMasked = candidate.includes(MASKED_SECRET) || /^•+$/.test(candidate);
    if (candidate && !looksMasked) next.apiKey = candidate;
  }

  await writeStoredProvider(key, next);
  return next;
}
