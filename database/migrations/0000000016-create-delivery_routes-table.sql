CREATE TABLE IF NOT EXISTS "delivery_routes" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "driver" TEXT not null,
  "vehicle" TEXT not null,
  "stops" INTEGER not null,
  "delivery_time" INTEGER not null,
  "total_distance" INTEGER not null,
  "last_active" TEXT not null,
  "driver_id" INTEGER REFERENCES "drivers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_routes_uuid_unique" ON "delivery_routes" ("uuid");
