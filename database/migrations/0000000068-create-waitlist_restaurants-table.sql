CREATE TABLE IF NOT EXISTS "waitlist_restaurants" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "email" TEXT not null,
  "phone" TEXT,
  "party_size" INTEGER not null,
  "check_in_time" TEXT not null,
  "table_preference" TEXT CHECK ("table_preference" IN ('indoor', 'bar', 'booth', 'no_preference')) not null,
  "status" TEXT CHECK ("status" IN ('waiting', 'seated', 'cancelled', 'no_show')) not null default 'waiting',
  "quoted_wait_time" INTEGER not null,
  "actual_wait_time" INTEGER,
  "queue_position" INTEGER,
  "seated_at" TEXT,
  "no_show_at" TEXT,
  "cancelled_at" TEXT,
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_restaurants_uuid_unique" ON "waitlist_restaurants" ("uuid");
