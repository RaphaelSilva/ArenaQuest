-- Migration 0032: job_runs (RFC 0025 section 3.1, M28 Task 05)
-- One row per execution of a scheduled or manually triggered job, so "did
-- billing run today, and what did it do?" has a factual answer for every day,
-- failures and empty days included. 0031 is claimed by M27.
-- Touches no existing table. Idempotent: every statement uses IF NOT EXISTS.
-- Rollback is dropping the table; there is no backfill.
--
-- status: running (inserted before the job starts) -> ok | failed.
-- summary holds a JSON object of integer counts only - never a payload, an id,
-- a name or an amount. error is the message, truncated to 1024 characters by
-- the adapter - never a request body, personal data or a secret.
-- actor_id is the admin behind a manual run and NULL for the cron; it is not a
-- foreign key so a job record outlives the account that triggered it.

CREATE TABLE IF NOT EXISTS job_runs (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL CHECK (job IN ('billing', 'sweep_submissions')),
  trigger     TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  actor_id    TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  summary     TEXT,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs (job, started_at DESC);
