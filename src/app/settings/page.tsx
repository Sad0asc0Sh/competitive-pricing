import { db } from "@/db";
import { pricingProfiles, schedules, storeConnectors } from "@/db/schema";
import { SettingsClient } from "@/components/settings-client";
import { getAIStatus } from "@/lib/ai/config";
import { ensureDefaults, mergeConfig } from "@/lib/services/bootstrap";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureDefaults();
  const [profiles, sch, conns, aiStatus] = await Promise.all([
    db.select().from(pricingProfiles).orderBy(pricingProfiles.id),
    db.select().from(schedules).orderBy(schedules.id),
    db.select().from(storeConnectors).orderBy(storeConnectors.id),
    getAIStatus(),
  ]);
  const masked = conns.map((c) => ({
    ...c,
    config: Object.fromEntries(
      Object.entries(c.config).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v]),
    ),
  }));

  return (
    <SettingsClient
      aiStatus={aiStatus}
      profiles={profiles.map((p) => ({ ...p, config: mergeConfig(p.config) }))}
      schedules={sch}
      connectors={masked}
    />
  );
}
