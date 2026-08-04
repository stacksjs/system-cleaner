CREATE TABLE IF NOT EXISTS "teams" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "member_count" INTEGER default 0,
  "status" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "teams_name_unique" ON "teams" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "teams_uuid_unique" ON "teams" ("uuid");
