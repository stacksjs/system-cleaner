CREATE TABLE IF NOT EXISTS "subscribers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" TEXT not null,
  "status" TEXT CHECK ("status" IN ('subscribed', 'unsubscribed', 'pending', 'bounced')) not null default 'subscribed',
  "source" TEXT default 'homepage',
  "unsubscribed_at" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_email_unique" ON "subscribers" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_uuid_unique" ON "subscribers" ("uuid");
