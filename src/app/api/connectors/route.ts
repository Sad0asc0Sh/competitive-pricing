import { db } from "@/db";
import { storeConnectors } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import { parsePositiveInt } from "@/lib/format";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function maskConnectorConfig(config: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config ?? {}).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v]),
  );
}

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  await ensureDefaults();
  const rows = await db.select().from(storeConnectors).orderBy(storeConnectors.id);
  // مخفی کردن رازها در خروجی
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      config: maskConnectorConfig(r.config),
    })),
  );
}

/** POST { id, active?, config? } — فعال‌سازی یک کانکتور بقیه را غیرفعال می‌کند */
export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const b = (await req.json().catch(() => null)) as {
    id?: number;
    active?: boolean;
    config?: Record<string, string>;
  } | null;
  const connectorId = parsePositiveInt(b?.id);
  if (connectorId == null) return NextResponse.json({ error: "id معتبر لازم است" }, { status: 400 });
  const [existing] = await db.select().from(storeConnectors).where(eq(storeConnectors.id, connectorId)).limit(1);
  if (!existing) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  const config = { ...(existing.config ?? {}) };
  for (const [k, v] of Object.entries(b?.config ?? {})) {
    if (v !== "••••••" && v !== "••••••••") config[k] = v;
  }
  if (b?.active) await db.update(storeConnectors).set({ active: false });
  const [row] = await db
    .update(storeConnectors)
    .set({ config, ...(b?.active != null ? { active: b.active } : {}) })
    .where(eq(storeConnectors.id, connectorId))
    .returning();
  return NextResponse.json({
    ...row,
    config: maskConnectorConfig(row.config),
  });
}
