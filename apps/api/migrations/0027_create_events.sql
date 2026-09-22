-- Migration 0027: events board, audience grants and the per-event flyer
-- Milestone 20 — Events board: public listing, access-scoped audiences (Task 02)
-- Derived from RFC 0014 section 1. Purely additive: it creates three tables and
-- their indexes and issues no ALTER against any table that existed before it, so
-- the rollback is dropping the three and no backfill exists to undo.
-- Apply locally with: make db-migrate-local

-- An event is an ANNOUNCEMENT, not a product. It has no price, no invoice and no
-- enrollment, and being able to see one grants no content access whatsoever —
-- which is why nothing here references topic_nodes, media or enrollments_*.
CREATE TABLE IF NOT EXISTS events (
  id               TEXT NOT NULL PRIMARY KEY,
  -- URL-facing identity. UNIQUE so the database, not a pre-check, arbitrates a
  -- collision: two admins naming an event the same thing race, and the loser
  -- retries with the next suffix instead of overwriting the winner.
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',          -- plain text, the list card blurb
  content          TEXT NOT NULL DEFAULT '',          -- markdown, sanitizeMarkdown on write
  location         TEXT NOT NULL DEFAULT '',
  -- Canonical 'YYYY-MM-DD HH:MM:SS' UTC, the form datetime() both emits and parses.
  -- The scope predicate below calls datetime(starts_at, '+1 day'), so a stored value
  -- SQLite cannot parse would silently yield NULL and drop the row from both lists.
  starts_at        TEXT NOT NULL,
  -- Nullable by design: a seminar rarely commits to a closing time. An open-ended
  -- event expires one day after it starts rather than lingering on the board forever.
  ends_at          TEXT,
  -- Stored beside the instant because an anonymous reader carries no users.timezone,
  -- and the dojo's own wall-clock time is the only one worth showing a stranger.
  timezone         TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  -- Defaulted in the SCHEMA, not in application code, so a caller that forgets the
  -- column cannot publish by omission. A row is invisible until a human publishes it.
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','archived')),
  -- Likewise defaulted to the narrower of the three levels: the failure mode of a
  -- wrong default must be "fewer people saw it", never "we published a private
  -- grading to the open internet". The CHECK exists so an out-of-range write fails
  -- at the database instead of widening an audience to a value nobody resolves.
  audience         TEXT NOT NULL DEFAULT 'members'
                     CHECK (audience IN ('public','members','restricted')),

  -- Flyer: exactly one image owned by one event (RFC 0014 section 3). It lives in
  -- columns here rather than in `media` because media.topic_node_id is NOT NULL —
  -- keeping events out of that table guarantees no event can ever be reached by a
  -- topic or enrollment query by accident.
  flyer_status     TEXT NOT NULL DEFAULT 'none'
                     CHECK (flyer_status IN ('none','pending','ready')),
  flyer_key        TEXT,
  flyer_type       TEXT,
  flyer_size_bytes INTEGER,
  flyer_name       TEXT,
  -- Internal bookkeeping, never part of the entity: the key a still-unconfirmed
  -- upload is about to displace. Presign overwrites flyer_key, so without this the
  -- previous object's key is lost and IEventRepository.setFlyerReady could not
  -- return it for deletion. Deleting at presign time instead would destroy a live
  -- flyer whenever an upload is abandoned, so the orphan is held until finalize.
  flyer_replaced_key TEXT,

  -- Contact: the responsible person for THIS event (RFC 0014 section 5).
  whatsapp_number  TEXT NOT NULL DEFAULT '',          -- normalised digits, or '' to fall back
  whatsapp_message TEXT,                              -- NULL -> composed from the title at read time
  contact_label    TEXT NOT NULL DEFAULT '',          -- '' -> the dictionary default

  -- RESTRICT, not CASCADE: deleting an administrator must not silently erase the
  -- announcements they published.
  created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Covers the leading predicate of both reader queries (status, then audience) and
-- leaves starts_at to satisfy the ORDER BY without a sort.
CREATE INDEX IF NOT EXISTS idx_events_listing ON events (status, audience, starts_at);

-- Audience grants. Deliberately NOT the enrollments_* tables: a row here says
-- "may see this announcement", never "may open this content". Reading one as an
-- enrollment would hand out the learning tree to everyone invited to a seminar.
CREATE TABLE IF NOT EXISTS event_audience_group (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- CASCADE both ways: a grant is meaningless once either side is gone, and a
  -- disbanded group must stop conferring visibility without taking the event with it.
  group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, group_id)
);

CREATE TABLE IF NOT EXISTS event_audience_user (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- The composite primary keys serve the event -> grant direction. These cover the
-- reverse one, which is what the authenticated EXISTS sub-selects walk.
CREATE INDEX IF NOT EXISTS idx_event_audience_group_group ON event_audience_group (group_id);
CREATE INDEX IF NOT EXISTS idx_event_audience_user_user   ON event_audience_user (user_id);
