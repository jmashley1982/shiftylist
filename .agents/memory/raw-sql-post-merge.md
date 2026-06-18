---
name: Raw-SQL tables and post-merge
description: Tables created via raw SQL in a task agent's isolated env must be added to post-merge.sh or they won't exist in the main dev DB.
---

## Rule
Any table created via `psql` / raw SQL (not Drizzle push) in a task agent's environment **will not exist in the main dev DB** after the merge. The `scripts/post-merge.sh` script runs automatically after every task merge — put `CREATE TABLE IF NOT EXISTS ...` statements there to ensure idempotent application.

**Why:** Drizzle `push --force` fails non-interactively when it would need to resolve constraint rename conflicts (exits with TTY error). Task agents work around this with raw SQL, but their DB is isolated. The main agent's DB is separate and never receives those raw SQL statements unless post-merge.sh runs them.

**How to apply:** When a task agent adds a table via raw SQL:
1. Add the full `CREATE TABLE IF NOT EXISTS` DDL to `scripts/post-merge.sh`.
2. Apply it manually in the main dev DB right now: `psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS ..."`.
3. Document the table in `replit.md` Gotchas so future agents know Drizzle won't manage it.

## Current raw-SQL tables (as of 2026-06-18)
- `active_sessions` — tracks which staff are currently logged in and on which shift. Added to post-merge.sh.
- `shift_tasks_shift_id_display_order_idx` unique index — applied via SQL directly (not a table, but same pattern).
