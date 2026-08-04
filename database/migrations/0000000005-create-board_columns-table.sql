CREATE TABLE IF NOT EXISTS "board_columns" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "board_id" INTEGER not null REFERENCES "boards"("id"),
  "name" TEXT not null,
  "position" INTEGER,
  "card_limit" INTEGER,
  "color" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "board_columns_uuid_unique" ON "board_columns" ("uuid");
