-- Normalized browser-side repro timeline captured by the SDK.
-- Complements raw console/network arrays with route changes, clicks, manual
-- screen markers, and request/log summaries in one chronological JSONB list.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS repro_timeline jsonb;

CREATE INDEX IF NOT EXISTS reports_repro_timeline_gin
  ON public.reports USING gin (repro_timeline)
  WHERE repro_timeline IS NOT NULL;
