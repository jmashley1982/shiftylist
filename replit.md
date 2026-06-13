# ShiftList — Viking Vapor & Smoke Staff Shift To-Do List

A server-rendered internal web app for managing staff shift tasks. Staff log in with a 4-digit code, tick off tasks as they complete them (with time logging), and submit a final report stored in the database. Admins manage employees, shift templates, one-off scheduled tasks, and view reports.

## Run & Operate

- `pnpm --filter @workspace/shiftlist run dev` — build + run the server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Server: Express 5 + EJS templates
- DB: PostgreSQL (Replit built-in) — schema managed via Drizzle ORM
- Auth: express-session with 4-digit staff codes + admin code
- Date: date-fns
- Build: esbuild (ESM bundle)

## Where things live

- Server entry: `artifacts/shiftlist/src/index.ts`
- App setup (session, EJS, middleware): `artifacts/shiftlist/src/app.ts`
- Routes: `artifacts/shiftlist/src/routes/` (auth, staff, admin, health)
- Views (EJS): `artifacts/shiftlist/views/` and `views/admin/`
- Static CSS: `artifacts/shiftlist/public/style.css`
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

- The `/admin/shifts` hub uses `?shift=<id>` to select a shift and `?date=<yyyy-mm-dd>` to switch to per-day extra tasks mode.
- Staff (`/staff/tasks`) always see the standing checklist plus any extra tasks added for today.
- Tasks are created-or-reused by name via `INSERT … ON CONFLICT (name) DO UPDATE … RETURNING id`; the `tasks` table backs autocomplete suggestions.

## User preferences
- Dark theme with teal (#38b6a0) accents matching the Viking Vapor & Smoke logo
- High contrast for readability in store lighting
- Logo displayed on all login and staff-facing pages

## Gotchas

- Run `pnpm install` after any change to `pnpm-workspace.yaml`.
- Admin code defaults to `1234` if `ADMIN_CODE` env var is not set.
- Database schema changes are managed via Drizzle. After schema changes, run `pnpm --filter @workspace/db run push-force` to update the dev DB (use `push-force` — plain `push` may prompt interactively about constraint renames).
- The dev database is separate from production — when you publish, Replit will sync the schema to production.
- One unique index (`shift_tasks_shift_id_display_order_idx`) was applied directly via SQL (not through Drizzle). If you re-provision the production DB, re-apply it: `CREATE UNIQUE INDEX IF NOT EXISTS shift_tasks_shift_id_display_order_idx ON shift_tasks (shift_id, display_order);`

## Environment secrets required

| Secret | Required for |
|---|---|
| `SESSION_SECRET` | ✅ Already set — session security |
| `ADMIN_CODE` | Admin panel login (defaults to `1234` if unset) |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
