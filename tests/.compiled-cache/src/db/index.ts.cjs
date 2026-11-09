"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
const node_postgres_1 = require("drizzle-orm/node-postgres");
const pg_1 = require("pg");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
}
const globalForDb = globalThis;
exports.pool = globalForDb.__arenaNextJsPostgresqlPool ??
    new pg_1.Pool({
        connectionString: databaseUrl,
    });
if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = exports.pool;
}
exports.db = (0, node_postgres_1.drizzle)(exports.pool);
