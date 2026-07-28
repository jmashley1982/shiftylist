import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Pool as PgPool } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * Cloudflare Workers cannot share an I/O object between requests — a pool
 * opened while handling one request throws "Cannot perform I/O on behalf of a
 * different request" if the next request reuses it. So on Workers each request
 * opens its own pool and binds it here for the duration of that request.
 *
 * On Node the store is empty and we fall back to a single long-lived pool
 * built from DATABASE_URL, which is the original behaviour.
 */
const requestPool = new AsyncLocalStorage<PgPool>();

let nodePool: PgPool | undefined;

let resolveConnectionString: (() => string) | undefined;

/**
 * Register a lazy source for the connection string. Workers use this to hand
 * over `env.HYPERDRIVE.connectionString`, which must be read inside a request:
 * Hyperdrive mints a fresh credential on each read, and generating random
 * values at global scope is a runtime error.
 */
export function setConnectionStringResolver(resolver: () => string): void {
  resolveConnectionString = resolver;
}

function connectionString(): string {
  const value = resolveConnectionString?.() ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return value;
}

/** Open a pool against whatever the current runtime's connection string is. */
export function createPool(max = 5): PgPool {
  return new Pool({ connectionString: connectionString(), max });
}

/** Bind `p` as the pool for everything `fn` does, including its async work. */
export function runWithPool<T>(p: PgPool, fn: () => T): T {
  return requestPool.run(p, fn);
}

function currentPool(): PgPool {
  const scoped = requestPool.getStore();
  if (scoped) return scoped;

  nodePool ??= createPool();
  return nodePool;
}

/**
 * Stands in for a `pg.Pool` and resolves to the right one per request, so
 * every `pool.query(...)` / `pool.connect()` call site works unchanged on both
 * Node and Workers.
 */
export const pool: PgPool = new Proxy({} as PgPool, {
  get(_target, prop) {
    const active = currentPool();
    const value = Reflect.get(active, prop, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
  has(_target, prop) {
    return prop in currentPool();
  },
});

/**
 * Lazy so that merely importing this module never touches the pool — on
 * Workers there is no pool at module-load time.
 */
export function getDb() {
  return drizzle(currentPool(), { schema });
}

export * from "./schema";
