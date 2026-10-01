-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica one example of every state the student submissions
-- ("Demonstrations") UI renders: a private, a shared, a moderated and a removed
-- (tombstone) submission (RFC 0020, Milestone 23 Task 10).
-- Run via: make db-seed-local
--
-- Depends on 0001_test_users.sql (admin, student) and on migration 0030 for
-- `topic_submissions`. The production/staging deploy guard
-- (scripts/check-no-dev-seed.ts) rejects any database holding these rows
-- indirectly: every row references a `seed-` account (author_id is
-- ON DELETE CASCADE), so a database carrying them also carries the seed users
-- the guard matches.
--
-- Every statement is INSERT OR IGNORE on a fixed id, so re-seeding is a no-op.
--
-- Properties of this file that should survive edits:
--
--   1. **The topics are seeded here and pass the catalog gate.** They are
--      published, not archived and `visibility = 'public'`, so every account's
--      effective access set holds them without an enrollment row. Ids are
--      UUID-format literals because the topic routes validate the path id as a
--      UUID. The `…23a*` (topics) / `…23b*` (submissions) suffixes tie them to
--      M23. "Kata Demonstrations" stays empty on purpose: it is the target for
--      trying "Move to another topic".
--   2. **Every row belongs to student@arenaquest.dev**, so one login shows all
--      four states on "Kihon Demonstrations" (Mine tab) and on
--      /submissions (My demonstrations). The shared row also appears in the
--      Class tab for student2@ / tutor accounts, and staff see every row in
--      the All tab and in the user backoffice.
--   3. **Each row is a state the API can produce.**
--        - PRIVATE / SHARED: status `ready`, shared_at stamped only when shared.
--        - MODERATED: shared, then force-unshared by the seeded admin —
--          visibility `private`, shared_at kept, moderated_at / moderated_by set.
--        - REMOVED: the admin tombstone — status `removed`, storage_key NULL
--          (the object is gone), removed_at / removed_by set. It is outside
--          every quota and visible only to its author and to staff.
--   4. **The three ready rows point at real local objects.** `make
--      db-seed-local` uploads apps/api/test/fixtures/submissions/sample.mp4
--      (1958 bytes, a valid `ftyp` MP4) to the local R2 bucket under each
--      storage_key below; size_bytes matches it. Keep the keys and sizes in
--      sync with the Makefile.
--
-- Dates are relative (`datetime('now', ...)`) so "newest first" orderings stay
-- meaningful whenever the replica is reset. Author names are joined from
-- `users`, so no name is repeated here.

-- ---------------------------------------------------------------------------
-- The topics.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_nodes
  (id, parent_id, title, content, status, sort_order, estimated_minutes, archived, visibility) VALUES
  (
    '00000000-0000-4000-8000-0000000023a0',
    NULL,
    'Demonstrations Sandbox',
    '## Demonstrations Sandbox

A local seed topic for trying student submissions. Open "Kihon Demonstrations"
and press **Demonstrations**.',
    'published',
    910,
    0,
    0,
    'public'
  ),
  (
    '00000000-0000-4000-8000-0000000023a1',
    '00000000-0000-4000-8000-0000000023a0',
    'Kihon Demonstrations',
    '## Kihon Demonstrations

student@arenaquest.dev has one **private**, one **shared**, one **moderated**
and one **removed** demonstration here.',
    'published',
    0,
    10,
    0,
    'public'
  ),
  (
    '00000000-0000-4000-8000-0000000023a2',
    '00000000-0000-4000-8000-0000000023a0',
    'Kata Demonstrations',
    '## Kata Demonstrations

Empty on purpose: move a demonstration here to try the move dialog.',
    'published',
    1,
    10,
    0,
    'public'
  );

-- ---------------------------------------------------------------------------
-- The submissions.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_submissions
  (id, topic_node_id, author_id, title, description, storage_key, original_name,
   content_type, size_bytes, status, visibility, shared_at, moderated_at,
   moderated_by, removed_at, removed_by, created_at, updated_at) VALUES

  -- 1. PRIVATE — readable by its author and by staff only.
  (
    '00000000-0000-4000-8000-0000000023b1',
    '00000000-0000-4000-8000-0000000023a1',
    'seed-student-0000-0000-0000-0000-000000000002',
    'Mae geri — first attempt',
    'Still working on the chamber. Not ready to share yet.',
    'submissions/seed-student-0000-0000-0000-0000-000000000002/00000000-0000-4000-8000-0000000023b1-mae-geri.mp4',
    'mae-geri.mp4',
    'video/mp4',
    1958,
    'ready',
    'private',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    datetime('now', '-1 days'),
    datetime('now', '-1 days')
  ),

  -- 2. SHARED — listed in the Class tab for every reader of the topic.
  (
    '00000000-0000-4000-8000-0000000023b2',
    '00000000-0000-4000-8000-0000000023a1',
    'seed-student-0000-0000-0000-0000-000000000002',
    'Oi tsuki in sequence',
    'Ten repetitions, **left and right**. Feedback welcome.',
    'submissions/seed-student-0000-0000-0000-0000-000000000002/00000000-0000-4000-8000-0000000023b2-oi-tsuki.mp4',
    'oi-tsuki.mp4',
    'video/mp4',
    1958,
    'ready',
    'shared',
    datetime('now', '-2 days'),
    NULL,
    NULL,
    NULL,
    NULL,
    datetime('now', '-3 days'),
    datetime('now', '-2 days')
  ),

  -- 3. MODERATED — shared, then force-unshared by the seeded admin.
  (
    '00000000-0000-4000-8000-0000000023b3',
    '00000000-0000-4000-8000-0000000023a1',
    'seed-student-0000-0000-0000-0000-000000000002',
    'Age uke drill',
    'Was shared, then unshared by staff. The author sees the moderation banner.',
    'submissions/seed-student-0000-0000-0000-0000-000000000002/00000000-0000-4000-8000-0000000023b3-age-uke.mp4',
    'age-uke.mp4',
    'video/mp4',
    1958,
    'ready',
    'private',
    datetime('now', '-5 days'),
    datetime('now', '-4 days'),
    'seed-admin-00000000-0000-0000-0000-000000000001',
    NULL,
    NULL,
    datetime('now', '-6 days'),
    datetime('now', '-4 days')
  ),

  -- 4. REMOVED — the admin tombstone: object deleted, storage_key NULL.
  (
    '00000000-0000-4000-8000-0000000023b4',
    '00000000-0000-4000-8000-0000000023a1',
    'seed-student-0000-0000-0000-0000-000000000002',
    'Off-topic clip',
    'Removed by the staff; only its author and staff still see this card.',
    NULL,
    'off-topic.mp4',
    'video/mp4',
    1958,
    'removed',
    'private',
    NULL,
    NULL,
    NULL,
    datetime('now', '-7 days'),
    'seed-admin-00000000-0000-0000-0000-000000000001',
    datetime('now', '-8 days'),
    datetime('now', '-7 days')
  );
