CREATE TABLE IF NOT EXISTS "reviews" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "rating" INTEGER not null,
  "title" TEXT,
  "content" TEXT,
  "is_verified_purchase" INTEGER default 0,
  "is_approved" INTEGER default 0,
  "is_featured" INTEGER default 0,
  "helpful_votes" INTEGER default 0,
  "unhelpful_votes" INTEGER default 0,
  "purchase_date" TEXT,
  "images" TEXT,
  "product_id" INTEGER REFERENCES "products"("id"),
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_uuid_unique" ON "reviews" ("uuid");
