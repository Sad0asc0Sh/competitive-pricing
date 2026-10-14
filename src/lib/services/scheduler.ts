import { db } from "@/db";
import { schedules } from "@/db/schema";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { ensureDefaults, logActivity } from "./bootstrap";
import { runPricing } from "./runner";

/**
 * زمان‌بند: هر زمان‌بندی فعال که nextRunAt آن گذشته باشد اجرا می‌شود.
 * توسط instrumentation (هر ۶۰ ثانیه) یا از بیرون (cron → /api/scheduler/tick) فراخوانی می‌شود.
 */
let ticking = false;

export async function tickScheduler(): Promise<{ ran: number[] }> {
  if (ticking) return { ran: [] };
  ticking = true;
  const ran: number[] = [];
  try {
    await ensureDefaults();
    const now = new Date();
    const due = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.active, true), or(isNull(schedules.nextRunAt), lte(schedules.nextRunAt, now))));

    for (const s of due) {
      const next = new Date(now.getTime() + s.intervalMinutes * 60000);
      // ابتدا nextRunAt را جلو می‌بریم تا اجرای همزمان تکراری نشود
      await db.update(schedules).set({ lastRunAt: now, nextRunAt: next }).where(eq(schedules.id, s.id));
      await logActivity("scheduler", `اجرای زمان‌بندی «${s.name}»`, { scheduleId: s.id });
      await runPricing({ trigger: "schedule", scheduleId: s.id, category: s.filter?.category, productIds: s.filter?.productIds });
      ran.push(s.id);
    }
  } finally {
    ticking = false;
  }
  return { ran };
}
