-- LOCAL DEVELOPMENT SEED — DO NOT RUN IN STAGING OR PRODUCTION
-- Gives the local replica a small tagged catalog so catalog search by title and
-- tags can be seen working on a fresh machine (RFC 0017, Milestone 24 Task 07).
-- Run via: make db-seed-local
--
-- Depends on migration 0005 (topic_nodes, tags, topic_node_tags) and migration
-- 0025 (topic_nodes.visibility).
--
-- Every statement is INSERT OR IGNORE, so re-seeding is a no-op. Only
-- topic_nodes, tags and topic_node_tags rows are written; there is no DDL and
-- no credential of any kind.
--
-- All topics are published + public + not archived: public nodes belong to every
-- student's effective-access set, so the seeded student sees the whole tree
-- without an enrollment row.
--
-- The tree covers every case in RFC 0017's Motivation table:
--   * "chudan" / "tsuki chudan"  -> "Chūdan Tsuki"   (accent-folded, any word order)
--   * "kata  basica"             -> "Kata Básica"    (accent + whitespace tolerant)
--   * "soco" / "#soco"           -> "Oi Zuki" only through its tag (no title match)
--   * "#faixa-amarela"           -> "9º Kyu" only through its tag

-- Id map (the API validates ids as UUIDs, so these are fixed, synthetic v4-shaped values):
--   24000000-0000-4000-8000-000000000001  topic  Karate Kihon
--   24000000-0000-4000-8000-000000000002  topic  Graduação
--   24000000-0000-4000-8000-000000000003  topic  Chūdan Tsuki
--   24000000-0000-4000-8000-000000000004  topic  Kata Básica
--   24000000-0000-4000-8000-000000000005  topic  Oi Zuki
--   24000000-0000-4000-8000-000000000006  topic  9º Kyu
--   24000000-0000-4000-8000-000000000101  tag    Soco
--   24000000-0000-4000-8000-000000000102  tag    Kihon
--   24000000-0000-4000-8000-000000000103  tag    Faixa Amarela
--
-- ---------------------------------------------------------------------------
-- Topics
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_nodes
  (id, parent_id, title, content, status, visibility, sort_order, estimated_minutes, archived)
VALUES
  ('24000000-0000-4000-8000-000000000001', NULL, 'Karate Kihon',
   'Basic techniques of karate.', 'published', 'public', 1, 60, 0),
  ('24000000-0000-4000-8000-000000000002', NULL, 'Graduação',
   'Belt requirements.', 'published', 'public', 2, 30, 0);

INSERT OR IGNORE INTO topic_nodes
  (id, parent_id, title, content, status, visibility, sort_order, estimated_minutes, archived)
VALUES
  ('24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000001', 'Chūdan Tsuki',
   'Middle-level thrust. Keep the hips square.', 'published', 'public', 1, 20, 0),
  ('24000000-0000-4000-8000-000000000004', '24000000-0000-4000-8000-000000000001', 'Kata Básica',
   'The first kata of the syllabus.', 'published', 'public', 2, 25, 0),
  ('24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-000000000001', 'Oi Zuki',
   'Stepping punch. Findable only through its tag.', 'published', 'public', 3, 15, 0),
  ('24000000-0000-4000-8000-000000000006', '24000000-0000-4000-8000-000000000002', '9º Kyu',
   'Requirements for the yellow belt.', 'published', 'public', 1, 30, 0);

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO tags (id, name, slug)
VALUES
  ('24000000-0000-4000-8000-000000000101', 'Soco', 'soco'),
  ('24000000-0000-4000-8000-000000000102', 'Kihon', 'kihon'),
  ('24000000-0000-4000-8000-000000000103', 'Faixa Amarela', 'faixa-amarela');

-- ---------------------------------------------------------------------------
-- Topic <-> tag links
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO topic_node_tags (topic_node_id, tag_id)
VALUES
  ('24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000102'),
  ('24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000101'),
  ('24000000-0000-4000-8000-000000000004', '24000000-0000-4000-8000-000000000102'),
  ('24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-000000000101'),
  ('24000000-0000-4000-8000-000000000006', '24000000-0000-4000-8000-000000000103');
