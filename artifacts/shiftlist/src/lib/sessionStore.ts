import { Store, type SessionData } from "express-session";
import { pool } from "../db/index.js";
import { logger } from "./logger.js";

/** Only a backstop for a session with no cookie of its own; app.ts sets the real one. */
const DEFAULT_TTL_MS = 16 * 60 * 60 * 1000;

/**
 * Sessions in Postgres rather than process memory.
 *
 * Workers isolates are short-lived and a staff member's requests will not land
 * on the same one, so the default MemoryStore would log people out at random.
 *
 * Written by hand rather than pulling in connect-pg-simple because this reads
 * `pool` lazily, per call. `pool` is a proxy that resolves to the current
 * request's pool (see lib/db) — a store that captured a real pool at
 * construction time would break on Workers, where an I/O object cannot be
 * shared between requests.
 */

function expiryOf(sess: SessionData): Date {
  const expires = sess.cookie?.expires;
  if (expires) return new Date(expires);
  return new Date(Date.now() + (sess.cookie?.maxAge ?? DEFAULT_TTL_MS));
}

export class PgSessionStore extends Store {
  override get(
    sid: string,
    callback: (err?: unknown, session?: SessionData | null) => void,
  ): void {
    pool
      .query<{ sess: SessionData }>(
        `SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()`,
        [sid],
      )
      .then((res) => callback(null, res.rows[0]?.sess ?? null))
      .catch((err) => callback(err));
  }

  override set(sid: string, sess: SessionData, callback?: (err?: unknown) => void): void {
    pool
      .query(
        `INSERT INTO sessions (sid, sess, expire)
         VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE
           SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, sess, expiryOf(sess)],
      )
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    pool
      .query(`DELETE FROM sessions WHERE sid = $1`, [sid])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override touch(sid: string, sess: SessionData, callback?: (err?: unknown) => void): void {
    pool
      .query(`UPDATE sessions SET expire = $2 WHERE sid = $1`, [sid, expiryOf(sess)])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}

/**
 * Deletes expired rows. Runs from the Cron Trigger — a `setInterval` pruner
 * would be doing I/O outside any request, which Workers do not allow.
 */
export async function pruneSessions(): Promise<void> {
  try {
    await pool.query(`DELETE FROM sessions WHERE expire < NOW()`);
  } catch (err) {
    logger.error({ err }, "session prune failed");
  }
}
