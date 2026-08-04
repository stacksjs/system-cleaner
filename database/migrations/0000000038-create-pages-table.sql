CREATE TABLE IF NOT EXISTS "pages" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "template" TEXT not null,
  "views" INTEGER default 0,
  "published_at" TEXT,
  "conversions" INTEGER default 0,
  "author_id" INTEGER REFERENCES "authors"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "pages_uuid_unique" ON "pages" ("uuid");
