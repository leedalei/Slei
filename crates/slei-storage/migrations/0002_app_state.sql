CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    agent_kind TEXT NOT NULL DEFAULT 'agent',
    system_owned INTEGER NOT NULL DEFAULT 0,
    runtime_kind TEXT NOT NULL,
    model TEXT NOT NULL,
    node_id TEXT NOT NULL,
    description TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    memory_path TEXT NOT NULL,
    docs_path TEXT NOT NULL,
    avatar_seed TEXT NOT NULL,
    runtime_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    permission TEXT NOT NULL DEFAULT 'Controlled',
    active_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_sessions (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channel_sessions_channel_id
    ON channel_sessions(channel_id);

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    readiness TEXT NOT NULL DEFAULT 'joining',
    PRIMARY KEY(channel_id, agent_id)
);

CREATE TABLE IF NOT EXISTS channel_workspace_mounts (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(channel_id, path)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_workspace_mounts_path
    ON channel_workspace_mounts(path);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    agent_id TEXT,
    active_session_id TEXT,
    runtime_status TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    runtime_session_payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_attachments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT,
    cache_path TEXT,
    bytes_base64 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_id TEXT,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT,
    run_id TEXT,
    attachment_ids TEXT NOT NULL DEFAULT '[]',
    cards_payload TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id
    ON conversation_messages(conversation_id);

CREATE TABLE IF NOT EXISTS saved_messages (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    session_id TEXT,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id)
);

CREATE TABLE IF NOT EXISTS interactive_cards (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    action_payload TEXT NOT NULL,
    template_payload TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interactive_cards_run_id
    ON interactive_cards(run_id);

CREATE INDEX IF NOT EXISTS idx_interactive_cards_conversation_id
    ON interactive_cards(conversation_id);

CREATE TABLE IF NOT EXISTS user_preferences (
    profile_id TEXT PRIMARY KEY DEFAULT 'local',
    locale TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    theme TEXT NOT NULL,
    font_size TEXT NOT NULL,
    notify_mentions INTEGER NOT NULL,
    notify_human_replies INTEGER NOT NULL,
    notify_approvals INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT,
    arch TEXT,
    hostname TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    daemon_version TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
