DROP TABLE IF EXISTS channel_coordinators;
DROP TABLE IF EXISTS coordinator_decisions;
DROP TABLE IF EXISTS coordinator_runtime_runs;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (8);
