CREATE TABLE IF NOT EXISTS agent_message_todos (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL REFERENCES messages(id),
    message_author_id TEXT NOT NULL,
    message_created_at TEXT NOT NULL,
    claim_owner_agent_id TEXT NOT NULL,
    status TEXT NOT NULL,
    run_id TEXT,
    note TEXT,
    last_prompted_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_agent_channel_status
    ON agent_message_todos(agent_id, channel_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_channel_status
    ON agent_message_todos(channel_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_todos_run_id
    ON agent_message_todos(run_id);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (10);
