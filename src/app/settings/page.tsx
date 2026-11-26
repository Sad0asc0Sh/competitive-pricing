import { db } from "@/db";
import { pricingProfiles, schedules, storeConnectors } from "@/db/schema";
import { SettingsClient, type SettingsTab } from "@/components/settings-client";
import { getAIStatus } from "@/lib/ai/config";
import { ensureDefaults, mergeConfig } from "@/lib/services/bootstrap";
import { getTorobRelayStatus } from "@/lib/torob-relay/config";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await ensureDefaults();
  const sp = searchParams ? await searchParams : {};
  const rawTab = sp?.tab;
  const initialTab: SettingsTab =
    rawTab === "torob" || rawTab === "profiles" || rawTab === "schedules" || rawTab === "connectors" ? rawTab : "ai";

  const [profiles, sch, conns, aiStatus, torobRelayStatus] = await Promise.all([
    db.select().from(pricingProfiles).orderBy(pricingProfiles.id),
    db.select().from(schedules).orderBy(schedules.id),
    db.select().from(storeConnectors).orderBy(storeConnectors.id),
    getAIStatus(),
    getTorobRelayStatus(),
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
      torobRelayStatus={torobRelayStatus}
      initialTab={initialTab}
      profiles={profiles.map((p) => ({ ...p, config: mergeConfig(p.config) }))}
      schedules={sch}
      connectors={masked}
    />
  );
}
