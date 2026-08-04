CREATE TABLE IF NOT EXISTS "taggable_models" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "taggable_id" INTEGER not null,
  "tag_id" INTEGER not null REFERENCES "tags"("id"),
  "taggable_type" TEXT not null default 'posts',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "taggable_models_tag_id_taggable_id_taggable_type_unique" ON "taggable_models" ("tag_id", "taggable_id", "taggable_type");
