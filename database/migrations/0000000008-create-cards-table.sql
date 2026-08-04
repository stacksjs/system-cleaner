CREATE TABLE IF NOT EXISTS "cards" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "column_id" INTEGER not null,
  "board_id" INTEGER not null REFERENCES "boards"("id"),
  "title" TEXT not null,
  "description" TEXT,
  "position" INTEGER,
  "created_by_user_id" INTEGER,
  "due_date" TEXT,
  "archived" INTEGER,
  "board_column_id" INTEGER REFERENCES "board_columns"("id"),
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "cards_uuid_unique" ON "cards" ("uuid");
