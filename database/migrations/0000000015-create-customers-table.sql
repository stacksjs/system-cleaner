CREATE TABLE IF NOT EXISTS "customers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "email" TEXT not null,
  "phone" TEXT,
  "total_spent" INTEGER default 0,
  "last_order" TEXT,
  "status" TEXT CHECK ("status" IN ('Active', 'Inactive')) not null default 'Active',
  "avatar" TEXT not null,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_unique" ON "customers" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_uuid_unique" ON "customers" ("uuid");
