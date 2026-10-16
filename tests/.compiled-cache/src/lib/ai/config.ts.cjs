"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASKED_SECRET = exports.SUBQ_SETTINGS_KEY = exports.AI_SETTINGS_KEY = exports.DEFAULT_AI_MODEL = exports.DEFAULT_AI_BASE_URL = void 0;
exports.maskApiKey = maskApiKey;
exports.invalidateAIConfigCache = invalidateAIConfigCache;
exports.readStoredProvider = readStoredProvider;
exports.writeStoredProvider = writeStoredProvider;
exports.getAIConfig = getAIConfig;
exports.getSubqConfig = getSubqConfig;
exports.resolveSubqRuntime = resolveSubqRuntime;
exports.getAIStatus = getAIStatus;
exports.saveProviderConfig = saveProviderConfig;
const systemone_supervisor_1 = require("../pricing/systemone-supervisor");
/**
 * لایه پیکربندی واقعی هوش مصنوعی:
 *  - توکن/آدرس/مدل را می‌توان از پنل تنظیمات (ذخیره در جدول `settings`) وارد کرد.
 *  - در نبود مقدار دیتابیس، از متغیرهای محیطی (`.env`) استفاده می‌شود.
 *  - precedence: دیتابیس (پنل) > پروفایل قیمت‌گذاری > env > پیش‌فرض.
 *
 * نکته فنی: اتصال دیتابیس به‌صورت lazy (dynamic import) انجام می‌شود تا
 * موتور قیمت‌گذاری و تست‌های خالص آن به DATABASE_URL/درایور Postgres وابسته نشوند.
 */
exports.DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
exports.DEFAULT_AI_MODEL = "gpt-4o-mini";
exports.AI_SETTINGS_KEY = "ai_config";
exports.SUBQ_SETTINGS_KEY = "subq_config";
exports.MASKED_SECRET = "••••••••";
const CACHE_TTL_MS = 5000;
const cache = new Map();
function cleanUrl(v) {
    return (v ?? "").trim().replace(/\/+$/, "");
}
function maskApiKey(key) {
    const k = (key ?? "").trim();
    if (!k)
        return "";
    if (k.length <= 8)
        return exports.MASKED_SECRET;
    return `${k.slice(0, 3)}${exports.MASKED_SECRET}${k.slice(-4)}`;
}
function invalidateAIConfigCache() {
    cache.clear();
}
/** خواندن پیکربندی ذخیره‌شده در جدول settings (با کش کوتاه‌مدت و بدون وابستگی استاتیک به db) */
async function readStoredProvider(key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS)
        return hit.value;
    let value = null;
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("@/db")));
        const res = await pool.query("select value from settings where key = $1 limit 1", [key]);
        const raw = res.rows[0]?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            value = raw;
        }
    }
    catch {
        value = null;
    }
    cache.set(key, { at: Date.now(), value });
    return value;
}
/** ذخیره پیکربندی در جدول settings (upsert) */
async function writeStoredProvider(key, value) {
    const { pool } = await Promise.resolve().then(() => __importStar(require("@/db")));
    await pool.query(`insert into settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]);
    invalidateAIConfigCache();
}
function providerFrom(stored, env, defaults) {
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
async function getAIConfig() {
    return providerFrom(await readStoredProvider(exports.AI_SETTINGS_KEY), {
        apiKey: process.env.AI_API_KEY ?? "",
        baseUrl: process.env.AI_BASE_URL ?? "",
        model: process.env.AI_MODEL ?? "",
    }, { baseUrl: exports.DEFAULT_AI_BASE_URL, model: exports.DEFAULT_AI_MODEL });
}
/** پیکربندی مؤثر ناظر SubQ SystemOne */
async function getSubqConfig() {
    return providerFrom(await readStoredProvider(exports.SUBQ_SETTINGS_KEY), {
        apiKey: process.env.SUBQ_API_KEY ?? "",
        baseUrl: process.env.SUBQ_BASE_URL ?? "",
        model: process.env.SUBQ_MODEL ?? "",
    }, { baseUrl: systemone_supervisor_1.DEFAULT_SUBQ_BASE_URL, model: systemone_supervisor_1.DEFAULT_SUBQ_MODEL });
}
/** ترکیب توکن/آدرس/مدل واقعی ناظر با پروفایل قیمت‌گذاری برای اجرای درون‌خطی (runner) */
async function resolveSubqRuntime(profile) {
    const cfg = await getSubqConfig();
    const envKey = (process.env.SUBQ_API_KEY ?? "").trim();
    const envBase = cleanUrl(process.env.SUBQ_BASE_URL);
    const envModel = (process.env.SUBQ_MODEL ?? "").trim();
    return {
        apiKey: cfg.apiKey || profile.apiKey || envKey,
        baseUrl: cleanUrl(cfg.baseUrl) || cleanUrl(profile.baseUrl) || envBase || systemone_supervisor_1.DEFAULT_SUBQ_BASE_URL,
        model: cfg.model || profile.model || envModel || systemone_supervisor_1.DEFAULT_SUBQ_MODEL,
    };
}
function toStatus(cfg, envPresent, stored) {
    const dbKey = (stored?.apiKey ?? "").trim();
    const source = dbKey ? "db" : envPresent ? "env" : "none";
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
async function getAIStatus() {
    const [aiStored, subqStored, ai, subq] = await Promise.all([
        readStoredProvider(exports.AI_SETTINGS_KEY),
        readStoredProvider(exports.SUBQ_SETTINGS_KEY),
        getAIConfig(),
        getSubqConfig(),
    ]);
    return {
        ai: toStatus(ai, Boolean((process.env.AI_API_KEY ?? "").trim()), aiStored),
        subq: toStatus(subq, Boolean((process.env.SUBQ_API_KEY ?? "").trim()), subqStored),
    };
}
/**
 * ذخیره امن پیکربندی: اگر apiKey خالی/ناماسک باشد، توکن قبلی حفظ می‌شود؛
 * فقط با clearApiKey=true توکن پاک می‌شود. مقدار ماسک‌شده هرگز ذخیره نمی‌شود.
 */
async function saveProviderConfig(key, input) {
    const existing = (await readStoredProvider(key)) ?? {};
    const next = { ...existing };
    if (typeof input.enabled === "boolean")
        next.enabled = input.enabled;
    if (typeof input.baseUrl === "string")
        next.baseUrl = input.baseUrl.trim();
    if (typeof input.model === "string")
        next.model = input.model.trim();
    if (input.clearApiKey === true) {
        next.apiKey = "";
    }
    else if (typeof input.apiKey === "string") {
        const candidate = input.apiKey.trim();
        const looksMasked = candidate.includes(exports.MASKED_SECRET) || /^•+$/.test(candidate);
        if (candidate && !looksMasked)
            next.apiKey = candidate;
    }
    await writeStoredProvider(key, next);
    return next;
}
