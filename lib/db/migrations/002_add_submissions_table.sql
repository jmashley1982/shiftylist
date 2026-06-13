-- Migration: replace Google Sheets report logging with internal DB storage
-- Submissions from staff shift completions are now stored here.
-- Rows older than 30 days are deleted automatically on each admin reports page load.
-- Applied: 2026-06-13

CREATE TABLE IF NOT EXISTS submissions (
  id           serial PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  employee_code text NOT NULL,
  employee_name text NOT NULL,
  shift_name    text NOT NULL,
  date          text NOT NULL,
  task_summary  text NOT NULL,
  notes         text NOT NULL DEFAULT ''
);
