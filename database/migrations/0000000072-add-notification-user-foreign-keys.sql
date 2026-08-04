PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE "_system_cleaner_notifications" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "read_at" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);

INSERT INTO "_system_cleaner_notifications" (
  "id", "type", "data", "read_at", "user_id", "created_at", "updated_at", "uuid"
)
SELECT "id", "type", "data", "read_at", "user_id", "created_at", "updated_at", "uuid"
FROM "notifications";

DROP TABLE "notifications";
ALTER TABLE "_system_cleaner_notifications" RENAME TO "notifications";
CREATE INDEX "idx_notifications_user" ON "notifications" ("user_id");
CREATE UNIQUE INDEX "notifications_uuid_unique" ON "notifications" ("uuid");

CREATE TABLE "_system_cleaner_notification_deliveries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "channel" TEXT CHECK ("channel" IN ('email', 'sms', 'chat', 'database', 'push', 'broadcast')) NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "status" TEXT CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed')) NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "metadata" TEXT,
  "sent_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT
);

INSERT INTO "_system_cleaner_notification_deliveries" (
  "id", "user_id", "channel", "recipient", "subject", "body", "status", "error", "metadata", "sent_at", "created_at", "updated_at"
)
SELECT "id", "user_id", "channel", "recipient", "subject", "body", "status", "error", "metadata", "sent_at", "created_at", "updated_at"
FROM "notification_deliveries";

DROP TABLE "notification_deliveries";
ALTER TABLE "_system_cleaner_notification_deliveries" RENAME TO "notification_deliveries";
CREATE INDEX "idx_notification_deliveries_channel" ON "notification_deliveries" ("channel");
CREATE INDEX "idx_notification_deliveries_status" ON "notification_deliveries" ("status");

COMMIT;

PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
