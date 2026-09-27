-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica a populated events board: the five rows the audience
-- matrix actually turns on, plus the group membership the `restricted` case
-- needs in order to be exercisable at all (RFC 0014, Milestone 20 Task 08).
-- Run via: make db-seed-local
--
-- Depends on 0001_test_users.sql for the admin and student accounts, and on
-- migration 0027 for `events`, `event_audience_group` and `event_audience_user`.
--
-- Every statement is INSERT OR IGNORE, so re-seeding is a no-op.
--
-- Three properties of this file are deliberate and should survive edits:
--
--   1. **Dates are relative, not literal.** `datetime('now', '+21 days')` keeps
--      "upcoming" upcoming a year from now; a hardcoded timestamp would quietly
--      turn the whole board into history and make the seed useless exactly when
--      someone new clones the repo. The emitted form is the canonical
--      'YYYY-MM-DD HH:MM:SS' UTC that D1EventRepository stores and that the
--      scope predicate's datetime(starts_at, '+1 day') can parse.
--   2. **The phone numbers are all-zero placeholders.** A seed is copied into
--      screenshots, demos and shared test environments; a real number in it
--      would eventually be dialled by a stranger. `5500000000000` normalises
--      (13 digits, within normalizeWhatsapp's 10–15 range) so the button still
--      renders, and is unmistakably not a person.
--   3. **No flyer.** `flyer_status` stays 'none' on every row. A SQL seed cannot
--      put an object in R2, so a row claiming 'ready' would point flyer_key at a
--      key that does not exist. Task 07 added an onError placeholder so that
--      would degrade rather than break — but seeding a lie is still the wrong
--      default, and "no flyer" is a state the board has to render correctly
--      anyway.
--
-- The pre-filled messages are written in English because this repository's
-- content is English; they are fixture text, not a product default. The API
-- composes nothing (RFC 0014, decision of 2026-09-22) — whatever is in
-- whatsapp_message is exactly what a visitor will send.

-- ---------------------------------------------------------------------------
-- The group the restricted event is granted to.
--
-- No user_groups row was seeded anywhere in this repository before this file,
-- which meant the `restricted` audience — the most security-relevant branch in
-- the milestone — could not be exercised locally without hand-written SQL. The
-- group and its one membership are therefore part of this seed, not a
-- prerequisite left to the reader.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO user_groups (id, name, description) VALUES
  (
    'seed-group-blackbelt-0000-0000-00001',
    'Black Belts',
    'Local seed group. Grants visibility of the restricted seeded event; grants no content access whatsoever — an event audience is not an enrollment.'
  );

-- The seeded student is the member, so the documented student@arenaquest.dev
-- login is enough to see the restricted event. student2@arenaquest.dev (seeded
-- by 0002) is deliberately left out: it is the non-member control that makes
-- the restricted case falsifiable rather than merely visible.
INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES
  ('seed-group-blackbelt-0000-0000-00001', 'seed-student-0000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- The events.
--
-- Columns are written out in full rather than relying on the schema defaults,
-- so the audience and status of every row is readable here instead of inferred
-- from 0027.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO events
  (id, slug, title, summary, content, location,
   starts_at, ends_at, timezone, status, audience,
   flyer_status, whatsapp_number, whatsapp_message, contact_label, created_by) VALUES

  -- 1. PUBLIC · UPCOMING — the only row an anonymous GET /v1/events returns.
  (
    'seed-event-public-upcoming-00000001',
    'open-mat-seminar',
    'Open Mat Seminar',
    'An open training session. No membership required — bring a friend.',
    '## Open Mat Seminar

Two hours of open training, followed by a short Q&A. Beginners welcome; no
grading and no pressure.

Bring water and a clean gi.',
    'Main dojo',
    datetime('now', '+21 days', 'start of day', '+19 hours'),
    datetime('now', '+21 days', 'start of day', '+21 hours'),
    'America/Sao_Paulo',
    'published',
    'public',
    'none',
    '5500000000000',
    'Hello! I would like to know more about the Open Mat Seminar.',
    '',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  ),

  -- 2. MEMBERS · UPCOMING — the difference a token makes. Absent from the
  -- anonymous response, present for any authenticated caller.
  (
    'seed-event-members-upcoming-0000002',
    'members-training-camp',
    'Members Training Camp',
    'A full-day camp for enrolled students.',
    '## Members Training Camp

A full day of technical work, split into three blocks with a shared lunch in
between. Open to every enrolled student regardless of belt.',
    'Main dojo',
    datetime('now', '+14 days', 'start of day', '+9 hours'),
    datetime('now', '+14 days', 'start of day', '+17 hours'),
    'America/Sao_Paulo',
    'published',
    'members',
    'none',
    '5500000000000',
    'Hello! I am a member and I would like to join the Members Training Camp.',
    '',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  ),

  -- 3. RESTRICTED · UPCOMING — granted to the seeded group below. Visible to
  -- student@arenaquest.dev (a member) and to nobody else, anonymous or not.
  -- contact_label is overridden here, which is the only row that exercises the
  -- "else the dictionary default" branch of contact resolution.
  (
    'seed-event-restricted-upcoming-0003',
    'black-belt-grading',
    'Black Belt Grading',
    'Grading session for black belt candidates. By invitation.',
    '## Black Belt Grading

Closed session. Candidates should arrive one hour early for the technical
review.',
    'Main dojo',
    datetime('now', '+28 days', 'start of day', '+8 hours'),
    NULL,
    'America/Sao_Paulo',
    'published',
    'restricted',
    'none',
    '5500000000000',
    'Hello! I am on the list for the Black Belt Grading.',
    'Confirm my place',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  ),

  -- 4. PUBLIC · PAST — proves the computed scope predicate without waiting for
  -- a clock. Absent from the default ?scope=upcoming, present in ?scope=past,
  -- and no write happens as it crosses over. It is `public` on purpose: the
  -- predicate is then observable anonymously, on the same call as row 1.
  (
    'seed-event-public-past-000000004',
    'summer-graduation',
    'Summer Graduation',
    'Last season''s graduation ceremony.',
    '## Summer Graduation

Belts were awarded across every level, followed by a shared meal. Photos are
with the instructors.',
    'Main dojo',
    datetime('now', '-30 days', 'start of day', '+19 hours'),
    datetime('now', '-30 days', 'start of day', '+22 hours'),
    'America/Sao_Paulo',
    'published',
    'public',
    'none',
    '',
    NULL,
    '',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  ),

  -- 5. DRAFT — must never appear on any public surface. Its audience is
  -- deliberately the WIDEST one ('public'), so that if it ever does show up,
  -- the failure is unambiguously in the status filter rather than in the
  -- audience resolver. Visible only through GET /v1/admin/events.
  (
    'seed-event-draft-00000000000005',
    'unannounced-workshop',
    'Unannounced Workshop (draft)',
    'Not announced yet. If you can see this on the public board, the status filter is broken.',
    '## Unannounced Workshop

Draft. Dates and the guest instructor are not confirmed.',
    'To be confirmed',
    datetime('now', '+7 days', 'start of day', '+19 hours'),
    NULL,
    'America/Sao_Paulo',
    'draft',
    'public',
    'none',
    '5500000000000',
    'Hello! I would like to know more about the Unannounced Workshop.',
    '',
    'seed-admin-00000000-0000-0000-0000-000000000001'
  );

-- The grant that makes row 3 reachable. Without this row the restricted event
-- is invisible to everyone, which looks identical to a working audience filter
-- and is why the group above is seeded here rather than assumed.
INSERT OR IGNORE INTO event_audience_group (event_id, group_id) VALUES
  ('seed-event-restricted-upcoming-0003', 'seed-group-blackbelt-0000-0000-00001');
