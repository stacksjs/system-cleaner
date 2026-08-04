CREATE TABLE IF NOT EXISTS "products" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "price" INTEGER not null,
  "image_url" TEXT,
  "is_available" INTEGER,
  "inventory_count" INTEGER,
  "preparation_time" INTEGER not null,
  "allergens" TEXT,
  "nutritional_info" TEXT,
  "category_id" INTEGER REFERENCES "categories"("id"),
  "manufacturer_id" INTEGER REFERENCES "manufacturers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "products_uuid_unique" ON "products" ("uuid");
