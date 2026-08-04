CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT not null,
  "plan" TEXT,
  "provider_id" TEXT not null,
  "provider_status" TEXT not null,
  "unit_price" INTEGER not null,
  "provider_type" TEXT not null,
  "provider_price_id" TEXT,
  "quantity" INTEGER,
  "trial_ends_at" TEXT,
  "ends_at" TEXT,
  "last_used_at" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_id_unique" ON "subscriptions" ("provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_uuid_unique" ON "subscriptions" ("uuid");
