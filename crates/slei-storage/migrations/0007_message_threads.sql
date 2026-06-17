CREATE TABLE IF NOT EXISTS message_threads (
    id TEXT PRIMARY KEY,
    source_message_id TEXT NOT NULL UNIQUE,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_threads_source
    ON message_threads(source_kind, source_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_message_threads_source_message_id
    ON message_threads(source_message_id);

CREATE TABLE IF NOT EXISTS message_thread_replies (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT,
    run_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_thread_replies_thread_id
    ON message_thread_replies(thread_id, created_at, id);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (7);
