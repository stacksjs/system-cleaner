CREATE TABLE IF NOT EXISTS "cart_items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity" INTEGER not null,
  "unit_price" INTEGER not null,
  "total_price" INTEGER not null,
  "tax_rate" INTEGER,
  "tax_amount" INTEGER,
  "discount_percentage" INTEGER,
  "discount_amount" INTEGER,
  "product_name" TEXT not null,
  "product_sku" TEXT,
  "product_image" TEXT,
  "notes" TEXT,
  "cart_id" INTEGER REFERENCES "carts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_uuid_unique" ON "cart_items" ("uuid");
