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
--   1. **The topics are seeded here, not assumed, and they must be reachable
--      from the catalog UI.** No earlier seed creates a topic, and a note needs
--      one that passes the catalog gate: published, not archived and in the
--      reader's effective access set. Every topic here is
--      `visibility = 'public'`, and getEffectiveAccessTopicIds adds each
--      non-archived public node on its own (not only roots), so all three are
--      in every account's access set without an enrollment row and the seed
--      never touches `enrollments_*`. Two further constraints come from the
--      UI, not the API:
--        - ids are **UUID-format literals**, because GET /v1/topics/{id}
--          validates the path id as a UUID (a `seed-…` id answers 400);
--        - the note topics are **children** of a root "Notes Sandbox", because
--          the topic page mounts Discussion and the Notes panel only when
--          `parentId !== null`. The root is also where the catalog lists them.
--      The `…21a*` (topics) / `…21b*` (notes) suffixes tie the ids to M21.
--   2. **Two note topics, because of UNIQUE (topic_node_id, author_id).** Only
--      two student accounts are seeded, and each may hold one note per topic.
--      The first child carries the private and the shared note side by side,
--      so the privacy rule is falsifiable on one page: student2 wrote the
--      private note, and student@ must see the shared note but not that one.
--      The moderated note lives on the second child.
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
--   student@arenaquest.dev   → own shared note on "Study Notes" (flagged isMine),
--                              own moderated note on "Moderated Notes" (banner,
--                              switch off)
--   student2@arenaquest.dev  → own private note on "Study Notes", and student@'s
--                              shared note in Class notes
--   admin@ / professor@      → all three, private included, with badges and
--                              Unshare / Allow sharing again

-- ---------------------------------------------------------------------------
-- The topics.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_nodes
  (id, parent_id, title, content, status, sort_order, estimated_minutes, archived, visibility) VALUES
  -- The root. It holds no note itself: the Notes panel does not render on a
  -- root topic.
  (
    '00000000-0000-4000-8000-0000000021a0',
    NULL,
    'Notes Sandbox',
    '## Notes Sandbox

A local seed topic for trying the Notes panel. Open one of its two subtopics:
the panel appears on subtopics only.',
    'published',
    900,
    0,
    0,
    'public'
  ),
  (
    '00000000-0000-4000-8000-0000000021a1',
    '00000000-0000-4000-8000-0000000021a0',
    'Study Notes',
    '## Study Notes

This subtopic carries one **shared** note by student@arenaquest.dev and one
**private** note by student2@arenaquest.dev.

Log in as each of them, and as a staff account, to compare what each one sees.',
    'published',
    0,
    10,
    0,
    'public'
  ),
  (
    '00000000-0000-4000-8000-0000000021a2',
    '00000000-0000-4000-8000-0000000021a0',
    'Moderated Notes',
    '## Moderated Notes

This subtopic''s only note was shared and then unshared by staff. Its author
sees the moderation banner and cannot share it again until staff allow it.',
    'published',
    1,
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

  -- 1. SHARED — listed in Class notes for every reader of "Study Notes".
  (
    '00000000-0000-4000-8000-0000000021b1',
    '00000000-0000-4000-8000-0000000021a1',
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
    '00000000-0000-4000-8000-0000000021b2',
    '00000000-0000-4000-8000-0000000021a1',
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
    '00000000-0000-4000-8000-0000000021b3',
    '00000000-0000-4000-8000-0000000021a2',
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
