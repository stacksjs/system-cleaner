CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "amount" INTEGER not null,
  "type" TEXT not null,
  "provider_id" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "payment_method_id" INTEGER REFERENCES "payment_methods"("id"),
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_uuid_unique" ON "payment_transactions" ("uuid");
