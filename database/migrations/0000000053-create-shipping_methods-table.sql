CREATE TABLE IF NOT EXISTS "shipping_methods" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "base_rate" INTEGER not null,
  "free_shipping" INTEGER,
  "status" TEXT CHECK ("status" IN ('active', 'inactive', 'draft')) not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_methods_uuid_unique" ON "shipping_methods" ("uuid");
