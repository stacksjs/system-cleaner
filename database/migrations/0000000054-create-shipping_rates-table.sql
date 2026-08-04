CREATE TABLE IF NOT EXISTS "shipping_rates" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "weight_from" REAL not null,
  "weight_to" REAL not null,
  "rate" INTEGER not null,
  "shipping_method_id" INTEGER REFERENCES "shipping_methods"("id"),
  "shipping_zone_id" INTEGER REFERENCES "shipping_zones"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_rates_uuid_unique" ON "shipping_rates" ("uuid");
