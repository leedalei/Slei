DELETE FROM thread_replies
WHERE task_id IN (
    SELECT id
    FROM tasks
    WHERE source_message_id IS NOT NULL
      AND rowid NOT IN (
          SELECT MIN(rowid)
          FROM tasks
          WHERE source_message_id IS NOT NULL
          GROUP BY source_message_id
      )
);

DELETE FROM tasks
WHERE source_message_id IS NOT NULL
  AND rowid NOT IN (
      SELECT MIN(rowid)
      FROM tasks
      WHERE source_message_id IS NOT NULL
      GROUP BY source_message_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_message_id_unique
    ON tasks(source_message_id)
    WHERE source_message_id IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (4);
