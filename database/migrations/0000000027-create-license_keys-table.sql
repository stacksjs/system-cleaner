CREATE TABLE IF NOT EXISTS "license_keys" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "key" TEXT not null,
  "template" TEXT CHECK ("template" IN ('Standard License', 'Premium License', 'Enterprise License')) not null,
  "expiry_date" TEXT not null,
  "status" TEXT CHECK ("status" IN ('active', 'inactive', 'unassigned')) default 'unassigned',
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "product_id" INTEGER REFERENCES "products"("id"),
  "order_id" INTEGER REFERENCES "orders"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "license_keys_key_unique" ON "license_keys" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "license_keys_uuid_unique" ON "license_keys" ("uuid");
