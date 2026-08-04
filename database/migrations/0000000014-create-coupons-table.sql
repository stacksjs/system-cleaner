CREATE TABLE IF NOT EXISTS "coupons" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "code" TEXT not null,
  "description" TEXT,
  "status" TEXT CHECK ("status" IN ('Active', 'Scheduled', 'Expired')) not null default 'Active',
  "is_active" INTEGER not null default 1,
  "discount_type" TEXT CHECK ("discount_type" IN ('fixed_amount', 'percentage')) not null,
  "discount_value" INTEGER not null,
  "min_order_amount" INTEGER,
  "max_discount_amount" INTEGER,
  "free_product_id" TEXT,
  "usage_limit" INTEGER,
  "usage_count" INTEGER default 0,
  "start_date" TEXT,
  "end_date" TEXT,
  "product_id" INTEGER REFERENCES "products"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_unique" ON "coupons" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_uuid_unique" ON "coupons" ("uuid");
