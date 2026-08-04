CREATE TABLE IF NOT EXISTS "orders" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "status" TEXT not null,
  "total_amount" INTEGER not null,
  "currency" TEXT not null default 'USD',
  "tax_amount" INTEGER default 0,
  "discount_amount" INTEGER default 0,
  "delivery_fee" INTEGER default 0,
  "tip_amount" INTEGER default 0,
  "order_type" TEXT not null,
  "delivery_address" TEXT,
  "special_instructions" TEXT,
  "estimated_delivery_time" TEXT,
  "applied_coupon_id" TEXT,
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "coupon_id" INTEGER REFERENCES "coupons"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_uuid_unique" ON "orders" ("uuid");
