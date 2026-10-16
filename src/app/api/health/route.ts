import { db } from "@/db";
import { getAIStatus } from "@/lib/ai/config";
import { getStoreStatus } from "@/lib/store/connectors";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function checkUrl(url: string, timeoutMs = 4000): Promise<{ reachable: boolean; status?: number }> {
  if (!url) return { reachable: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, cache: "no-store" });
    // برای MCP با متد POST واقعی چک نمی‌کنیم؛ همین که سرور جواب HTTP بدهد کافی است
    // (حتی 404/405 یعنی سرور بالاست).
    return { reachable: true, status: res.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const ai = await getAIStatus();
  let store = null;
  try {
    store = await getStoreStatus();
  } catch {
    store = null;
  }

  const torobMcpUrl = (process.env.TOROB_MCP_URL ?? "").trim();
  const torob = torobMcpUrl ? await checkUrl(torobMcpUrl, 4000) : { reachable: false as const };
  const storeBase = store?.baseUrl || (process.env.SGEOOOLE_API_URL ?? "");
  const storeCheck = storeBase ? await checkUrl(`${storeBase.replace(/\/$/, "")}/api/products/pricing-sync`, 4000) : null;

  const ok = dbOk;
  return Response.json({
    ok,
    db: dbOk ? "up" : "down",
    store: store
      ? {
          activeType: store.activeType,
          envFallback: store.envFallback,
          baseUrl: store.baseUrl ? "***configured***" : "missing",
          lastError: store.lastError,
          reachable: storeCheck?.reachable ?? null,
        }
      : { error: "unavailable" },
    torob: {
      configured: Boolean(torobMcpUrl),
      reachable: torobMcpUrl ? torob.reachable : null,
    },
    ai: {
      enabled: ai.ai.enabled,
      configured: ai.ai.configured,
      source: ai.ai.source,
      model: ai.ai.model,
      subqEnabled: ai.subq.enabled,
      subqConfigured: ai.subq.configured,
      subqSource: ai.subq.source,
      subqModel: ai.subq.model,
    },
  });
}
