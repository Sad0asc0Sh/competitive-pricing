import { db } from "@/db";
import { pricingProfiles } from "@/db/schema";
import { requireAdminAuth } from "@/lib/auth";
import type { PricingProfileConfig } from "@/lib/pricing/types";
import { ensureDefaults, mergeConfig } from "@/lib/services/bootstrap";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  await ensureDefaults();
  const rows = await db.select().from(pricingProfiles).orderBy(pricingProfiles.id);
  return NextResponse.json(rows.map((r) => ({ ...r, config: mergeConfig(r.config) })));
}

/** POST: ایجاد یا بروزرسانی پروفایل  body: { id?, name, config, isDefault? } */
export async function POST(req: Request) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    id?: number;
    name?: string;
    config?: Partial<PricingProfileConfig>;
    isDefault?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });

  let baseExisting: Partial<PricingProfileConfig> | undefined;
  if (body.id) {
    const [existing] = await db
      .select()
      .from(pricingProfiles)
      .where(eq(pricingProfiles.id, body.id))
      .limit(1);
    baseExisting = existing?.config;
  }

  const incoming = body.config ?? {};
  const mergedInput: Partial<PricingProfileConfig> = {
    ...(baseExisting ?? {}),
    ...incoming,
    sourcing: { ...(baseExisting?.sourcing ?? {}), ...(incoming.sourcing ?? {}) } as PricingProfileConfig["sourcing"],
    filters: { ...(baseExisting?.filters ?? {}), ...(incoming.filters ?? {}) } as PricingProfileConfig["filters"],
    outliers: { ...(baseExisting?.outliers ?? {}), ...(incoming.outliers ?? {}) } as PricingProfileConfig["outliers"],
    aggregation: { ...(baseExisting?.aggregation ?? {}), ...(incoming.aggregation ?? {}) } as PricingProfileConfig["aggregation"],
    rank1: { ...(baseExisting?.rank1 ?? {}), ...(incoming.rank1 ?? {}) } as PricingProfileConfig["rank1"],
    margin: { ...(baseExisting?.margin ?? {}), ...(incoming.margin ?? {}) } as PricingProfileConfig["margin"],
    guards: { ...(baseExisting?.guards ?? {}), ...(incoming.guards ?? {}) } as PricingProfileConfig["guards"],
    discount: { ...(baseExisting?.discount ?? {}), ...(incoming.discount ?? {}) } as PricingProfileConfig["discount"],
    rounding: { ...(baseExisting?.rounding ?? {}), ...(incoming.rounding ?? {}) } as PricingProfileConfig["rounding"],
    supervisor: {
      ...(baseExisting?.supervisor ?? {}),
      ...(incoming.supervisor ?? {}),
      gates: {
        ...(baseExisting?.supervisor?.gates ?? {}),
        ...(incoming.supervisor?.gates ?? {}),
      },
    } as PricingProfileConfig["supervisor"],
    ai: { ...(baseExisting?.ai ?? {}), ...(incoming.ai ?? {}) } as PricingProfileConfig["ai"],
    ...(baseExisting?.costless || incoming.costless
      ? {
          costless: {
            ...(baseExisting?.costless ?? {}),
            ...(incoming.costless ?? {}),
          } as NonNullable<PricingProfileConfig["costless"]>,
        }
      : {}),
    ...(baseExisting?.estimator || incoming.estimator
      ? {
          estimator: {
            ...(baseExisting?.estimator ?? {}),
            ...(incoming.estimator ?? {}),
          } as NonNullable<PricingProfileConfig["estimator"]>,
        }
      : {}),
  };

  const config = mergeConfig(mergedInput);
  if (body.isDefault) await db.update(pricingProfiles).set({ isDefault: false });
  if (body.id) {
    const [row] = await db
      .update(pricingProfiles)
      .set({
        config,
        ...(body.name ? { name: body.name } : {}),
        ...(body.isDefault != null ? { isDefault: body.isDefault } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pricingProfiles.id, body.id))
      .returning();
    return NextResponse.json(row);
  }
  const [row] = await db
    .insert(pricingProfiles)
    .values({ name: body.name ?? "پروفایل جدید", config, isDefault: !!body.isDefault })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
