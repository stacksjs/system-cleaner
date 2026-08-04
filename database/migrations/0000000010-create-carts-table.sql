CREATE TABLE IF NOT EXISTS "carts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "status" TEXT CHECK ("status" IN ('active', 'abandoned', 'converted', 'expired')) default 'active',
  "total_items" INTEGER default 0,
  "subtotal" INTEGER default 0,
  "tax_amount" INTEGER default 0,
  "discount_amount" INTEGER default 0,
  "total" INTEGER default 0,
  "expires_at" TEXT not null,
  "currency" TEXT default 'USD',
  "notes" TEXT,
  "applied_coupon_id" TEXT not null,
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "coupon_id" INTEGER REFERENCES "coupons"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "carts_uuid_unique" ON "carts" ("uuid");
