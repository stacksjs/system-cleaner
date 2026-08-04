CREATE TABLE IF NOT EXISTS "product_units" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "abbreviation" TEXT not null,
  "type" TEXT not null,
  "description" TEXT,
  "is_default" INTEGER default 0,
  "product_id" INTEGER REFERENCES "products"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_units_uuid_unique" ON "product_units" ("uuid");
