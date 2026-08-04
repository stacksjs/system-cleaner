CREATE TABLE IF NOT EXISTS "manufacturers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "manufacturer" TEXT not null,
  "description" TEXT,
  "country" TEXT not null,
  "featured" INTEGER default 0,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturers_manufacturer_unique" ON "manufacturers" ("manufacturer");
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturers_uuid_unique" ON "manufacturers" ("uuid");
