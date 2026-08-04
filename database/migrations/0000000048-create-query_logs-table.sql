CREATE TABLE IF NOT EXISTS "query_logs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "query" TEXT not null,
  "normalized_query" TEXT,
  "duration" INTEGER default 0,
  "connection" TEXT default 'unknown',
  "status" TEXT CHECK ("status" IN ('completed', 'failed', 'slow')) default 'completed',
  "error" TEXT,
  "executed_at" TEXT not null,
  "bindings" TEXT,
  "trace" TEXT,
  "model" TEXT,
  "method" TEXT,
  "file" TEXT,
  "line" INTEGER,
  "memory_usage" INTEGER,
  "rows_affected" INTEGER,
  "transaction_id" TEXT,
  "tags" TEXT,
  "affected_tables" TEXT,
  "indexes_used" TEXT,
  "missing_indexes" TEXT,
  "explain_plan" TEXT,
  "optimization_suggestions" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
CREATE INDEX IF NOT EXISTS "query_logs_executed_at_index" ON "query_logs" ("executed_at");
CREATE INDEX IF NOT EXISTS "query_logs_status_index" ON "query_logs" ("status");
CREATE INDEX IF NOT EXISTS "query_logs_duration_index" ON "query_logs" ("duration");
