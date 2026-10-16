"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = CampaignsPage;
exports.dynamic = void 0;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _campaignEditor = require("@/components/campaign-editor");
var _bootstrap = require("../../lib/services/bootstrap");
var _drizzleOrm = require("drizzle-orm");
const dynamic = "force-dynamic";
exports.dynamic = dynamic;
async function CampaignsPage() {
  await (0, _bootstrap.ensureDefaults)();
  const rows = await _db.db.select().from(_schema.discountCampaigns).orderBy((0, _drizzleOrm.desc)(_schema.discountCampaigns.priority));
  return <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          استودیو مدیریت ۳ سیستم تخفیف sgeooole (لحظه‌ای · شگفت‌انگیز · فرصت‌های زمان‌دار مالی و منتخب‌ها)
        </h1>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          موتور ابتدا قیمت‌های پرت و آپدیت‌نشده ترب را حذف کرده و <b>«سقف واقعی بازار تحت رصد»</b> را به عنوان قیمت معیار (خط‌خورده) و <b>«کف رقابتی هدف»</b> را به عنوان قیمت فروش قطعی کشف می‌کند. سپس درصد تخفیف را دقیقاً روی سقف اعمال می‌کند تا خروجی روی کف بنشیند و بر اساس قوانین زیر، هر رنج از کارت‌ها را در یکی از ۳ سیستم تخفیف فروشگاه قرار می‌دهد.
        </p>
      </div>
      <_campaignEditor.CampaignEditor campaigns={rows} />
    </div>;
}