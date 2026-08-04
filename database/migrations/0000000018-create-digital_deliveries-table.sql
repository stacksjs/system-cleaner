CREATE TABLE IF NOT EXISTS "digital_deliveries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT not null,
  "download_limit" INTEGER,
  "expiry_days" INTEGER not null,
  "requires_login" INTEGER default 0,
  "automatic_delivery" INTEGER default 0,
  "status" TEXT CHECK ("status" IN ('active', 'inactive')) default 'active',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "digital_deliveries_uuid_unique" ON "digital_deliveries" ("uuid");
