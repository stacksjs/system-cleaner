CREATE TABLE IF NOT EXISTS "categories" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "slug" TEXT not null,
  "image_url" TEXT,
  "is_active" INTEGER,
  "parent_category_id" TEXT,
  "display_order" INTEGER not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "categories_uuid_unique" ON "categories" ("uuid");
