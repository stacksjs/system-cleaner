CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "channel" TEXT CHECK ("channel" IN ('email', 'sms', 'chat', 'database', 'push', 'broadcast')) not null,
  "recipient" TEXT not null,
  "subject" TEXT,
  "body" TEXT not null,
  "status" TEXT CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed')) not null default 'pending',
  "error" TEXT,
  "metadata" TEXT,
  "sent_at" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
