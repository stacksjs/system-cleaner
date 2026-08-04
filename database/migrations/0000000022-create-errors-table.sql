CREATE TABLE IF NOT EXISTS "errors" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT not null,
  "message" TEXT not null,
  "stack" TEXT,
  "status" INTEGER,
  "additional_info" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
CREATE INDEX IF NOT EXISTS "errors_created_at_index" ON "errors" ("created_at");
