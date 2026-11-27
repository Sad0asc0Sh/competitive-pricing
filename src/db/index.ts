import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

let cachedPool: Pool | undefined = globalForDb.__arenaNextJsPostgresqlPool;
let cachedDb: NodePgDatabase | undefined = globalForDb.__arenaNextJsPostgresqlDb;

function getPool(): Pool {
  if (cachedPool) return cachedPool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const instance = new Pool({ connectionString: databaseUrl });
  cachedPool = instance;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = instance;
  }
  return instance;
}

function getDb(): NodePgDatabase {
  if (cachedDb) return cachedDb;
  const instance = drizzle(getPool());
  cachedDb = instance;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlDb = instance;
  }
  return instance;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
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

export const pool: Pool = lazyProxy(getPool);
export const db: NodePgDatabase = lazyProxy(getDb);
