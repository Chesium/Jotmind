-- Enable the extensions JotMind relies on. This runs once when the PostgreSQL
-- data volume is first initialized (docker-entrypoint-initdb.d).
-- Migrations also create these idempotently, so existing volumes stay valid.
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS vector;
