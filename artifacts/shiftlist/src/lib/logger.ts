/**
 * Structured console logger.
 *
 * Replaces pino here: pino reaches for `sonic-boom` (real file descriptors)
 * and `thread-stream`/`worker_threads` for its transports, none of which exist
 * on the Workers runtime. Cloudflare's Workers Logs captures `console.*`
 * natively — objects included — so the searchable JSON is equivalent.
 *
 * The call signatures match pino's, so existing `logger.error({ err }, "…")`
 * and `logger.warn("…")` call sites are unchanged.
 */

import { isWorkers } from "./runtime.js";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN = ORDER[(process.env["LOG_LEVEL"] as Level) ?? "info"] ?? ORDER.info;

const REDACT = new Set(["authorization", "cookie", "set-cookie"]);

function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (depth > 6 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT.has(key.toLowerCase()) ? "[Redacted]" : scrub(val, depth + 1);
  }
  return out;
}

function emit(level: Level, a?: unknown, b?: unknown): void {
  if (ORDER[level] < MIN) return;

  const [context, msg] =
    typeof a === "string"
      ? [undefined, a]
      : [scrub(a) as Record<string, unknown> | undefined, b as string | undefined];

  const line = {
    level,
    time: new Date().toISOString(),
    ...(context ?? {}),
    ...(msg ? { msg } : {}),
  };

  // Workers Logs indexes an object argument into structured fields, so pass it
  // through as-is there. Node's console would render it multi-line via
  // util.inspect, so serialise for the single-line JSON pino used to emit.
  const payload = isWorkers() ? line : JSON.stringify(line);

  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
}

export const logger: Logger = {
  debug: (a?: unknown, b?: unknown) => emit("debug", a, b),
  info: (a?: unknown, b?: unknown) => emit("info", a, b),
  warn: (a?: unknown, b?: unknown) => emit("warn", a, b),
  error: (a?: unknown, b?: unknown) => emit("error", a, b),
};
