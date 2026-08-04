CREATE TABLE IF NOT EXISTS "notifications" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT not null,
  "data" TEXT not null,
  "read_at" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_uuid_unique" ON "notifications" ("uuid");
