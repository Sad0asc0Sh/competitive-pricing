"use client";

import type { PricingProfile, Schedule, StoreConnector } from "@/db/schema";
import type { AIStatus } from "@/lib/ai/config";
import { useState } from "react";
import { AISettingsPanel, ConnectorEditor, ProfileEditor, ScheduleEditor } from "./settings-panels";
import { SegmentedTabs } from "./ui";

type SettingsTab = "ai" | "profiles" | "schedules" | "connectors";

export function SettingsClient({
  aiStatus,
  profiles,
  schedules,
  connectors,
}: {
  aiStatus: AIStatus;
  profiles: PricingProfile[];
  schedules: Schedule[];
  connectors: StoreConnector[];
}) {
  const [tab, setTab] = useState<SettingsTab>("ai");

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="min-w-0 space-y-2">
        <h1 className="text-lg font-extrabold text-slate-900 sm:text-2xl">تنظیمات موتور قیمت‌گذاری</h1>
        <p className="text-xs leading-6 text-slate-500 sm:text-sm">
          همه پارامترهای الگوریتم، کلیدهای هوش مصنوعی، زمان‌بندی‌ها و اتصال به فروشگاه از این بخش قابل تنظیم است.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className={`badge ${
              aiStatus.ai.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            هوش مصنوعی: {aiStatus.ai.configured ? `فعال (${aiStatus.ai.model})` : "غیرفعال"}
          </span>
          <span
            className={`badge ${
              aiStatus.subq.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
            }`}
          >
            ناظر SubQ SystemOne: {aiStatus.subq.configured ? `متصل (${aiStatus.subq.model})` : "موتور آنی محلی"}
          </span>
        </div>
      </div>

      <SegmentedTabs<SettingsTab>
        value={tab}
        onChange={setTab}
        items={[
          { key: "ai", label: "هوش مصنوعی و ناظر" },
          { key: "profiles", label: "پروفایل‌های موتور", count: profiles.length },
          { key: "schedules", label: "زمان‌بندی خودکار", count: schedules.length },
          { key: "connectors", label: "اتصال فروشگاه", count: connectors.length },
        ]}
      />

      {tab === "ai" && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">
            هوش مصنوعی و توکن‌های API (ذخیره امن در دیتابیس)
          </h2>
          <AISettingsPanel initial={aiStatus} />
        </section>
      )}

      {tab === "profiles" && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">پروفایل‌های قیمت‌گذاری</h2>
          <ProfileEditor profiles={profiles} />
        </section>
      )}

      {tab === "schedules" && (
        <section className="card space-y-3">
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">زمان‌بندی استعلام خودکار</h2>
          <ScheduleEditor items={schedules} />
        </section>
      )}

      {tab === "connectors" && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">اتصال به فروشگاه (وب‌سرویس)</h2>
          <ConnectorEditor items={connectors} />
          <p className="text-xs leading-6 text-slate-500">
            مقادیر می‌توانند از متغیرهای محیطی هم خوانده شوند:{" "}
            <code dir="ltr" className="rounded bg-slate-100 px-1 py-0.5 text-[11px] break-all">
              WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET
            </code>{" "}
            یا{" "}
            <code dir="ltr" className="rounded bg-slate-100 px-1 py-0.5 text-[11px] break-all">
              STORE_WEBHOOK_URL, STORE_WEBHOOK_SECRET
            </code>
            .
          </p>
        </section>
      )}
    </div>
  );
}
