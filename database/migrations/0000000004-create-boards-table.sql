CREATE TABLE IF NOT EXISTS "boards" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "icon" TEXT,
  "color" TEXT,
  "position" INTEGER,
  "archived" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "boards_uuid_unique" ON "boards" ("uuid");
