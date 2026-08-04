CREATE TABLE IF NOT EXISTS "print_devices" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "mac_address" TEXT not null,
  "location" TEXT not null,
  "terminal" TEXT not null,
  "status" TEXT CHECK ("status" IN ('online', 'offline', 'warning')) not null,
  "last_ping" INTEGER default 0,
  "print_count" INTEGER default 0,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "print_devices_uuid_unique" ON "print_devices" ("uuid");
