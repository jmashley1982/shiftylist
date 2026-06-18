#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force

# Tables created via raw SQL (Drizzle push skips them — apply idempotently here)
psql "$DATABASE_URL" << 'SQL'
CREATE TABLE IF NOT EXISTS active_sessions (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL,
  employee_name TEXT NOT NULL,
  shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  shift_name    TEXT NOT NULL,
  date          TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);
SQL
