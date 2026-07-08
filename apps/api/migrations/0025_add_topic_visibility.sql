-- Migration 0025: add visibility column to topic_nodes
-- Apply locally: wrangler d1 execute arenaquest-db --local --file ./migrations/0025_add_topic_visibility.sql

ALTER TABLE topic_nodes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'restricted' CHECK (visibility IN ('public', 'restricted', 'private'));

UPDATE topic_nodes SET visibility = 'restricted' WHERE visibility IS NULL;

CREATE INDEX IF NOT EXISTS idx_topic_nodes_visibility ON topic_nodes (visibility);
