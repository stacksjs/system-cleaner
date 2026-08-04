CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "variant" TEXT not null,
  "type" TEXT not null,
  "description" TEXT,
  "options" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'inactive', 'draft')) not null,
  "product_id" INTEGER REFERENCES "products"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_uuid_unique" ON "product_variants" ("uuid");
