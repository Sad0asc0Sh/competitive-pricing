"use strict";

require("dotenv/config");
var _index = require("./index");
/**
 * این سیستم عمداً هیچ داده نمونه/ساختگی (seed) ندارد.
 * برای پرکردن سیستم با داده واقعی:
 *   node scripts/import-mongo-products.cjs
 */
async function main() {
  console.log("seed: هیچ داده نمونه‌ای وارد نشد (سیاست سیستم واقعی). برای ایمپورت محصولات واقعی: node scripts/import-mongo-products.cjs");
  await _index.pool.end();
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
