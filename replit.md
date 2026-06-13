# ShiftList — Viking Vapor & Smoke Staff Shift To-Do List

A server-rendered internal web app for managing staff shift tasks. Staff log in with a 4-digit code, tick off tasks as they complete them (with time logging), and submit a final report to Google Sheets. Admins manage employees, shift templates, one-off scheduled tasks, and view reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build + run the server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Server: Express 5 + EJS templates
- DB: PostgreSQL (Replit built-in) — schema managed via Drizzle ORM
- Auth: express-session with 4-digit staff codes + admin code
- Google Sheets: googleapis (service account)
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
- Google Sheets utils: `artifacts/shiftlist/src/utils/sheets.ts`
- Date helpers: `artifacts/shiftlist/src/utils/dateHelpers.ts`

## Architecture decisions

- EJS server-rendered templates (not React) — matches the spec and keeps the codebase simple for a staff-facing internal tool.
- PostgreSQL via Drizzle ORM — persistent across autoscale restarts, managed by Replit.
- Google Sheets integration is lazy-imported and gracefully no-ops if credentials aren't set — the app works without Sheets, it just won't log submissions.
- Views and public files are referenced via `import.meta.url` so paths resolve correctly in both dev (src/) and prod (dist/) contexts.

## Product

- **Staff login**: Enter 4-digit code → confirm name → select shift (Open/Mid/Close) → see today's tasks
- **Task checklist**: Tick off tasks with timestamps, add notes
- **Incomplete task validation**: If not all tasks checked → modal asks to confirm and add a note
- **Report submission**: Tasks + notes logged to Google Sheets with timestamps
- **Admin panel**: Manage employees, reusable task templates, shift templates (Open/Mid/Close), schedule daily shifts (date picker, publish/unpublish, add/remove/reorder tasks), view reports

## User preferences
- Dark theme with teal (#38b6a0) accents matching the Viking Vapor & Smoke logo
- High contrast for readability in store lighting
- Logo displayed on all login and staff-facing pages

## Gotchas

- Run `pnpm install` after any change to `pnpm-workspace.yaml`.
- Google Sheets submission silently skips if `SPREADSHEET_ID` / `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` are not set. The app still works for task management without them.
- Admin code defaults to `1234` if `ADMIN_CODE` env var is not set.
- Database schema changes are managed via Drizzle. After schema changes, run `pnpm --filter @workspace/db run push` to update the dev DB.
- The dev database is separate from production — when you publish, Replit will sync the schema to production.

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
