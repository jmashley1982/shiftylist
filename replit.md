# ShiftList — Staff Shift To-Do List

A server-rendered internal web app for managing staff shift tasks. Staff log in with a 4-digit code, tick off tasks as they complete them (with time logging), and submit a final report to Google Sheets. Admins manage employees, shift templates, one-off scheduled tasks, and view reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build + run the server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Server: Express 5 + EJS templates
- DB: SQLite (better-sqlite3) — stored at `artifacts/api-server/shiftdb.sqlite`
- Auth: express-session with 4-digit staff codes + admin code
- Google Sheets: googleapis (service account)
- Date: date-fns
- Build: esbuild (ESM bundle)

## Where things live

- Server entry: `artifacts/api-server/src/index.ts`
- App setup (session, EJS, middleware): `artifacts/api-server/src/app.ts`
- Routes: `artifacts/api-server/src/routes/` (auth, staff, admin, health)
- Views (EJS): `artifacts/api-server/views/` and `views/admin/`
- Static CSS: `artifacts/api-server/public/style.css`
- DB setup + types: `artifacts/api-server/src/db/index.ts`
- Google Sheets utils: `artifacts/api-server/src/utils/sheets.ts`
- Date helpers: `artifacts/api-server/src/utils/dateHelpers.ts`

## Architecture decisions

- EJS server-rendered templates (not React) — matches the spec and keeps the codebase simple for a staff-facing internal tool.
- SQLite via better-sqlite3 — synchronous API, zero config, persistent at the artifact root.
- Google Sheets integration is lazy-imported and gracefully no-ops if credentials aren't set — the app works without Sheets, it just won't log submissions.
- `better-sqlite3` is externalized from esbuild (native module) and listed in `onlyBuiltDependencies`.
- Views and public files are referenced via `import.meta.url` so paths resolve correctly in both dev (src/) and prod (dist/) contexts.

## Product

- **Staff login**: Enter 4-digit code → confirm name → see today's shift tasks
- **Task checklist**: Tick off tasks with timestamp, covering shift support
- **Report submission**: Tasks logged to Google Sheets with timestamps
- **Admin panel**: Manage employees, shift templates (Open/Mid/Close), one-off scheduled tasks (next 14 days), view last 30 days of reports

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm install` after any change to `pnpm-workspace.yaml`.
- `better-sqlite3` is a native module — it's in `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Don't remove it.
- Google Sheets submission silently skips if `SPREADSHEET_ID` / `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` are not set. The app still works for task management without them.
- Admin code defaults to `1234` if `ADMIN_CODE` env var is not set.

## Environment secrets required

| Secret | Required for |
|---|---|
| `SESSION_SECRET` | ✅ Already set — session security |
| `ADMIN_CODE` | Admin panel login (defaults to `1234` if unset) |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Google Sheets report logging |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Google Sheets report logging |
| `SPREADSHEET_ID` | Google Sheets report logging |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
