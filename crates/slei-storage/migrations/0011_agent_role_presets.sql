CREATE TABLE IF NOT EXISTS agent_role_presets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_role_presets_enabled_sort
    ON agent_role_presets(enabled, sort_order, title);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (11);
