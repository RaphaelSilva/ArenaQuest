CREATE TABLE IF NOT EXISTS quest_definitions (
    id               TEXT    NOT NULL PRIMARY KEY,
    kind             TEXT    NOT NULL, -- 'daily', 'weekly'
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL,
    predicate_kind   TEXT    NOT NULL,
    predicate_params TEXT    NOT NULL, -- JSON
    xp_reward        INTEGER NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quest_progress (
    user_id       TEXT    NOT NULL,
    quest_id      TEXT    NOT NULL,
    period_key    TEXT    NOT NULL, -- 'YYYY-MM-DD' or 'YYYY-Wnn'
    current_value INTEGER NOT NULL DEFAULT 0,
    target_value  INTEGER NOT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quest_id, period_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (quest_id) REFERENCES quest_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quest_progress_user_period ON quest_progress(user_id, period_key);
