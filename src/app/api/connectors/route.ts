import { db } from "@/db";
import { storeConnectors } from "@/db/schema";
import { ensureDefaults } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaults();
  const rows = await db.select().from(storeConnectors).orderBy(storeConnectors.id);
  // مخفی کردن رازها در خروجی
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      config: Object.fromEntries(Object.entries(r.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v])),
    })),
  );
}

/** POST { id, active?, config? } — فعال‌سازی یک کانکتور بقیه را غیرفعال می‌کند */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: number; active?: boolean; config?: Record<string, string> } | null;
  if (!b?.id) return NextResponse.json({ error: "id لازم است" }, { status: 400 });
  const [existing] = await db.select().from(storeConnectors).where(eq(storeConnectors.id, b.id)).limit(1);
  if (!existing) return NextResponse.json({ error: "یافت نشد" }, { status: 404 });
  const config = { ...existing.config };
  for (const [k, v] of Object.entries(b.config ?? {})) if (v !== "••••••") config[k] = v;
  if (b.active) await db.update(storeConnectors).set({ active: false });
  const [row] = await db
    .update(storeConnectors)
    .set({ config, ...(b.active != null ? { active: b.active } : {}) })
    .where(eq(storeConnectors.id, b.id))
    .returning();
  return NextResponse.json(row);
}
