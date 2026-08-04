CREATE TABLE IF NOT EXISTS "tags" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "slug" TEXT not null,
  "description" TEXT,
  "color" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_unique" ON "tags" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "tags_slug_unique" ON "tags" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "tags_uuid_unique" ON "tags" ("uuid");
