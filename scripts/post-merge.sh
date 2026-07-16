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

-- Time window columns (added to support timed tasks)
ALTER TABLE shift_tasks     ADD COLUMN IF NOT EXISTS time_start TEXT;
ALTER TABLE shift_tasks     ADD COLUMN IF NOT EXISTS time_end   TEXT;
ALTER TABLE extra_day_tasks ADD COLUMN IF NOT EXISTS time_start TEXT;
ALTER TABLE extra_day_tasks ADD COLUMN IF NOT EXISTS time_end   TEXT;
ALTER TABLE task_completions ADD COLUMN IF NOT EXISTS late_reason TEXT;

-- Add auto_submitted flag to submissions (idempotent)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS auto_submitted BOOLEAN NOT NULL DEFAULT FALSE;

-- Staff notice (admin-written pop-up shown to staff after login)
CREATE TABLE IF NOT EXISTS staff_notice (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  subtitle   TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL
