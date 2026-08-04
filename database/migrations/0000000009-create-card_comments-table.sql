CREATE TABLE IF NOT EXISTS "card_comments" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "card_id" INTEGER not null REFERENCES "cards"("id"),
  "user_id" INTEGER REFERENCES "users"("id"),
  "body" TEXT not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "card_comments_uuid_unique" ON "card_comments" ("uuid");
