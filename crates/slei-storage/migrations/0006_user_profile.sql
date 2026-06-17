CREATE TABLE IF NOT EXISTS user_profiles (
    profile_id TEXT PRIMARY KEY DEFAULT 'local',
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    avatar TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (6);
