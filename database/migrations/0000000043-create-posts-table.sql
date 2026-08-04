CREATE TABLE IF NOT EXISTS "posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "poster" TEXT,
  "content" TEXT not null,
  "excerpt" TEXT,
  "focus_keyword" TEXT,
  "meta_description" TEXT,
  "canonical_url" TEXT,
  "views" INTEGER default 0,
  "published_at" TEXT,
  "status" TEXT CHECK ("status" IN ('published', 'draft', 'archived')) not null default 'draft',
  "is_featured" INTEGER,
  "author_id" INTEGER REFERENCES "authors"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "posts_uuid_unique" ON "posts" ("uuid");
