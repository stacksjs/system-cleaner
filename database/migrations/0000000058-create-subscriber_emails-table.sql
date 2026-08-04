CREATE TABLE IF NOT EXISTS "subscriber_emails" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" TEXT not null,
  "source" TEXT default 'homepage',
  "subscriber_id" INTEGER REFERENCES "subscribers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_emails_uuid_unique" ON "subscriber_emails" ("uuid");
