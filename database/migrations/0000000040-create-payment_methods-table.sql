CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT not null,
  "last_four" INTEGER not null,
  "brand" TEXT not null,
  "exp_month" INTEGER not null,
  "exp_year" INTEGER not null,
  "is_default" INTEGER,
  "provider_id" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_uuid_unique" ON "payment_methods" ("uuid");
