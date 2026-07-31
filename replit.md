# ShiftList — Viking Vapor & Smoke Staff Shift To-Do List

A server-rendered internal web app for managing staff shift tasks. Staff log in with a 4-digit code, tick off tasks as they complete them (with time logging), and submit a final report stored in the database. Admins manage employees, shift templates, one-off scheduled tasks, and view reports.

## Run & Operate

- `pnpm --filter @workspace/shiftlist run dev` — build + run the server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Server: Express 5 + EJS templates
- DB: PostgreSQL — schema managed via Drizzle ORM
- Auth: express-session with 4-digit staff codes + admin code, sessions stored
  in the `sessions` table (`artifacts/shiftlist/src/lib/sessionStore.ts`)
- Date: date-fns
- Logging: structured `console` JSON (`src/lib/logger.ts`)
- Build: esbuild (ESM bundle) for Node; wrangler bundles the Worker

## Deploying to Cloudflare

Production runs as a Cloudflare Worker, folded directly into the business
site rather than living at its own domain:

- **Staff** use `vikingvaporandsmoke.com/staff` — 4-digit code, checklist, submit.
- **Managers** use `vikingvaporandsmoke.com/admin/shifts` — a section of the
  existing Viking dashboard, **with no separate login**. See
  [Shared admin auth](#shared-admin-auth-no-second-login) below.

`shiftylist.app` and `viking.shiftylist.app` (the old Replit domain) are
retired. See `artifacts/shiftlist/wrangler.jsonc`.

```
pnpm --filter @workspace/shiftlist run cf:dev      # local, needs a Postgres on :5432
pnpm --filter @workspace/shiftlist run cf:deploy   # manual deploy
pnpm --filter @workspace/shiftlist run cf:tail     # live logs
```

Pieces:

- **Postgres** lives at Neon; the Worker reaches it through a Cloudflare
  **Hyperdrive** binding (`env.HYPERDRIVE`). Run migrations against the direct
  Neon URL, never through Hyperdrive.
- **`public/staff/`** is served by Workers Static Assets, ahead of the Worker,
  at `/staff/*` — matching the one URL prefix this app owns on the zone.
- **Views** are inlined into the bundle by `scripts/gen-views.mjs`, because
  Workers have no filesystem to read `views/*.ejs` from.
- **Deploys** run through Workers Builds on every push to `main`.
- **Routes**, not a custom domain: `vikingvaporandsmoke.com/staff*` and
  `vikingvaporandsmoke.com/admin/shifts*` in `wrangler.jsonc`. The zone also
  routes `/admin*` and `/ordering*` to a separate Worker — see
  [Cloudflare topology](#cloudflare-topology-on-vikingvaporandsmokecom).

### Shared admin auth (no second login)

There is no ShiftList admin login. `/admin/shifts` verifies the session
cookie set by `jmashley1982/viking-product-ordering` — the Worker that owns
`vikingvaporandsmoke.com/admin` — instead of having its own
(`src/middleware/vikingAuth.ts`, ported from that repo's `auth.ts`). A manager
who is already logged into the dashboard clicks through to Shifts with no
prompt; anyone else is redirected to `/admin` to log in there.

This means **`SESSION_SECRET` on this Worker must be the exact same value**
as the ordering app's `SESSION_SECRET`. A mismatch doesn't error — it just
silently bounces every manager back to `/admin`, which is the first thing to
check if Shifts stops recognizing a logged-in session.

### Cloudflare topology on vikingvaporandsmoke.com

Three Workers, three repos, one zone, no service bindings between them —
routing is the only thing that ties them together:

| Worker | Repo | Routes |
|---|---|---|
| `viking` | `jmashley1982/viking` | everything else (storefront) |
| `viking-product-ordering` | `jmashley1982/viking-product-ordering` | `/admin*`, `/ordering*` |
| `shiftylist` (this repo) | `jmashley1982/shiftylist` | `/staff*`, `/admin/shifts*` |

Cloudflare matches the most specific route, so `/admin/shifts*` here wins
over the ordering app's `/admin*` — the same mechanism that app already
relies on for `/admin` vs. `/ordering`. The storefront Worker runs with
`not_found_handling: "single-page-application"`, so a request to a path none
of the above actually owns doesn't 404 — it silently renders the marketing
homepage with HTTP 200. If a link or redirect in this app is wrong, that's
what it looks like; check the response body, not just the status code.

### Workers constraints that the code depends on

These are load-bearing — changing them will break production:

- `src/worker.ts` must stay free of top-level `await`. `app.listen()` is only
  allowed during synchronous module evaluation.
- `env.HYPERDRIVE.connectionString` must not be read at global scope; it mints
  a credential, and generating random values there is a runtime error. It is
  read lazily via `setConnectionStringResolver`.
- `warmViews()` must run at startup. EJS compiles templates with
  `new Function`, which Workers only permit during startup.
- The per-request pool is closed from a `res.end` wrapper, not from the
  `finish`/`close` events — workerd emits those before express-session has
  finished writing, and closing early leaves the response unterminated.

## Where things live

- Server entry: `artifacts/shiftlist/src/index.ts`
- App setup (session, EJS, middleware): `artifacts/shiftlist/src/app.ts`
- Routes: `artifacts/shiftlist/src/routes/` (auth, staff, admin, health)
- Views (EJS): `artifacts/shiftlist/views/` and `views/admin/`
- Static CSS: `artifacts/shiftlist/public/staff/style.css`
- URL prefixes: `artifacts/shiftlist/src/lib/urls.ts` — every redirect, link,
  form action and `fetch()` is built from `staffUrl()`/`adminUrl()` rather
  than a literal, so the two path prefixes this Worker owns live in one place
- DB setup: `artifacts/shiftlist/src/db/index.ts` (wraps `@workspace/db` pool)
- DB schema: `lib/db/src/schema/index.ts` (Drizzle ORM)
- Date helpers: `artifacts/shiftlist/src/utils/dateHelpers.ts`

## Architecture decisions

- EJS server-rendered templates (not React) — matches the spec and keeps the codebase simple for a staff-facing internal tool.
- PostgreSQL via Drizzle ORM — persistent across autoscale restarts, managed by Replit.
- Shift submissions are stored in the `submissions` table; rows older than 30 days are deleted automatically on each admin report page load.
- Views and public files are referenced via `import.meta.url` so paths resolve correctly in both dev (src/) and prod (dist/) contexts.

## Product

- **Staff login**: Enter 4-digit code → confirm name → select shift (Open/Mid/Close) → see today's tasks
- **Task checklist**: Tick off tasks with timestamps, add notes
- **Incomplete task validation**: If not all tasks checked → modal asks to confirm and add a note
- **Report submission**: Tasks + notes saved to the database with timestamps; visible in the admin reports page
- **Admin panel**: Manage employees, view reports, and a single **Shifts** hub to build each shift's checklist:
  - **Standing list (always live)**: Each shift (Open/Mid/Close) has one checklist. Type a task and press Add — it's created (or reused) and instantly what staff see today. No publish step. Reorder/rename inline.
  - **Specific day (extra tasks)**: Pick a date to add extra tasks that appear only on that day, appended below the standing list.

## Admin workflow model

- The shift-checklist builder (`/admin/shifts/build`) uses `?shift=<id>` to select a shift and `?extraDate=<yyyy-mm-dd>` to switch to per-day extra tasks mode. `/admin/shifts` itself is the dashboard, not the builder.
- Staff (`/staff/tasks`) always see the standing checklist plus any extra tasks added for today.
- Tasks are created-or-reused by name via `INSERT … ON CONFLICT (name) DO UPDATE … RETURNING id`; the `tasks` table backs autocomplete suggestions.

## User preferences
- Dark theme with teal (`#3ecfb2`) accents and Oswald/Space Mono type, matching
  the design tokens on `vikingvaporandsmoke.com`'s dashboard
  (`artifacts/shiftlist/public/staff/style.css`) — the mobile-friendly radius
  and shadow geometry were kept as-is rather than matched, since this app is
  used on a phone behind a counter
- High contrast for readability in store lighting
- Logo displayed on all login and staff-facing pages

## Gotchas

- Run `pnpm install` after any change to `pnpm-workspace.yaml`.
- There is no `ADMIN_CODE` — see [Shared admin auth](#shared-admin-auth-no-second-login).
- Database schema changes are managed via Drizzle. After schema changes, run `pnpm --filter @workspace/db run push-force` to update the dev DB (use `push-force` — plain `push` may prompt interactively about constraint renames).
- The dev database is separate from production — when you publish, Replit will sync the schema to production.
- One unique index (`shift_tasks_shift_id_display_order_idx`) was applied directly via SQL (not through Drizzle). If you re-provision the production DB, re-apply it: `CREATE UNIQUE INDEX IF NOT EXISTS shift_tasks_shift_id_display_order_idx ON shift_tasks (shift_id, display_order);`
- `src/generated/views.ts` is generated from `views/*.ejs` and is not committed.
  Every entry point (`build`, `typecheck`, `cf:dev`, `cf:deploy`) regenerates it
  first, so edit the `.ejs` files, never the generated one.
- The `sessions` table backs express-session. It is in the Drizzle schema, so
  `push-force` creates it; `scripts/post-merge.sh` also creates it idempotently.
- The `active_sessions` table was also created via raw SQL (Drizzle push prompts interactively for the unique constraint and fails in CI). `scripts/post-merge.sh` creates it idempotently after every task merge. If you re-provision the production DB, the post-merge script handles it automatically.

## Environment secrets required

| Secret | Required for |
|---|---|
| `SESSION_SECRET` | Session security, and verifying the Viking ordering app's login cookie — **must exactly match that app's `SESSION_SECRET`**, or every manager is bounced back to `/admin`. |
| `DATABASE_URL` | Postgres connection (Node only — on Workers this comes from the Hyperdrive binding) |
| `STORE_TIMEZONE` | Store's IANA timezone (defaults to `America/Chicago`). Set this if the store is not in the US Central timezone — e.g. `America/Denver`, `America/Los_Angeles`, `America/New_York`. Controls all date strings and displayed timestamps. |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
