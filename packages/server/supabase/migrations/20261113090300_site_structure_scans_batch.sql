-- Journey optimizer: run the site scan as a Firecrawl batch (ADR 0058).
--
-- Scraping 40 pages inside one edge request's background task did not fit:
-- on the first real scan (Solo Boss Cloud, 2026-11-13) pages took 11-15 s
-- each, many hit Firecrawl's 15 s timeout, and the isolate was shut down
-- before the scan finished. The scan now starts a Firecrawl batch scrape and
-- keeps its id; each read of the journeys page checks the batch and saves the
-- pages once Firecrawl has finished.

alter table public.site_structure_scans
  add column if not exists batch_id text check (char_length(batch_id) <= 200),
  add column if not exists pages_sent integer check (pages_sent >= 0),
  add column if not exists checked_at timestamptz;
