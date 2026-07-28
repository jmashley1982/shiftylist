import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import app from "./app.js";
import { createPool, runWithPool, setConnectionStringResolver } from "./db/index.js";
import { sweepStaleSessions } from "./utils/autoSubmit.js";
import { pruneSessions } from "./lib/sessionStore.js";
import { warmViews } from "./lib/views.js";
import { logger } from "./lib/logger.js";

/**
 * Cloudflare Workers entry point.
 *
 * `src/index.ts` stays the Node entry for local development; this module
 * replaces it on Workers, where `httpServerHandler` bridges incoming fetch
 * events to the Node HTTP server Express listens on. The port is a routing
 * key inside the isolate, not a real TCP socket.
 *
 * Two constraints shape this file, both enforced at runtime:
 *
 *  - Nothing here may `await`. A top-level await moves the rest of the module
 *    body into a microtask, and `app.listen()` is only permitted during
 *    synchronous module evaluation.
 *  - Nothing here may read `env.HYPERDRIVE.connectionString`. Hyperdrive mints
 *    a fresh credential per read, and generating random values at global scope
 *    is disallowed — hence the resolver below, which defers the read until a
 *    request or the cron is actually running.
 *
 * Conversely, `warmViews()` *must* run here: compiling EJS templates needs
 * `new Function`, which is only permitted during startup.
 */

const PORT = 8787;

interface WorkerEnv {
  HYPERDRIVE?: { connectionString: string };
}

const bindings = env as unknown as WorkerEnv;

setConnectionStringResolver(() => {
  const connectionString = bindings.HYPERDRIVE?.connectionString;
  if (!connectionString) {
    throw new Error("HYPERDRIVE binding is missing — check wrangler.jsonc.");
  }
  return connectionString;
});

// Required, not just a warm-up: EJS compiles templates with `new Function`,
// which Workers only allow during startup. See src/lib/views.ts.
warmViews();

app.listen(PORT);

const httpHandler = httpServerHandler({ port: PORT });

export default {
  fetch: httpHandler.fetch.bind(httpHandler),

  /**
   * Cron Trigger. Replaces the piggyback-on-a-request sweep Node relied on,
   * and prunes expired session rows.
   */
  async scheduled(): Promise<void> {
    const cronPool = createPool();

    try {
      await runWithPool(cronPool, async () => {
        await sweepStaleSessions();
        await pruneSessions();
      });
    } catch (err) {
      logger.error({ err }, "scheduled sweep failed");
    } finally {
      await cronPool.end().catch(() => {});
    }
  },
};
