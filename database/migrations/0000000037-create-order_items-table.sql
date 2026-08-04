CREATE TABLE IF NOT EXISTS "order_items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity" INTEGER not null default 1,
  "price" INTEGER not null,
  "special_instructions" TEXT,
  "order_id" INTEGER REFERENCES "orders"("id"),
  "product_id" INTEGER REFERENCES "products"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
