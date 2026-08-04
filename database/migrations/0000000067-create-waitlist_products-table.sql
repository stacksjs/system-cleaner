CREATE TABLE IF NOT EXISTS "waitlist_products" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "email" TEXT not null,
  "phone" TEXT,
  "quantity" INTEGER not null,
  "notification_preference" TEXT CHECK ("notification_preference" IN ('sms', 'email', 'both')) not null,
  "source" TEXT not null,
  "notes" TEXT,
  "status" TEXT CHECK ("status" IN ('waiting', 'purchased', 'notified', 'cancelled')) not null default 'waiting',
  "notified_at" TEXT,
  "purchased_at" TEXT,
  "cancelled_at" TEXT,
  "product_id" INTEGER REFERENCES "products"("id"),
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_products_uuid_unique" ON "waitlist_products" ("uuid");
