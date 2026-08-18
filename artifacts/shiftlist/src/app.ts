import express, { type Express } from "express";
import session from "express-session";
import { fileURLToPath } from "url";
import path from "path";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { httpLogger } from "./lib/httpLogger.js";
import { isWorkers } from "./lib/runtime.js";
import { BundledView } from "./lib/views.js";
import { PgSessionStore } from "./lib/sessionStore.js";
import { createPool, runWithPool } from "./db/index.js";
import { staffUrl, adminUrl } from "./lib/urls.js";

const isProduction = process.env["NODE_ENV"] === "production";
const onWorkers = isWorkers();

const app: Express = express();

if (isProduction) {
  // Behind Cloudflare, so req.protocol and req.ip come from the proxy headers.
  app.set("trust proxy", 1);
}

app.use(httpLogger());

if (onWorkers) {
  // Workers cannot share an I/O object across requests, so each request opens
  // its own pool and closes it again when the response is written. This must
  // come before anything that touches the database — the session store
  // included.
  app.use((_req, res, next) => {
    let requestPool;
    try {
      requestPool = createPool();
    } catch (err) {
      return void next(err);
    }

    let closed = false;
    const teardown = () => {
      if (closed) return;
      closed = true;
      void requestPool.end().catch((err) => {
        logger.error({ err }, "failed to close request pool");
      });
    };

    // Deliberately hung off res.end rather than the "finish"/"close" events:
    // workerd emits those earlier than Node does — before express-session's
    // own res.end wrapper has finished writing the session. Closing the pool
    // at that point kills the in-flight touch/save query, res.end never
    // completes, and the chunked response is left without its terminator.
    //
    // Because this middleware runs first, express-session wraps *this*
    // wrapper, so by the time we are called the session write is already done.
    //
    // Teardown must wait for end()'s own completion callback rather than
    // running right after end() is *called* — end() only schedules the final
    // write, it doesn't block until the bytes are actually flushed. Tearing
    // the pool down before that flush is confirmed risks cutting the response
    // off mid-stream, which is exactly the "unterminated response" failure
    // mode above, just moved one step later.
    const originalEnd = res.end.bind(res);
    res.end = function patchedEnd(...args: unknown[]) {
      const last = args[args.length - 1];
      const userCallback = typeof last === "function" ? (args.pop() as () => void) : undefined;
      return (originalEnd as (...a: unknown[]) => unknown)(...args, () => {
        teardown();
        userCallback?.();
      });
    } as typeof res.end;

    runWithPool(requestPool, next);
  });
}

app.set("view engine", "ejs");
// Templates are baked into the bundle rather than read from disk — Workers
// have no persistent filesystem. See src/lib/views.ts.
app.set("view", BundledView);

// Every template can call staffUrl(...)/adminUrl(...) directly instead of
// hardcoding the /staff or /admin/shifts prefix — see src/lib/urls.ts.
app.use((_req, res, next) => {
  res.locals.staffUrl = staffUrl;
  res.locals.adminUrl = adminUrl;
  next();
});

if (!onWorkers) {
  // On Workers this is served by the Static Assets binding before a request
  // ever reaches the Worker (see the `assets` key in wrangler.jsonc), and
  // `import.meta.url` is undefined there — so resolve the path only on Node.
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(dirname, "../public")));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const secret = process.env["SESSION_SECRET"];
if (!secret) {
  logger.warn("SESSION_SECRET not set — using insecure default");
}

app.use(
  session({
    store: new PgSessionStore(),
    secret: secret ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    // `rolling` is the whole point: without it the cookie expires a fixed
    // number of hours after login no matter how hard someone is using the
    // app, so a close-shift employee who signed in at 3:30pm was thrown back
    // to the login screen around 11:30pm — mid-shift, mid-checklist. Every
    // request now pushes the expiry out again, and the window is long enough
    // to cover a double.
    rolling: true,
    cookie: {
      maxAge: 16 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  })
);

// Never cache a page from this app — in production either.
//
// Every page here is per-person and per-minute: a checklist, a live shift
// view, a report. A cached copy served back later shows a shift's finished
// tasks as untouched, which is exactly the kind of "it reset itself" that
// costs someone their evening's work. Static assets are served by Cloudflare
// ahead of this Worker and are unaffected.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(router);

export default app;
