CREATE TABLE IF NOT EXISTS "failed_jobs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "connection" TEXT not null,
  "queue" TEXT not null,
  "payload" TEXT not null,
  "exception" TEXT not null,
  "attempts" INTEGER,
  "max_attempts" INTEGER,
  "duration_ms" INTEGER,
  "failed_at" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "failed_jobs_uuid_unique" ON "failed_jobs" ("uuid");
