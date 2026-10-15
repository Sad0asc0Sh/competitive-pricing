"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.tickScheduler = tickScheduler;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _drizzleOrm = require("drizzle-orm");
var _bootstrap = require("./bootstrap");
var _runner = require("./runner");
/**
 * زمان‌بند: هر زمان‌بندی فعال که nextRunAt آن گذشته باشد اجرا می‌شود.
 * توسط instrumentation (هر ۶۰ ثانیه) یا از بیرون (cron → /api/scheduler/tick) فراخوانی می‌شود.
 */
let ticking = false;
async function tickScheduler() {
  if (ticking) return {
    ran: []
  };
  ticking = true;
  const ran = [];
  try {
    await (0, _bootstrap.ensureDefaults)();
    const now = new Date();
    const due = await _db.db.select().from(_schema.schedules).where((0, _drizzleOrm.and)((0, _drizzleOrm.eq)(_schema.schedules.active, true), (0, _drizzleOrm.or)((0, _drizzleOrm.isNull)(_schema.schedules.nextRunAt), (0, _drizzleOrm.lte)(_schema.schedules.nextRunAt, now))));
    for (const s of due) {
      const next = new Date(now.getTime() + s.intervalMinutes * 60000);
      // ابتدا nextRunAt را جلو می‌بریم تا اجرای همزمان تکراری نشود
      await _db.db.update(_schema.schedules).set({
        lastRunAt: now,
        nextRunAt: next
      }).where((0, _drizzleOrm.eq)(_schema.schedules.id, s.id));
      await (0, _bootstrap.logActivity)("scheduler", `اجرای زمان‌بندی «${s.name}»`, {
        scheduleId: s.id
      });
      await (0, _runner.runPricing)({
        trigger: "schedule",
        scheduleId: s.id,
        category: s.filter?.category,
        productIds: s.filter?.productIds
      });
      ran.push(s.id);
    }
  } finally {
    ticking = false;
  }
  return {
    ran
  };
}