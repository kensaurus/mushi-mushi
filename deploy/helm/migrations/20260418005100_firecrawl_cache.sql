-- Migration: 20260418005100_firecrawl_cache
-- Purpose:   Per-project response cache for Firecrawl calls so repeat
--            "what changed in react-query 5.x" / "stack overflow for
--            ENOTFOUND" lookups don't hit the API twice within a day.
--
--            Strict cost guardrail. Tied to V5.3 §2.18 cost-discipline
--            principle: every external paid API gets a cache layer.

CREATE TABLE IF NOT EXISTS firecrawl_cache (
  id          BIGSERIAL PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('search','scrape')),
  cache_key   TEXT NOT NULL, -- normalised query for search, full URL for scrape
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_firecrawl_cache_project_mode_key
  ON firecrawl_cache (project_id, mode, cache_key);

CREATE INDEX IF NOT EXISTS idx_firecrawl_cache_expires
  ON firecrawl_cache (expires_at);

ALTER TABLE firecrawl_cache ENABLE ROW LEVEL SECURITY;

-- Cache is server-side only — no end-user reads ever. service_role write/read,
-- everything else denied. We do NOT expose this to the admin JWT client; if we
-- ever surface "cached" badges in the UI they'll go through an API endpoint.
CREATE POLICY "service role only firecrawl cache"
  ON firecrawl_cache
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Cron: prune expired rows nightly so the table doesn't grow forever.
DO $$
BEGIN
  PERFORM cron.unschedule('mushi-firecrawl-cache-prune');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'mushi-firecrawl-cache-prune',
  '0 5 * * *',
  $$DELETE FROM public.firecrawl_cache WHERE expires_at < now();$$
);
