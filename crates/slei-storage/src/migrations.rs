pub const MIGRATION_0001: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    session_id TEXT,
    author_kind TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    root_message_id TEXT NOT NULL REFERENCES messages(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_channel_id ON tasks(channel_id);

CREATE TABLE IF NOT EXISTS thread_replies (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    author_message_id TEXT NOT NULL REFERENCES messages(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_thread_replies_task_id ON thread_replies(task_id);

CREATE TABLE IF NOT EXISTS runtime_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    runtime_kind TEXT NOT NULL,
    channel_id TEXT,
    task_id TEXT,
    token_ciphertext TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runtime_sessions_scope
    ON runtime_sessions(agent_id, channel_id, task_id);

CREATE TABLE IF NOT EXISTS event_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotent_mutations (
    idempotency_key TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    response_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_inbox_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    delivery_state TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_inbox_events_agent_id
    ON agent_inbox_events(agent_id);

CREATE TABLE IF NOT EXISTS memory_update_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_message_id TEXT,
    document_path TEXT,
    document_section TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_update_events_source_message_id
    ON memory_update_events(source_message_id);

CREATE INDEX IF NOT EXISTS idx_memory_update_events_agent_id
    ON memory_update_events(agent_id);

CREATE TABLE IF NOT EXISTS memory_document_states (
    agent_id TEXT NOT NULL,
    document_path TEXT NOT NULL,
    document_section TEXT NOT NULL DEFAULT '',
    version_hash TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(agent_id, document_path, document_section)
);

CREATE TABLE IF NOT EXISTS routing_context_packages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    decision_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    contains_deleted_body INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_context_packages_decision_id
    ON routing_context_packages(decision_id);

CREATE INDEX IF NOT EXISTS idx_routing_context_packages_source_message_id
    ON routing_context_packages(source_message_id);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
"#;

pub const MIGRATION_0002: &str = include_str!("../migrations/0002_app_state.sql");
pub const MIGRATION_0003: &str = include_str!("../migrations/0003_broadcast_claim.sql");
pub const MIGRATION_0004: &str = include_str!("../migrations/0004_task_source_uniqueness.sql");
pub const MIGRATION_0005: &str = include_str!("../migrations/0005_agent_activity_event_fields.sql");
pub const MIGRATION_0006: &str = include_str!("../migrations/0006_user_profile.sql");
pub const MIGRATION_0007: &str = include_str!("../migrations/0007_message_threads.sql");
pub const MIGRATION_0008: &str = include_str!("../migrations/0008_drop_legacy_coordinator.sql");
pub const MIGRATION_0009: &str = include_str!("../migrations/0009_agent_handle_lower_unique.sql");
pub const MIGRATION_0010: &str = include_str!("../migrations/0010_agent_message_todos.sql");
pub const MIGRATION_0011: &str = include_str!("../migrations/0011_agent_role_presets.sql");

pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_0001),
    (2, MIGRATION_0002),
    (3, MIGRATION_0003),
    (4, MIGRATION_0004),
    (5, MIGRATION_0005),
    (6, MIGRATION_0006),
    (7, MIGRATION_0007),
    (8, MIGRATION_0008),
    (9, MIGRATION_0009),
    (10, MIGRATION_0010),
    (11, MIGRATION_0011),
];
