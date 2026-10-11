-- Migration 0031: mission requirements (RFC 0022 section 1, M27 Task 04)
-- Evidence-driven missions: ordered steps, enrollments, per-step progress, captured
-- evidence and assignment grants. Additive: two ADD COLUMN on missions (their
-- defaults keep every existing row valid) and six new tables. No statement touches
-- any other existing table.
-- Rollback: drop mission_audience_user, mission_audience_group, mission_evidence,
-- mission_requirement_progress, mission_enrollments and mission_requirements. The two
-- added columns are inert for the M7 code and can stay.
-- Apply locally: make db-migrate-local

-- Mode and enrollment policy. start_at / end_at already exist and stay NOT NULL:
-- there is no mission without a window.
ALTER TABLE missions ADD COLUMN mode TEXT NOT NULL DEFAULT 'parallel'
  CHECK (mode IN ('parallel', 'sequential'));
ALTER TABLE missions ADD COLUMN enrollment_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK (enrollment_mode IN ('auto', 'open', 'assigned'));

-- The mission's own steps.
CREATE TABLE IF NOT EXISTS mission_requirements (
  id             TEXT NOT NULL PRIMARY KEY,
  mission_id     TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 1),
  kind           TEXT NOT NULL CHECK (kind IN ('submissions_on_topic', 'topic_visited',
                   'video_watched', 'manual_check', 'event_participation')),
  title          TEXT NOT NULL,                       -- 1…120, shown as the step label
  -- Targets are typed columns, not JSON, so the database holds referential integrity
  -- and the hooks find "requirements on this topic" through an index.
  topic_node_id  TEXT REFERENCES topic_nodes(id) ON DELETE RESTRICT,
  event_id       TEXT REFERENCES events(id) ON DELETE RESTRICT,
  params         TEXT NOT NULL DEFAULT '{}',          -- parsed by RequirementParams[kind] on every write and read
  xp_reward      INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mission_id, position),
  CHECK (
    (kind IN ('submissions_on_topic', 'topic_visited', 'video_watched')
       AND topic_node_id IS NOT NULL AND event_id IS NULL)
    OR (kind = 'event_participation' AND event_id IS NOT NULL AND topic_node_id IS NULL)
    OR (kind = 'manual_check' AND topic_node_id IS NULL AND event_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_mission_requirements_topic
  ON mission_requirements (topic_node_id, kind) WHERE topic_node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mission_requirements_event
  ON mission_requirements (event_id) WHERE event_id IS NOT NULL;

-- Who takes part. counts_from is the evidence floor for this user (§3.3).
CREATE TABLE IF NOT EXISTS mission_enrollments (
  mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('auto', 'self', 'admin')),
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  counts_from  TEXT NOT NULL,                         -- 'YYYY-MM-DD HH:MM:SS' UTC
  left_at      TEXT,                                  -- set by Leave or by an audience removal
  PRIMARY KEY (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_enrollments_user
  ON mission_enrollments (user_id, mission_id) WHERE left_at IS NULL;

-- Per-step progress. completed_at is write-once (§3.5).
CREATE TABLE IF NOT EXISTS mission_requirement_progress (
  requirement_id TEXT NOT NULL REFERENCES mission_requirements(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id     TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  current_count  INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  target_count   INTEGER NOT NULL CHECK (target_count >= 1),
  checked_at     TEXT,                                -- manual_check: when the student ticked it
  completed_at   TEXT,                                -- evidence instant of the target-th item
  completed_by   TEXT CHECK (completed_by IN ('hook', 'reconcile')),
  recorded_at    TEXT,                                -- wall clock when completed_at was written
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (requirement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_requirement_progress_user
  ON mission_requirement_progress (user_id, mission_id);

-- Captured evidence for the two kinds whose source keeps no history (§3.2).
CREATE TABLE IF NOT EXISTS mission_evidence (
  requirement_id TEXT NOT NULL REFERENCES mission_requirements(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_id         TEXT NOT NULL,                       -- media id (video_watched) or topic id (topic_visited)
  occurred_at    TEXT NOT NULL,                       -- 'YYYY-MM-DD HH:MM:SS' UTC
  source         TEXT NOT NULL CHECK (source IN ('hook', 'backfill')),
  PRIMARY KEY (requirement_id, user_id, ref_id)
);

-- Assignment grants for enrollment_mode = 'assigned' — the event-audience shape.
CREATE TABLE IF NOT EXISTS mission_audience_group (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, group_id)
);
CREATE TABLE IF NOT EXISTS mission_audience_user (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_audience_group_group ON mission_audience_group (group_id);
CREATE INDEX IF NOT EXISTS idx_mission_audience_user_user   ON mission_audience_user (user_id);
