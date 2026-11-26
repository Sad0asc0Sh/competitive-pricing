"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const auth_1 = require("../../../lib/auth");
const torob_1 = require("../../../lib/sources/torob");
const config_1 = require("../../../lib/torob-relay/config");
const crypto_1 = require("../../../lib/torob-relay/crypto");
const server_1 = require("next/server");
exports.dynamic = "force-dynamic";
async function GET(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const status = await (0, config_1.getTorobRelayStatus)();
    const cfg = await (0, config_1.getTorobRelayConfig)();
    const sync = await (0, config_1.syncTorobRelayToMcp)(cfg).catch(() => ({ synced: false }));
    return server_1.NextResponse.json({ ok: true, status, mcpSynced: sync.synced });
}
async function testTorobRelayConnection() {
    const cfg = await (0, config_1.getTorobRelayConfig)();
    if (cfg.configError) {
        return { ok: false, message: cfg.configError };
    }
    if (cfg.enabled && cfg.configured && cfg.mode === "encrypted_relay") {
        try {
            const res = await (0, crypto_1.pingEncryptedRelay)({
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
        }
        catch (err) {
            if (err instanceof crypto_1.RelayTransportError) {
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
        if ((0, torob_1.looksLikeTorobChallenge)(res.status, ct, body)) {
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
    }
    catch (err) {
        return { ok: false, message: `عدم دسترسی به ${base}: ${err instanceof Error ? err.message : String(err)}` };
    }
    finally {
        clearTimeout(timer);
    }
}
async function resetMcpBreaker() {
    const mcpBase = (0, config_1.getTorobMcpBaseUrl)() || "http://127.0.0.1:3005";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
        const res = await fetch(`${mcpBase}/reset`, { method: "POST", signal: ctrl.signal, cache: "no-store" });
        if (res.ok) {
            return { ok: true, message: "🔓 قفل موقت ۴۹۰ روی سرویس torob-mcp با موفقیت ریست شد." };
        }
        return { ok: false, message: `ریست قفل انجام نشد (HTTP ${res.status})` };
    }
    catch (err) {
        return { ok: false, message: `دسترسی به سرویس torob-mcp ممکن نشد: ${err instanceof Error ? err.message : String(err)}` };
    }
    finally {
        clearTimeout(timer);
    }
}
async function POST(req) {
    const denied = await (0, auth_1.requireAdminAuth)(req);
    if (denied)
        return denied;
    const body = (await req.json().catch(() => null));
    if (!body) {
        return server_1.NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
    }
    if (body.action === "reset_breaker") {
        const r = await resetMcpBreaker();
        return server_1.NextResponse.json({ ok: r.ok, message: r.message });
    }
    try {
        if (body.action === "clear") {
            await (0, config_1.saveTorobRelayConfig)({ enabled: false, url: "", clearKey: true });
        }
        else {
            await (0, config_1.saveTorobRelayConfig)({
                enabled: body.enabled,
                url: body.url,
                relayKey: body.relayKey,
                clearKey: body.clearKey,
            });
        }
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err instanceof Error ? err.message : "خطا در ذخیره تنظیمات رله" }, { status: 400 });
    }
    const effective = await (0, config_1.getTorobRelayConfig)();
    const sync = await (0, config_1.syncTorobRelayToMcp)(effective, { force: true }).catch((e) => ({
        synced: false,
        error: e instanceof Error ? e.message : String(e),
    }));
    const status = await (0, config_1.getTorobRelayStatus)();
    if (body.action === "test") {
        const test = await testTorobRelayConnection();
        return server_1.NextResponse.json({
            ok: test.ok,
            message: test.message,
            status,
            mcpSynced: sync.synced,
            ...(sync.error ? { mcpSyncError: sync.error } : {}),
        });
    }
    return server_1.NextResponse.json({
        ok: true,
        status,
        mcpSynced: sync.synced,
        ...(sync.error ? { mcpSyncError: sync.error } : {}),
    });
}
