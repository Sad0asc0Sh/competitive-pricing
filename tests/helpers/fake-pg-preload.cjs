'use strict'
/**
 * با `node --require tests/helpers/fake-pg-preload.cjs script.cjs` هر `require('pg')` و `require('dotenv')` را به نسخهٔ جعلی
 * هدایت می‌کند؛ حتی اگر pg/dotenv واقعی نصب باشد (آزمون نباید به دیتابیس واقعی وصل شود).
 */
const Module = require('node:module')
const path = require('node:path')
const original = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return require(path.join(__dirname, 'fake-pg.cjs'))
  if (request === 'dotenv') return { config() { return {} } }
  return original.apply(this, arguments)
}
