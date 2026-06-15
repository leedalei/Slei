CREATE TABLE IF NOT EXISTS message_deliveries (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'pending',
    run_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_agent_state
    ON message_deliveries(agent_id, delivery_state, sequence);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_message_id
    ON message_deliveries(message_id);

CREATE TABLE IF NOT EXISTS message_claims (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL,
    claim_scope TEXT NOT NULL DEFAULT 'reply',
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, claim_scope)
);

CREATE INDEX IF NOT EXISTS idx_message_claims_agent_id
    ON message_claims(agent_id, sequence);

CREATE TABLE IF NOT EXISTS task_claims (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_claims_agent_id
    ON task_claims(agent_id, sequence);

CREATE TABLE IF NOT EXISTS agent_statuses (
    agent_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    phase TEXT,
    reason TEXT,
    run_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    task_id TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_activity_logs (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    task_id TEXT,
    state TEXT NOT NULL,
    phase TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_logs_agent_sequence
    ON agent_activity_logs(agent_id, sequence DESC);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (3);
