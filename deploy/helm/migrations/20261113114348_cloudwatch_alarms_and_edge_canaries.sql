-- ============================================================================
-- 20261113114348_cloudwatch_alarms_and_edge_canaries (ADR 0061)
--
-- ADDITIVE: apply BEFORE deploying webhooks-cloudwatch and site-watch-poll.
--
-- 1. reports.source gains 'cloudwatch': CloudWatch alarms delivered by SNS to
--    webhooks-cloudwatch become reports.
-- 2. project_settings.cloudwatch_sns_topic_arn binds one SNS topic to one
--    project. The topic picks the project; nothing in the request does.
-- 3. cloudwatch_alarms: one row per (project, alarm): its last applied state
--    (out-of-order deliveries are dropped against state_changed_at) and the
--    report it files, so a flapping alarm dedupes onto one report.
-- 4. edge_canaries: no-redirect HTTP checks of a live site's edge (redirects,
--    missing-asset answers, app roots) run by site-watch-poll's hourly pass,
--    and their fail streak (ADR 0029: file on the second failing run).
--
-- No rows are inserted here: which topic and which URLs are an operator's
-- configuration, not schema.
--
-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check'; -- lists cloudwatch
--   select relrowsecurity from pg_class where relname in ('cloudwatch_alarms', 'edge_canaries');  -- t, t
--   select column_name from information_schema.columns
--    where table_name = 'project_settings' and column_name = 'cloudwatch_sns_topic_arn';
-- ============================================================================

-- ── reports.source += cloudwatch (appends to the live list, never restates it)
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['cloudwatch'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

-- ── project_settings.cloudwatch_sns_topic_arn ───────────────────────────────
-- Postgres regexes allow repetition counts up to 255 only, so the topic-name
-- length (1–256) is checked with char_length, not `{1,256}`.
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS cloudwatch_sns_topic_arn text
    CONSTRAINT project_settings_cloudwatch_sns_topic_arn_check
    CHECK (cloudwatch_sns_topic_arn IS NULL OR (cloudwatch_sns_topic_arn ~ '^arn:aws:sns:[a-z]{2}(-[a-z]+)+-[0-9]:[0-9]{12}:[A-Za-z0-9_-]+$' AND char_length(cloudwatch_sns_topic_arn) <= 300));

CREATE UNIQUE INDEX IF NOT EXISTS project_settings_cloudwatch_sns_topic_key
  ON public.project_settings (cloudwatch_sns_topic_arn)
  WHERE cloudwatch_sns_topic_arn IS NOT NULL;

COMMENT ON COLUMN public.project_settings.cloudwatch_sns_topic_arn IS
  'The SNS topic whose CloudWatch alarms webhooks-cloudwatch files into this project (ADR 0061). One project per topic. Null = none.';

-- ── cloudwatch_alarms ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cloudwatch_alarms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  alarm_key         text NOT NULL CHECK (char_length(alarm_key) BETWEEN 1 AND 500),
  alarm_name        text NOT NULL CHECK (char_length(alarm_name) BETWEEN 1 AND 255),
  alarm_arn         text CHECK (alarm_arn IS NULL OR char_length(alarm_arn) <= 500),
  state             text NOT NULL CHECK (state IN ('ALARM', 'OK', 'INSUFFICIENT_DATA')),
  state_changed_at  timestamptz,
  last_reason       text CHECK (last_reason IS NULL OR char_length(last_reason) <= 1000),
  last_message_id   text CHECK (last_message_id IS NULL OR char_length(last_message_id) <= 200),
  report_id         uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  alarm_count       integer NOT NULL DEFAULT 0 CHECK (alarm_count >= 0),
  ok_count          integer NOT NULL DEFAULT 0 CHECK (ok_count >= 0),
  last_alarm_at     timestamptz,
  last_ok_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, alarm_key)
);

CREATE INDEX IF NOT EXISTS idx_cloudwatch_alarms_report ON public.cloudwatch_alarms (report_id) WHERE report_id IS NOT NULL;

COMMENT ON TABLE public.cloudwatch_alarms IS
  'One row per CloudWatch alarm per project (ADR 0061): last applied state (older deliveries dropped by state_changed_at) and the report it filed. ALARM with an open report dedupes; ALARM after the report closed reopens it; OK annotates it.';

ALTER TABLE public.cloudwatch_alarms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cloudwatch_alarms_member_select ON public.cloudwatch_alarms;
CREATE POLICY cloudwatch_alarms_member_select ON public.cloudwatch_alarms
  FOR SELECT TO authenticated USING ((SELECT private.is_project_member(project_id)));
DROP POLICY IF EXISTS cloudwatch_alarms_service_write ON public.cloudwatch_alarms;
CREATE POLICY cloudwatch_alarms_service_write ON public.cloudwatch_alarms
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.cloudwatch_alarms FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cloudwatch_alarms FROM authenticated;

-- ── edge_canaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edge_canaries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label            text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  url              text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2000),
  expect_status    integer[] NOT NULL CHECK (cardinality(expect_status) BETWEEN 1 AND 5),
  expect_location  text CHECK (expect_location IS NULL OR char_length(expect_location) <= 2000),
  enabled          boolean NOT NULL DEFAULT true,
  fail_streak      integer NOT NULL DEFAULT 0 CHECK (fail_streak >= 0),
  failing_since    timestamptz,
  last_status      integer,
  last_location    text,
  last_detail      text CHECK (last_detail IS NULL OR char_length(last_detail) <= 500),
  last_checked_at  timestamptz,
  report_id        uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_edge_canaries_enabled ON public.edge_canaries (project_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_edge_canaries_report ON public.edge_canaries (report_id) WHERE report_id IS NOT NULL;

COMMENT ON TABLE public.edge_canaries IS
  'No-redirect HTTP checks of a live site''s edge (ADR 0061), run by site-watch-poll hourly: pass when the status is in expect_status and, when set, Location equals expect_location (resolved against url). Files a site_watch report on the second failing run in a row.';

ALTER TABLE public.edge_canaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edge_canaries_member_select ON public.edge_canaries;
CREATE POLICY edge_canaries_member_select ON public.edge_canaries
  FOR SELECT TO authenticated USING ((SELECT private.is_project_member(project_id)));
DROP POLICY IF EXISTS edge_canaries_service_write ON public.edge_canaries;
CREATE POLICY edge_canaries_service_write ON public.edge_canaries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.edge_canaries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.edge_canaries FROM authenticated;
