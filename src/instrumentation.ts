/**
 * زمان‌بند داخلی: هر ۶۰ ثانیه tickScheduler را صدا می‌زند (فقط در runtime نود).
 * برای محیط‌های serverless، به‌جای این از cron خارجی → GET /api/scheduler/tick استفاده کنید.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_INTERNAL_SCHEDULER === "1") return;
  const g = globalThis as typeof globalThis & { __pricingSchedulerStarted?: boolean };
  if (g.__pricingSchedulerStarted) return;
  g.__pricingSchedulerStarted = true;

  const { tickScheduler } = await import("@/lib/services/scheduler");
  const tick = async () => {
    try {
      await tickScheduler();
    } catch (e) {
      console.error("[scheduler] tick failed:", e);
    }
  };
  setTimeout(tick, 15000);
  setInterval(tick, 60000);
}
