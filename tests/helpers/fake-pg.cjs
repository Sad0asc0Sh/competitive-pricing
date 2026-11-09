'use strict'
/**
 * «pg» جعلی برای آزمون CLIهای دیتابیس‌دار (بدون PostgreSQL): یک پایگاه‌دادهٔ درون‌فایلی با چند الگوی SQL شناخته‌شده.
 * فقط درستیِ منطق جاوااسکریپت CLIها (و ثبت اینکه کدام SQL ها اجرا شد) را می‌سنجد؛ معنای واقعی SQL را نمی‌سنجد.
 * حالت: فایل JSON با مسیر env FAKE_PG_FILE  →  { profiles: [...], decisions: [...], logs: [], queries: [] }
 */
const fs = require('node:fs')

class Pool {
  constructor(opts) {
    this.connectionString = opts && opts.connectionString
  }

  async query(sql, params = []) {
    const file = process.env.FAKE_PG_FILE
    if (!file) throw new Error('fake-pg: FAKE_PG_FILE تنظیم نشده')
    const db = JSON.parse(fs.readFileSync(file, 'utf8'))
    const s = String(sql).replace(/\s+/g, ' ').trim()
    ;(db.queries ||= []).push({ sql: s, params })
    let rows = []
    if (/^SELECT id, name, is_default, config FROM pricing_profiles WHERE id = \$1/.test(s)) {
      rows = db.profiles.filter((p) => p.id === params[0])
    } else if (/^SELECT id, name, is_default, config FROM pricing_profiles WHERE is_default = true/.test(s)) {
      rows = db.profiles.filter((p) => p.is_default).slice(0, 1)
    } else if (/^UPDATE pricing_profiles SET config = \$1::jsonb/.test(s)) {
      const p = db.profiles.find((x) => x.id === params[1])
      if (!p) throw new Error('fake-pg: پروفایل برای UPDATE پیدا نشد')
      p.config = JSON.parse(params[0])
    } else if (/^INSERT INTO activity_logs/.test(s)) {
      ;(db.logs ||= []).push({ message: params[0], meta: JSON.parse(params[1]) })
    } else if (/^SELECT .* FROM price_decisions /.test(s)) {
      rows = db.decisions || []
    } else {
      fs.writeFileSync(file, JSON.stringify(db))
      throw new Error('fake-pg: SQL پشتیبانی‌نشده: ' + s)
    }
    fs.writeFileSync(file, JSON.stringify(db))
    return { rows }
  }

  async end() {}
}

module.exports = { Pool }
