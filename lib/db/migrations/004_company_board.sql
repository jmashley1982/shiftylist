-- Migration: Company Board
--
-- A single company-wide to-do list, separate from the per-shift checklists.
-- Management owns it; every staff member sees it read-only after logging in,
-- so the team can see what the business is working on behind the scenes and
-- how far along each piece is.
--
-- company_goals is the list itself (status, owner, target date);
-- company_goal_updates is the dated progress history staff read;
-- company_categories groups goals by theme (Store, Online, Hiring, …).
--
-- Like scheduled_shifts and staff_notice, these are also created lazily via
-- "CREATE TABLE IF NOT EXISTS" the first time a company route runs
-- (artifacts/shiftlist/src/lib/companyBoard.ts) — the app deploys from
-- Cloudflare, not this migration file, so the app can't depend on this having
-- been run first. This file exists as the source-of-truth record of the schema.
--
-- Applied: 2026-08-13

CREATE TABLE IF NOT EXISTS company_categories (
  id            serial PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS company_goals (
  id            serial PRIMARY KEY,
  category_id   integer REFERENCES company_categories(id) ON DELETE SET NULL,
  title         text NOT NULL,
  detail        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'not_started',  -- not_started | in_progress | done
  owner         text NOT NULL DEFAULT '',
  target_date   text,                                 -- 'YYYY-MM-DD', optional
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE IF NOT EXISTS company_goal_updates (
  id         serial PRIMARY KEY,
  goal_id    integer NOT NULL REFERENCES company_goals(id) ON DELETE CASCADE,
  note       text NOT NULL,
  author     text NOT NULL DEFAULT 'Management',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_goal_updates_goal_idx
  ON company_goal_updates (goal_id, created_at);
