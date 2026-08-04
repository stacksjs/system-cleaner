CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "points_required" INTEGER not null,
  "reward_type" TEXT not null,
  "discount_percentage" INTEGER,
  "free_product_id" TEXT,
  "is_active" INTEGER,
  "expiry_days" INTEGER,
  "image_url" TEXT,
  "product_id" INTEGER REFERENCES "products"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_rewards_uuid_unique" ON "loyalty_rewards" ("uuid");
