-- Migration: Drop orphaned daily_shifts and daily_shift_tasks tables
--
-- These tables were part of an earlier "day override" model where admins
-- could fully replace the standing shift task list for a specific date.
-- That model was replaced by the current additive extra_day_tasks approach,
-- which lets admins add extra tasks for a specific day without replacing
-- the standing list. The daily_shifts and daily_shift_tasks tables were
-- orphaned — no application code read or wrote them.
--
-- Applied to dev on 2026-06-13.
-- Prod will be synced via the normal Publish flow.
--
-- Verification before drop (run to confirm no live data):
--   SELECT COUNT(*) FROM daily_shifts;       -- expected: 0
--   SELECT COUNT(*) FROM daily_shift_tasks;  -- expected: 0
--
-- Drop child table first to respect foreign key constraint.
DROP TABLE IF EXISTS daily_shift_tasks CASCADE;
DROP TABLE IF EXISTS daily_shifts CASCADE;
