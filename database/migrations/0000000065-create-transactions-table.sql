CREATE TABLE IF NOT EXISTS "transactions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "amount" INTEGER not null,
  "status" TEXT not null,
  "payment_method" TEXT not null,
  "payment_details" TEXT,
  "transaction_reference" TEXT,
  "loyalty_points_earned" INTEGER,
  "loyalty_points_redeemed" INTEGER,
  "order_id" INTEGER REFERENCES "orders"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_uuid_unique" ON "transactions" ("uuid");
