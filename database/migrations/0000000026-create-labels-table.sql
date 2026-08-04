CREATE TABLE IF NOT EXISTS "labels" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "board_id" INTEGER not null REFERENCES "boards"("id"),
  "name" TEXT not null,
  "color" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "labels_uuid_unique" ON "labels" ("uuid");
