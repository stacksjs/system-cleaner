CREATE TABLE IF NOT EXISTS "shipping_zones" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "countries" TEXT,
  "regions" TEXT,
  "postal_codes" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'inactive', 'draft')) not null,
  "shipping_method_id" INTEGER REFERENCES "shipping_methods"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_zones_uuid_unique" ON "shipping_zones" ("uuid");
