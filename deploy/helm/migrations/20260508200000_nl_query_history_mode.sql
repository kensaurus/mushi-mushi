-- Add mode column to nl_query_history to distinguish NL (LLM-generated)
-- queries from raw SQL (user-typed) queries. Defaults to 'nl' so existing
-- rows don't need backfilling and the history sidebar continues to render.
ALTER TABLE nl_query_history
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'nl'
    CHECK (mode IN ('nl', 'raw'));

COMMENT ON COLUMN nl_query_history.mode IS
  'Query origin: nl = natural-language (LLM-generated SQL), raw = user-typed raw SQL.';
