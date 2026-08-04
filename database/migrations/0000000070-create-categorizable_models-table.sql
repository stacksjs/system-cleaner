CREATE TABLE IF NOT EXISTS "categorizable_models" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "category_id" INTEGER not null REFERENCES "categories"("id"),
  "categorizable_id" INTEGER not null,
  "categorizable_type" TEXT not null default 'posts',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "categorizable_models_category_id_categorizable_id_categ_166kkzm" ON "categorizable_models" ("category_id", "categorizable_id", "categorizable_type");
