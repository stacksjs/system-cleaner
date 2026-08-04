CREATE TABLE IF NOT EXISTS "drivers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "phone" TEXT not null,
  "vehicle_number" TEXT not null,
  "license" TEXT not null,
  "status" TEXT CHECK ("status" IN ('active', 'on_delivery', 'on_break')) default 'active',
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "drivers_uuid_unique" ON "drivers" ("uuid");
