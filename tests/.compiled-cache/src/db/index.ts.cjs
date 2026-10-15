"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.pool = exports.db = void 0;
var _nodePostgres = require("drizzle-orm/node-postgres");
var _pg = require("pg");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const globalForDb = globalThis;
const pool = globalForDb.__arenaNextJsPostgresqlPool ?? new _pg.Pool({
  connectionString: databaseUrl
});
exports.pool = pool;
if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}
const db = (0, _nodePostgres.drizzle)(pool);
exports.db = db;