"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
const node_postgres_1 = require("drizzle-orm/node-postgres");
const pg_1 = require("pg");
const globalForDb = globalThis;
let cachedPool = globalForDb.__arenaNextJsPostgresqlPool;
let cachedDb = globalForDb.__arenaNextJsPostgresqlDb;
function getPool() {
    if (cachedPool)
        return cachedPool;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }
    const instance = new pg_1.Pool({ connectionString: databaseUrl });
    cachedPool = instance;
    if (process.env.NODE_ENV !== "production") {
        globalForDb.__arenaNextJsPostgresqlPool = instance;
    }
    return instance;
}
function getDb() {
    if (cachedDb)
        return cachedDb;
    const instance = (0, node_postgres_1.drizzle)(getPool());
    cachedDb = instance;
    if (process.env.NODE_ENV !== "production") {
        globalForDb.__arenaNextJsPostgresqlDb = instance;
    }
    return instance;
}
function lazyProxy(resolve) {
    return new Proxy({}, {
        get(_target, prop) {
            const target = resolve();
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
        set(_target, prop, value) {
            return Reflect.set(resolve(), prop, value);
        },
        deleteProperty(_target, prop) {
            return Reflect.deleteProperty(resolve(), prop);
        },
        defineProperty(_target, prop, descriptor) {
            return Reflect.defineProperty(resolve(), prop, descriptor);
        },
        has(_target, prop) {
            return Reflect.has(resolve(), prop);
        },
        ownKeys() {
            return Reflect.ownKeys(resolve());
        },
        getOwnPropertyDescriptor(_target, prop) {
            return Reflect.getOwnPropertyDescriptor(resolve(), prop);
        },
        getPrototypeOf() {
            return Reflect.getPrototypeOf(resolve());
        },
    });
}
exports.pool = lazyProxy(getPool);
exports.db = lazyProxy(getDb);
