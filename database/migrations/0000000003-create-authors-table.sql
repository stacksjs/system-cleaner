CREATE TABLE IF NOT EXISTS "authors" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "email" TEXT not null,
  "bio" TEXT,
  "avatar" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "authors_email_name_index" ON "authors" ("email", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "authors_email_unique" ON "authors" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "authors_uuid_unique" ON "authors" ("uuid");
