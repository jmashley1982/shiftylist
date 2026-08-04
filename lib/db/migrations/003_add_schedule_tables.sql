-- Migration: Homebase schedule import
--
-- scheduled_shifts holds the "who is supposed to work when" data imported
-- from a Homebase CSV export (Homebase's API is Enterprise-tier and out of
-- reach on the current plan). shift_time_rules maps a shift's start time to
-- one of this store's shift types (Open/Mid/Close), editable in the admin.
--
-- Like staff_notice, these tables are also created lazily via
-- "CREATE TABLE IF NOT EXISTS" the first time a schedule route runs
-- (src/lib/scheduleTables.ts) — the app deploys from Cloudflare, not this
-- migration file, so the app can't depend on this having been run first.
-- This file exists as the source-of-truth record of the schema.
--
-- Applied: 2026-08-04

CREATE TABLE IF NOT EXISTS scheduled_shifts (
  id            serial PRIMARY KEY,
  date          text NOT NULL,
  employee_id   integer NOT NULL,
  employee_name text NOT NULL,
  shift_id      integer NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  start_time    text NOT NULL,
  end_time      text,
  source        text NOT NULL DEFAULT 'homebase_csv',
  imported_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, employee_id, start_time)
);

CREATE TABLE IF NOT EXISTS shift_time_rules (
  id          serial PRIMARY KEY,
  shift_id    integer NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
  start_from  text NOT NULL,
  start_until text NOT NULL
);
