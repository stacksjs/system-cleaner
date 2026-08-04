CREATE TABLE IF NOT EXISTS "payments" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "amount" INTEGER not null,
  "method" TEXT CHECK ("method" IN ('cash', 'creditCard', 'debitCard', 'paypal', 'applePay', 'googlePay', 'bankTransfer', 'giftCard')) not null,
  "status" TEXT CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'partiallyRefunded', 'succeeded')) not null default 'pending',
  "currency" TEXT not null default 'USD',
  "reference_number" TEXT,
  "card_last_four" TEXT,
  "card_brand" TEXT,
  "billing_email" TEXT,
  "transaction_id" TEXT,
  "payment_provider" TEXT,
  "refund_amount" INTEGER default 0,
  "notes" TEXT,
  "order_id" INTEGER REFERENCES "orders"("id"),
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "payments_transaction_id_unique" ON "payments" ("transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_uuid_unique" ON "payments" ("uuid");
