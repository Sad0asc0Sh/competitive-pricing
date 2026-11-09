"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickScheduler = tickScheduler;
const db_1 = require("@/db");
const schema_1 = require("../../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const bootstrap_1 = require("./bootstrap");
const runner_1 = require("./runner");
/**
 * زمان‌بند: هر زمان‌بندی فعال که nextRunAt آن گذشته باشد اجرا می‌شود.
 * توسط instrumentation (هر ۶۰ ثانیه) یا از بیرون (cron → /api/scheduler/tick) فراخوانی می‌شود.
 */
let ticking = false;
async function tickScheduler() {
    if (ticking)
        return { ran: [] };
    ticking = true;
    const ran = [];
    try {
        await (0, bootstrap_1.ensureDefaults)();
        const now = new Date();
        const due = await db_1.db
            .select()
            .from(schema_1.schedules)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.schedules.active, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.schedules.nextRunAt), (0, drizzle_orm_1.lte)(schema_1.schedules.nextRunAt, now))));
        for (const s of due) {
            const next = new Date(now.getTime() + s.intervalMinutes * 60000);
            // ابتدا nextRunAt را جلو می‌بریم تا اجرای همزمان تکراری نشود
            await db_1.db.update(schema_1.schedules).set({ lastRunAt: now, nextRunAt: next }).where((0, drizzle_orm_1.eq)(schema_1.schedules.id, s.id));
            await (0, bootstrap_1.logActivity)("scheduler", `اجرای زمان‌بندی «${s.name}»`, { scheduleId: s.id });
            await (0, runner_1.runPricing)({ trigger: "schedule", scheduleId: s.id, category: s.filter?.category, productIds: s.filter?.productIds });
            ran.push(s.id);
        }
    }
    finally {
        ticking = false;
    }
    return { ran };
}
