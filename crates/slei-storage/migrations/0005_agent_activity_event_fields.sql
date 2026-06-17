ALTER TABLE agent_activity_logs
    ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'status.updated';

ALTER TABLE agent_activity_logs
    ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';

ALTER TABLE agent_activity_logs
    ADD COLUMN summary TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_activity_logs
    ADD COLUMN payload_preview TEXT;

ALTER TABLE agent_activity_logs
    ADD COLUMN tool_name TEXT;

ALTER TABLE agent_activity_logs
    ADD COLUMN ok INTEGER;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (5);
