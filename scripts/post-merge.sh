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

-- Login sessions (express-session store; also in the Drizzle schema)
CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   JSONB NOT NULL,
  expire TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- Staff notice (admin-written pop-up shown to staff after login)
CREATE TABLE IF NOT EXISTS staff_notice (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  subtitle   TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Company Board: the company-wide to-do list managers keep and staff read
CREATE TABLE IF NOT EXISTS company_categories (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS company_goals (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER REFERENCES company_categories(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'not_started',
  owner         TEXT NOT NULL DEFAULT '',
  target_date   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS company_goal_updates (
  id         SERIAL PRIMARY KEY,
  goal_id    INTEGER NOT NULL REFERENCES company_goals(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT 'Management',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_goal_updates_goal_idx
  ON company_goal_updates (goal_id, created_at);
SQL
