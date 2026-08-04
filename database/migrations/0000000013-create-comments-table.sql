CREATE TABLE IF NOT EXISTS "comments" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "author_name" TEXT not null,
  "author_email" TEXT not null,
  "content" TEXT not null,
  "body" TEXT,
  "post_title" TEXT,
  "status" TEXT CHECK ("status" IN ('pending', 'approved', 'spam', 'trash')) not null default 'pending',
  "ip_address" TEXT,
  "user_agent" TEXT,
  "is_approved" INTEGER default 0,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "comments_uuid_unique" ON "comments" ("uuid");
