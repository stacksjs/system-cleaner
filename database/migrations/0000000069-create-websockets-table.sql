CREATE TABLE IF NOT EXISTS "websockets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT CHECK ("type" IN ('disconnection', 'error', 'success')) not null,
  "socket" TEXT not null,
  "details" TEXT not null,
  "time" INTEGER not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
