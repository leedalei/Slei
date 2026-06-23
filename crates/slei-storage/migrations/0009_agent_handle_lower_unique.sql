CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_handle_lower_unique
    ON agents(lower(handle));

INSERT OR IGNORE INTO schema_migrations(version) VALUES (9);
