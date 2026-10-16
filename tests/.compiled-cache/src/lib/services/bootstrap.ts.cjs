"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ensureDefaults = ensureDefaults;
exports.getProfileConfig = getProfileConfig;
exports.logActivity = logActivity;
exports.mergeConfig = mergeConfig;
var _db = require("@/db");
var _schema = require("../../db/schema");
var _types = require("../pricing/types");
var _drizzleOrm = require("drizzle-orm");
let bootstrapped = false;

/** ایجاد داده‌های پیش‌فرض (پروفایل، ۳ سیستم کمپین، زمان‌بندی، کانکتور sgeooole) — idempotent */
async function ensureDefaults() {
  if (bootstrapped) return;
  const profiles = await _db.db.select().from(_schema.pricingProfiles).limit(1);
  if (!profiles.length) {
    await _db.db.insert(_schema.pricingProfiles).values({
      name: "پروفایل پیش‌فرض (سود کم، فروش زیاد — ترب و مشهد)",
      isDefault: true,
      config: _types.DEFAULT_PROFILE_CONFIG
    });
  }
  const camps = await _db.db.select().from(_schema.discountCampaigns).limit(1);
  if (!camps.length) {
    await _db.db.insert(_schema.discountCampaigns).values([{
      name: "پیشنهاد لحظه‌ای (صفحه اصلی)",
      type: "flash",
      active: true,
      priority: 15,
      minDiscountPct: 12,
      maxDiscountPct: 45,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 12,
      badgeTheme: "gold-red",
      showInFeatured: false,
      cardRangeFrom: 1,
      cardRangeTo: 8,
      maxCards: 8,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: true,
      targetProductIds: []
    }, {
      name: "پیشنهاد شگفت‌انگیز (صفحه اصلی)",
      type: "featured",
      active: true,
      priority: 10,
      minDiscountPct: 6,
      maxDiscountPct: 45,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 48,
      badgeTheme: "red-purple",
      showInFeatured: true,
      cardRangeFrom: 1,
      cardRangeTo: 20,
      maxCards: 16,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: false,
      targetProductIds: []
    }, {
      name: "فروش ویژه زمان‌دار (مالی و تخفیف + منتخب‌ها)",
      type: "timed_sale",
      // پیش‌فرض غیرفعال تا هیچ کارتی با تخفیف ۵٪ به صورت ناخواسته وارد بخش «مالی و تخفیف» نشود؛
      // مدیر می‌تواند در صفحه کمپین‌ها رنج کارت و نام دلخواه را تنظیم و فعال کند.
      active: false,
      priority: 8,
      minDiscountPct: 10,
      maxDiscountPct: 45,
      activeHours: [],
      activeDays: [],
      categories: [],
      durationHours: 72,
      badgeTheme: "green-orange",
      showInFeatured: true,
      cardRangeFrom: 21,
      cardRangeTo: 50,
      maxCards: 0,
      minPriceToman: 0,
      maxPriceToman: 0,
      onlyTopRanked: false,
      targetProductIds: []
    }]);
  }
  const sch = await _db.db.select().from(_schema.schedules).limit(1);
  if (!sch.length) {
    await _db.db.insert(_schema.schedules).values({
      name: "استعلام خودکار هر ۳ ساعت (ترب و مشهد)",
      intervalMinutes: 180,
      active: true,
      filter: {},
      nextRunAt: new Date(Date.now() + 180 * 60000)
    });
  }
  const conn = await _db.db.select().from(_schema.storeConnectors).limit(1);
  if (!conn.length) {
    await _db.db.insert(_schema.storeConnectors).values([{
      name: "فروشگاه sgeooole (ekgkala-backend)",
      type: "sgeooole",
      active: false,
      config: {
        baseUrl: "http://localhost:5000",
        apiKey: "",
        adminToken: ""
      }
    }, {
      name: "ووکامرس",
      type: "woocommerce",
      active: false,
      config: {
        baseUrl: "",
        consumerKey: "",
        consumerSecret: ""
      }
    }, {
      name: "وب‌هوک عمومی",
      type: "webhook",
      active: false,
      config: {
        url: "",
        secret: ""
      }
    }]);
  }
  bootstrapped = true;
}
async function getProfileConfig(profileId) {
  await ensureDefaults();
  if (profileId) {
    const r = await _db.db.select().from(_schema.pricingProfiles).where((0, _drizzleOrm.eq)(_schema.pricingProfiles.id, profileId)).limit(1);
    if (r[0]) return {
      id: r[0].id,
      config: mergeConfig(r[0].config)
    };
  }
  const d = await _db.db.select().from(_schema.pricingProfiles).where((0, _drizzleOrm.eq)(_schema.pricingProfiles.isDefault, true)).limit(1);
  if (d[0]) return {
    id: d[0].id,
    config: mergeConfig(d[0].config)
  };
  const any = await _db.db.select().from(_schema.pricingProfiles).limit(1);
  return {
    id: any[0].id,
    config: mergeConfig(any[0].config)
  };
}

/** ادغام با پیش‌فرض‌ها تا اگر فیلد جدیدی اضافه شد، پروفایل‌های قدیمی نشکنند */
function mergeConfig(partial) {
  const d = _types.DEFAULT_PROFILE_CONFIG;
  const p = partial ?? {};
  const pSup = p.supervisor ?? {};
  const pGates = pSup.gates ?? {};
  return {
    sourcing: {
      ...d.sourcing,
      ...(p.sourcing ?? {})
    },
    filters: {
      ...d.filters,
      ...(p.filters ?? {})
    },
    outliers: {
      ...d.outliers,
      ...(p.outliers ?? {})
    },
    aggregation: {
      ...d.aggregation,
      ...(p.aggregation ?? {})
    },
    rank1: {
      ...d.rank1,
      ...(p.rank1 ?? {})
    },
    margin: {
      ...d.margin,
      ...(p.margin ?? {})
    },
    guards: {
      ...d.guards,
      ...(p.guards ?? {})
    },
    discount: {
      ...d.discount,
      ...(p.discount ?? {})
    },
    rounding: {
      ...d.rounding,
      ...(p.rounding ?? {})
    },
    supervisor: {
      ...d.supervisor,
      ...pSup,
      gates: {
        identity_match: {
          ...d.supervisor.gates.identity_match,
          ...(pGates.identity_match ?? {})
        },
        market_data_integrity: {
          ...d.supervisor.gates.market_data_integrity,
          ...(pGates.market_data_integrity ?? {})
        },
        profit_and_rank_safety: {
          ...d.supervisor.gates.profit_and_rank_safety,
          ...(pGates.profit_and_rank_safety ?? {})
        },
        ceiling_discount_validity: {
          ...d.supervisor.gates.ceiling_discount_validity,
          ...(pGates.ceiling_discount_validity ?? {})
        }
      }
    },
    ai: {
      ...d.ai,
      ...(p.ai ?? {})
    }
  };
}
async function logActivity(scope, message, meta = {}, level = "info") {
  try {
    await _db.db.insert(_schema.activityLogs).values({
      scope,
      message,
      meta,
      level
    });
  } catch {
    // لاگ نباید جریان اصلی را بشکند
  }
}