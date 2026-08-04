CREATE TABLE IF NOT EXISTS "logs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "timestamp" INTEGER not null,
  "type" TEXT CHECK ("type" IN ('warning', 'error', 'info', 'success')) not null,
  "source" TEXT CHECK ("source" IN ('file', 'cli', 'system')) not null,
  "message" TEXT not null,
  "project" TEXT not null,
  "stacktrace" TEXT not null,
  "file" TEXT not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
CREATE INDEX IF NOT EXISTS "logs_timestamp_index" ON "logs" ("timestamp");
CREATE INDEX IF NOT EXISTS "logs_type_timestamp_index" ON "logs" ("type", "timestamp");
CREATE INDEX IF NOT EXISTS "logs_source_timestamp_index" ON "logs" ("source", "timestamp");
CREATE INDEX IF NOT EXISTS "logs_project_timestamp_index" ON "logs" ("project", "timestamp");
