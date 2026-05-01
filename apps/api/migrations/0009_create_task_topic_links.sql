-- Migration 0009: task ↔ topic and stage ↔ topic junction tables
-- Two tables, both with ON DELETE CASCADE on the task/stage side and
-- ON DELETE RESTRICT on the topic side — deleting a topic that is still
-- linked must fail loudly so admins explicitly detach first.

CREATE TABLE IF NOT EXISTS task_topic_links (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE RESTRICT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, topic_node_id)
);

CREATE INDEX IF NOT EXISTS idx_task_topic_links_topic ON task_topic_links(topic_node_id);

CREATE TABLE IF NOT EXISTS task_stage_topic_links (
  stage_id      TEXT NOT NULL REFERENCES task_stages(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE RESTRICT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (stage_id, topic_node_id)
);

CREATE INDEX IF NOT EXISTS idx_task_stage_topic_links_topic ON task_stage_topic_links(topic_node_id);
