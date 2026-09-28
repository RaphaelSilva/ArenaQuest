-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica one example of every state the student notes UI
-- renders: a private note, a shared note and a moderated note (RFC 0016,
-- Milestone 21 Task 08).
-- Run via: make db-seed-local
--
-- Depends on 0001_test_users.sql (admin, student) and 0002_billing_local.sql
-- (student2), and on migration 0028 for `topic_notes`.
--
-- Every statement is INSERT OR IGNORE on a fixed id, so re-seeding is a no-op.
--
-- Three properties of this file are deliberate and should survive edits:
--
--   1. **The topics are seeded here, not assumed.** No earlier seed creates a
--      topic, and a note needs one that passes the catalog gate: published,
--      not archived and in the reader's effective access set. Both topics are
--      `visibility = 'public'`, which puts them in every account's access set
--      without an enrollment row, so the seed never touches `enrollments_*`.
--   2. **Two topics, because of UNIQUE (topic_node_id, author_id).** Only two
--      student accounts are seeded, and each may hold one note per topic. The
--      first topic carries the private and the shared note side by side, so
--      the privacy rule is falsifiable on one page: student2 wrote the
--      private note, and student@ must see the shared note but not that one.
--      The moderated note lives on the second topic.
--   3. **The moderated row is what setModeration would have written.** It was
--      created (revision 1), shared (revision 2, shared_at stamped) and then
--      force-unshared by the seeded admin (revision 3): visibility 'private',
--      shared_at kept, moderated_at / moderated_by set. A row with
--      moderated_at but revision 1 would be a state the API cannot produce.
--
-- Dates are relative (`datetime('now', ...)`) so "newest first" orderings stay
-- meaningful whenever the replica is reset. Author names are joined from
-- `users`, so no name is repeated here.
--
-- Accounts that see each state (passwords in 0001 / 0002):
--   student@arenaquest.dev   → own shared note on topic 1 (flagged isMine),
--                              own moderated note on topic 2 (banner, switch off)
--   student2@arenaquest.dev  → own private note on topic 1, and student@'s
--                              shared note in Class notes
--   admin@ / professor@      → all three, private included, with badges and
--                              Unshare / Allow sharing again

-- ---------------------------------------------------------------------------
-- The topics.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_nodes
  (id, parent_id, title, content, status, sort_order, estimated_minutes, archived, visibility) VALUES
  (
    'seed-topic-notes-0000-0000-00000001',
    NULL,
    'Study Notes Sandbox',
    '## Study Notes Sandbox

A local seed topic for the Notes panel. It carries one **shared** note by
student@arenaquest.dev and one **private** note by student2@arenaquest.dev.

Log in as each of them, and as a staff account, to compare what each one sees.',
    'published',
    900,
    10,
    0,
    'public'
  ),
  (
    'seed-topic-notes-0000-0000-00000002',
    NULL,
    'Moderated Notes Sandbox',
    '## Moderated Notes Sandbox

A local seed topic whose only note was shared and then unshared by staff.
Its author sees the moderation banner and cannot share it again until staff
allow it.',
    'published',
    901,
    10,
    0,
    'public'
  );

-- ---------------------------------------------------------------------------
-- The notes.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_notes
  (id, topic_node_id, author_id, body, visibility, revision,
   shared_at, moderated_at, moderated_by, created_at, updated_at) VALUES

  -- 1. SHARED — listed in Class notes for every reader of topic 1.
  (
    'seed-note-shared-0000-0000-00000001',
    'seed-topic-notes-0000-0000-00000001',
    'seed-student-0000-0000-0000-0000-000000000002',
    '## What I took from this topic

- Keep the notes short and in my own words.
- Review them before the next class.

Sharing this one so the class can compare.',
    'shared',
    2,
    datetime('now', '-2 days'),
    NULL,
    NULL,
    datetime('now', '-3 days'),
    datetime('now', '-2 days')
  ),

  -- 2. PRIVATE — readable by its author and by staff only. It must never
  -- appear to student@arenaquest.dev, on this topic's Class notes or anywhere.
  (
    'seed-note-private-000-0000-00000002',
    'seed-topic-notes-0000-0000-00000001',
    'seed-student-free-0000-0000-00000004',
    'Private draft: questions to ask the instructor next week.

1. How often should this be reviewed?
2. Which part comes first?',
    'private',
    1,
    NULL,
    NULL,
    NULL,
    datetime('now', '-1 days'),
    datetime('now', '-1 days')
  ),

  -- 3. MODERATED — shared, then force-unshared by the seeded admin.
  (
    'seed-note-moderated-0000-0000-000003',
    'seed-topic-notes-0000-0000-00000002',
    'seed-student-0000-0000-0000-0000-000000000002',
    'A note that was shared and then unshared by staff.

The body is unchanged by moderation; only its visibility was.',
    'private',
    3,
    datetime('now', '-5 days'),
    datetime('now', '-4 days'),
    'seed-admin-00000000-0000-0000-0000-000000000001',
    datetime('now', '-6 days'),
    datetime('now', '-4 days')
  );
