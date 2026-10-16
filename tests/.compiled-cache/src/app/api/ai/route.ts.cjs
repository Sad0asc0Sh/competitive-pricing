"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET = GET;
exports.POST = POST;
exports.dynamic = void 0;
var _config = require("../../../lib/ai/config");
var _systemoneSupervisor = require("../../../lib/pricing/systemone-supervisor");
var _server = require("next/server");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
function settingsKeyFor(provider) {
  if (provider === "subq") return _config.SUBQ_SETTINGS_KEY;
  if (provider === "ai") return _config.AI_SETTINGS_KEY;
  return null;
}

/** GET: وضعیت ماسک‌شده هر دو سرویس (بدون افشای توکن) */
async function GET() {
  const status = await (0, _config.getAIStatus)();
  return _server.NextResponse.json(status);
}
async function testAiConnection() {
  const cfg = await (0, _config.getAIConfig)();
  if (!cfg.apiKey) return {
    ok: false,
    message: "توکن ثبت نشده است — ابتدا کلید API را وارد و ذخیره کنید"
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`
      },
      signal: ctrl.signal,
      cache: "no-store"
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const modelCount = Array.isArray(data?.data) ? data.data.length : null;
      return {
        ok: true,
        message: `اتصال برقرار شد (HTTP ${res.status})${modelCount != null ? ` — ${modelCount} مدل در دسترس` : ""} · مدل انتخابی: ${cfg.model}`
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: `توکن رد شد (HTTP ${res.status}) — کلید را بررسی کنید`
      };
    }
    // برخی سرویس‌ها endpoint /models ندارند؛ پاسخ HTTP معتبر یعنی سرور بالاست
    return {
      ok: true,
      message: `سرور پاسخ داد (HTTP ${res.status}) ولی لیست مدل‌ها در دسترس نبود — مدل را دستی بررسی کنید`
    };
  } catch (e) {
    return {
      ok: false,
      message: `عدم دسترسی به سرور: ${e instanceof Error ? e.message : String(e)}`
    };
  } finally {
    clearTimeout(timer);
  }
}
async function testSubqConnection() {
  const cfg = await (0, _config.getSubqConfig)();
  if (!cfg.apiKey) return {
    ok: false,
    message: "توکن SubQ ثبت نشده است — ابتدا SUBQ_API_KEY را وارد و ذخیره کنید"
  };
  const questions = {
    connectivity_probe: {
      type: "noul",
      instructions: "این یک درخواست تست سلامت اتصال از پنل تنظیمات است. اگر پیام کامل و معتبر دریافت شد، میزان اطمینان به سالم بودن مسیر را گزارش کن.",
      criteria: {
        true: "درخواست تست اتصال کامل، معتبر و قابل پاسخ است",
        false: "درخواست تست ناقص، مبهم یا نامعتبر است"
      }
    }
  };
  try {
    const answers = await (0, _systemoneSupervisor.callSubqSystemOneApi)({
      state: "تست اتصال پنل تنظیمات سامانه قیمت‌گذاری: یک درخواست سلامت با مدل پیش‌فرض ارسال شده است.",
      questions,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      timeoutMs: 15000
    });
    if (!answers) {
      return {
        ok: false,
        message: "سرور پاسخ داد ولی ساختار پاسخ (answers/noul) معتبر نبود"
      };
    }
    const probe = answers.connectivity_probe;
    return {
      ok: true,
      message: `اتصال زنده برقرار شد — مدل ${cfg.model} پاسخ noul=${probe ? probe.noul.toFixed(2) : "?"} برگرداند`
    };
  } catch (e) {
    return {
      ok: false,
      message: `خطای API ناظر: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

/** POST body: { provider: "ai"|"subq", action?: "save"|"test", enabled?, apiKey?, clearApiKey?, baseUrl?, model? } */
async function POST(req) {
  const body = await req.json().catch(() => null);
  const settingsKey = settingsKeyFor(body?.provider);
  if (!body || !settingsKey) {
    return _server.NextResponse.json({
      error: "provider باید «ai» یا «subq» باشد"
    }, {
      status: 400
    });
  }
  try {
    // در حالت تست هم ابتدا مقادیر جدید ذخیره می‌شوند تا تست دقیقاً روی همان توکن انجام شود
    if (body.action === "test" || body.action === "save" || body.action === undefined) {
      await (0, _config.saveProviderConfig)(settingsKey, {
        enabled: body.enabled,
        apiKey: body.apiKey,
        clearApiKey: body.clearApiKey,
        baseUrl: body.baseUrl,
        model: body.model
      });
    }
  } catch (e) {
    return _server.NextResponse.json({
      error: `ذخیره پیکربندی ناموفق بود (اتصال دیتابیس؟): ${e instanceof Error ? e.message : String(e)}`
    }, {
      status: 500
    });
  }
  const status = await (0, _config.getAIStatus)();
  const providerStatus = body.provider === "subq" ? status.subq : status.ai;
  if (body.action !== "test") {
    return _server.NextResponse.json({
      ok: true,
      status: providerStatus,
      all: status
    });
  }
  const test = body.provider === "subq" ? await testSubqConnection() : await testAiConnection();
  return _server.NextResponse.json({
    ok: test.ok,
    message: test.message,
    status: providerStatus,
    all: status
  });
}