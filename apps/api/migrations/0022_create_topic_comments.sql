CREATE TABLE IF NOT EXISTS topic_comments (
  id TEXT PRIMARY KEY,
  topic_node_id TEXT NOT NULL,
  parent_comment_id TEXT,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (topic_node_id) REFERENCES topic_nodes(id),
  FOREIGN KEY (parent_comment_id) REFERENCES topic_comments(id)
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  liked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id),
  FOREIGN KEY (comment_id) REFERENCES topic_comments(id)
);
