"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = SettingsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const index_ts_1 = require("../../db/index.ts");
const schema_1 = require("../../db/schema");
const settings_client_1 = require("@/components/settings-client");
const config_1 = require("../../lib/ai/config");
const bootstrap_1 = require("../../lib/services/bootstrap");
const config_2 = require("../../lib/torob-relay/config");
exports.dynamic = "force-dynamic";
async function SettingsPage({ searchParams, }) {
    await (0, bootstrap_1.ensureDefaults)();
    const sp = searchParams ? await searchParams : {};
    const rawTab = sp?.tab;
    const initialTab = rawTab === "torob" || rawTab === "profiles" || rawTab === "schedules" || rawTab === "connectors" ? rawTab : "ai";
    const [profiles, sch, conns, aiStatus, torobRelayStatus] = await Promise.all([
        index_ts_1.db.select().from(schema_1.pricingProfiles).orderBy(schema_1.pricingProfiles.id),
        index_ts_1.db.select().from(schema_1.schedules).orderBy(schema_1.schedules.id),
        index_ts_1.db.select().from(schema_1.storeConnectors).orderBy(schema_1.storeConnectors.id),
        (0, config_1.getAIStatus)(),
        (0, config_2.getTorobRelayStatus)(),
    ]);
    const masked = conns.map((c) => ({
        ...c,
        config: Object.fromEntries(Object.entries(c.config ?? {}).map(([k, v]) => [k, /secret|key/i.test(k) && v ? "••••••" : v])),
    }));
    return ((0, jsx_runtime_1.jsx)(settings_client_1.SettingsClient, { aiStatus: aiStatus, torobRelayStatus: torobRelayStatus, initialTab: initialTab, profiles: profiles.map((p) => ({ ...p, config: (0, bootstrap_1.mergeConfig)(p.config) })), schedules: sch, connectors: masked }));
}
