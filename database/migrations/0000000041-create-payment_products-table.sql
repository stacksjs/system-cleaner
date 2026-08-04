CREATE TABLE IF NOT EXISTS "payment_products" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "key" TEXT not null,
  "unit_price" INTEGER not null,
  "status" TEXT,
  "image" TEXT,
  "provider_id" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_products_uuid_unique" ON "payment_products" ("uuid");
