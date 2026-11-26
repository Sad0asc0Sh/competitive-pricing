import { requireAdminAuth } from "@/lib/auth";
import { looksLikeTorobChallenge } from "@/lib/sources/torob";
import {
  getTorobMcpBaseUrl,
  getTorobRelayConfig,
  getTorobRelayStatus,
  saveTorobRelayConfig,
  syncTorobRelayToMcp,
  type SaveTorobRelayInput,
} from "@/lib/torob-relay/config";
import { pingEncryptedRelay, RelayTransportError } from "@/lib/torob-relay/crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const status = await getTorobRelayStatus();
  const cfg = await getTorobRelayConfig();
  const sync = await syncTorobRelayToMcp(cfg).catch(() => ({ synced: false }));
  return NextResponse.json({ ok: true, status, mcpSynced: sync.synced });
}

async function testTorobRelayConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getTorobRelayConfig();
  if (cfg.configError) {
    return { ok: false, message: cfg.configError };
  }

  if (cfg.enabled && cfg.configured && cfg.mode === "encrypted_relay") {
    try {
      const res = await pingEncryptedRelay({
        relayUrl: cfg.url,
        relayKey: cfg.relayKey,
        checkTorob: true,
        timeoutMs: 12_000,
      });
      const t = res.torob;
      if (!t) {
        return { ok: true, message: "اتصال به رله و تایید کلید با موفقیت انجام شد." };
      }
      if (!t.reachable) {
        return {
          ok: false,
          message: `کلید و اتصال به رله (${cfg.url}) برقرار شد، اما رله به api.torob.com دسترسی نداشت: ${t.error ?? "خطای شبکه"}`,
        };
      }
      if (t.challenged) {
        return {
          ok: false,
          message: `اتصال به رله و کلید تایید شد، ولی ترب به IP این رله چالش ۴۹۰ داد (تاخیر ${t.latencyMs}ms) — چند دقیقه صبر کنید یا ریست قفل بزنید.`,
        };
      }
      if (t.ok) {
        return {
          ok: true,
          message: `✅ رله متصل و کلید تایید شد — پاسخ زنده از ترب دریافت شد (HTTP ${t.status} · ${t.latencyMs}ms)`,
        };
      }
      return {
        ok: false,
        message: `اتصال رله برقرار شد ولی ترب وضعیت HTTP ${t.status ?? "?"} برگرداند.`,
      };
    } catch (err) {
      if (err instanceof RelayTransportError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  const base = cfg.enabled && cfg.configured && cfg.mode === "plain_https_base" ? cfg.url : "https://api.torob.com";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/v4/search-trends/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://torob.com/",
        Origin: "https://torob.com",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const body = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    const ms = Date.now() - started;
    if (looksLikeTorobChallenge(res.status, ct, body)) {
      return {
        ok: false,
        message: `مسیر فعلی (${cfg.mode === "direct" ? "اتصال مستقیم سرور" : base}) با چالش ربات ترب (HTTP 490) مواجه شد (${ms}ms). رله ایران را فعال و تنظیم کنید.`,
      };
    }
    if (res.ok) {
      return {
        ok: true,
        message: `✅ اتصال برقرار است (${cfg.mode === "direct" ? "مستقیم از سرور" : base} · HTTP ${res.status} · ${ms}ms)`,
      };
    }
    return { ok: false, message: `پاسخ HTTP ${res.status} از ${base} (${ms}ms)` };
  } catch (err) {
    return { ok: false, message: `عدم دسترسی به ${base}: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function resetMcpBreaker(): Promise<{ ok: boolean; message: string }> {
  const mcpBase = getTorobMcpBaseUrl() || "http://127.0.0.1:3005";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${mcpBase}/reset`, { method: "POST", signal: ctrl.signal, cache: "no-store" });
    if (res.ok) {
      return { ok: true, message: "🔓 قفل موقت ۴۹۰ روی سرویس torob-mcp با موفقیت ریست شد." };
    }
    return { ok: false, message: `ریست قفل انجام نشد (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, message: `دسترسی به سرویس torob-mcp ممکن نشد: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | (SaveTorobRelayInput & { action?: "save" | "test" | "clear" | "reset_breaker" })
    | null;

  if (!body) {
    return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  }

  if (body.action === "reset_breaker") {
    const r = await resetMcpBreaker();
    return NextResponse.json({ ok: r.ok, message: r.message });
  }

  try {
    if (body.action === "clear") {
      await saveTorobRelayConfig({ enabled: false, url: "", clearKey: true });
    } else {
      await saveTorobRelayConfig({
        enabled: body.enabled,
        url: body.url,
        relayKey: body.relayKey,
        clearKey: body.clearKey,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطا در ذخیره تنظیمات رله" },
      { status: 400 },
    );
  }

  const effective = await getTorobRelayConfig();
  const sync = await syncTorobRelayToMcp(effective, { force: true }).catch((e) => ({
    synced: false,
    error: e instanceof Error ? e.message : String(e),
  }));
  const status = await getTorobRelayStatus();

  if (body.action === "test") {
    const test = await testTorobRelayConnection();
    return NextResponse.json({
      ok: test.ok,
      message: test.message,
      status,
      mcpSynced: sync.synced,
      ...(sync.error ? { mcpSyncError: sync.error } : {}),
    });
  }

  return NextResponse.json({
    ok: true,
    status,
    mcpSynced: sync.synced,
    ...(sync.error ? { mcpSyncError: sync.error } : {}),
  });
}
