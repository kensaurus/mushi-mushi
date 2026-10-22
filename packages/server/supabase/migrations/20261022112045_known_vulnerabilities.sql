-- ============================================================================
-- known_vulnerabilities
--
-- Known-vulnerability findings are bugs (ADR 0038). The vuln-watch worker
-- reads each project's lockfiles and runtime pins at the default-branch head,
-- matches exact versions against OSV.dev, enriches them with CISA's
-- known-exploited list and EPSS, records the result as a `portfolio_radar_vulns`
-- gate run (radar rules known_vulnerable_dependency, runtime_end_of_life),
-- and files one report per (package, fixed version) per repo with
-- source = 'security_advisory', capped per app per day.
--
-- ADDITIVE: five tables, one project_settings column, appended
-- reports.source and gate_runs.gate values, one cron job. Apply BEFORE
-- deploying vuln-watch and api-ext; until then both answer "not set up".
--
-- Data rules: only package coordinates are stored (ecosystem, name, exact
-- version, dev flag), never a lockfile or a resolved URL. Advisory text is
-- public data from OSV, cached service-role only.
-- ============================================================================

-- ── vuln_advisories: OSV records Mushi has read (cache) ──────────────────────

CREATE TABLE IF NOT EXISTS public.vuln_advisories (
  id              text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
  -- OSV `modified`: the record is read again only when this changes.
  modified        text NOT NULL DEFAULT '',
  published       text,
  withdrawn       text,
  aliases         text[] NOT NULL DEFAULT '{}',
  cve_ids         text[] NOT NULL DEFAULT '{}',
  summary         text NOT NULL DEFAULT '',
  details_excerpt text NOT NULL DEFAULT '' CHECK (char_length(details_excerpt) <= 600),
  severity_label  text,
  cvss_vector     text,
  cvss_score      numeric(3,1) CHECK (cvss_score IS NULL OR cvss_score BETWEEN 0 AND 10),
  disputed        boolean NOT NULL DEFAULT false,
  url             text NOT NULL,
  -- [{ecosystem, name, ranges: [{type, events}]}] (no per-version lists).
  affected        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected) = 'array'),
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vuln_advisories IS
  'ADR 0038: OSV.dev advisory records read by vuln-watch, refetched only when OSV''s modified changes. Public data; service role only.';

-- ── vuln_cve_signals: CISA KEV and EPSS per CVE ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.vuln_cve_signals (
  cve_id           text PRIMARY KEY CHECK (cve_id ~ '^CVE-[0-9]{4}-[0-9]{4,}$'),
  kev_date_added   date,
  kev_due_date     date,
  kev_ransomware   text,
  epss             numeric(6,5) CHECK (epss IS NULL OR epss BETWEEN 0 AND 1),
  epss_percentile  numeric(6,5) CHECK (epss_percentile IS NULL OR epss_percentile BETWEEN 0 AND 1),
  epss_date        date,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vuln_cve_signals IS
  'ADR 0038: per CVE, whether CISA''s known-exploited list has it (kev_date_added) and its EPSS score. Refreshed by vuln-watch at most daily. Service role only.';

-- ── vuln_feed_state: when each shared feed was last read ─────────────────────

CREATE TABLE IF NOT EXISTS public.vuln_feed_state (
  feed        text PRIMARY KEY CHECK (feed IN ('cisa_kev')),
  version     text,
  entries     integer,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  error       text
);

-- ── runtime_advisories: holes in PHP / Node.js / Python / Go themselves ──────

CREATE TABLE IF NOT EXISTS public.runtime_advisories (
  id            text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  runtime       text NOT NULL CHECK (runtime IN ('php', 'node', 'python', 'go')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  cve_ids       text[] NOT NULL DEFAULT '{}',
  severity      text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  -- First fixed release of each supported line; an older line upgrades to the oldest.
  fixed_in      text[] NOT NULL CHECK (cardinality(fixed_in) BETWEEN 1 AND 20),
  mitigations   text[] NOT NULL DEFAULT '{}',
  summary       text NOT NULL DEFAULT '',
  advisory_url  text NOT NULL,
  published_on  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.runtime_advisories IS
  'ADR 0038: runtime security releases the package feeds may not carry yet, added by hand (no deploy needed). The same list is seeded in _shared/runtime-advisories.ts; a row here wins on the same id. Read by vuln-watch.';

INSERT INTO public.runtime_advisories (id, runtime, title, cve_ids, severity, fixed_in, mitigations, summary, advisory_url, published_on)
VALUES (
  'MUSHI-RT-2026-php2shell', 'php',
  'php2shell: unauthenticated remote code execution in PHP itself',
  ARRAY['CVE-2026-109618', 'CVE-2026-109619'], 'critical',
  ARRAY['8.2.35', '8.3.36', '8.4.27', '8.5.12'],
  ARRAY[
    'Set memory_limit=-1 where applications cannot override it (php_admin_value in the FPM pool or Apache config), and check nothing sets a finite limit again.',
    'Set a low post_max_size (8M without uploads, 32M with them) and keep upload_max_filesize below it.',
    'Set session.upload_progress.enabled=0 in php.ini or the FPM pool, not ini_set() or .user.ini, and restart every worker.',
    'On PHP 8.5, set fatal_error_backtraces=0 and restart every worker.'
  ],
  'Two bugs in the PHP engine let an attacker run code on the server with one unauthenticated web request (PHP-FPM, mod_php, php-cgi, FrankenPHP, LiteSpeed). mod_php is the worst case. PHP 8.1 and older get no official release; the PHP team published minimal source backports for 7.4, 8.0 and 8.1.',
  'https://www.php.net/', DATE '2026-10-21'
)
ON CONFLICT (id) DO NOTHING;

-- ── dependency_vulns: one row per (installed thing, advisory) ────────────────

CREATE TABLE IF NOT EXISTS public.dependency_vulns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id            uuid NOT NULL REFERENCES public.project_repos(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('package', 'runtime')),
  -- OSV ecosystem, or 'runtime' for a curated runtime_advisories row.
  ecosystem          text NOT NULL CHECK (char_length(ecosystem) BETWEEN 1 AND 40),
  package_name       text NOT NULL CHECK (char_length(package_name) BETWEEN 1 AND 300),
  installed_version  text NOT NULL CHECK (char_length(installed_version) BETWEEN 1 AND 100),
  dev                boolean NOT NULL DEFAULT false,
  direct             boolean NOT NULL DEFAULT false,
  -- The lockfile, or the file that pins the runtime.
  source_path        text NOT NULL CHECK (char_length(source_path) BETWEEN 1 AND 500),
  source_line        integer,
  advisory_id        text NOT NULL CHECK (char_length(advisory_id) BETWEEN 1 AND 200),
  cve_ids            text[] NOT NULL DEFAULT '{}',
  title              text NOT NULL DEFAULT '',
  advisory_url       text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  severity_reasons   text[] NOT NULL DEFAULT '{}',
  fixed_version      text,
  kev                boolean NOT NULL DEFAULT false,
  epss               numeric(6,5),
  imported           boolean,
  -- `${kind}|${ecosystem}|${name}|${target}`: the report group (one upgrade).
  group_key          text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'withdrawn', 'dismissed')),
  dismissed_reason   text CHECK (dismissed_reason IS NULL OR char_length(dismissed_reason) <= 500),
  dismissed_by       uuid,
  report_id          uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  commit_sha         text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  CONSTRAINT dependency_vulns_once UNIQUE (repo_id, source_path, ecosystem, package_name, installed_version, advisory_id)
);

COMMENT ON TABLE public.dependency_vulns IS
  'ADR 0038: an installed package or runtime version matched to a known advisory, per repo. Written by vuln-watch (service role); project members read. status: open, fixed (no longer installed), withdrawn (the advisory was withdrawn), dismissed (by a person; vuln-watch never reopens it).';

CREATE INDEX IF NOT EXISTS idx_dependency_vulns_project_open
  ON public.dependency_vulns (project_id, severity, last_seen_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_dependency_vulns_report
  ON public.dependency_vulns (report_id)
  WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dependency_vulns_group
  ON public.dependency_vulns (repo_id, group_key);

-- ── project_settings: reports a day ──────────────────────────────────────────

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS vuln_reports_daily_limit integer NOT NULL DEFAULT 10
    CHECK (vuln_reports_daily_limit BETWEEN 0 AND 100);

COMMENT ON COLUMN public.project_settings.vuln_reports_daily_limit IS
  'ADR 0038: security reports vuln-watch may file for this app per UTC day (default 10). 0 stops filing; findings still show on the radar and App health.';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.vuln_advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_cve_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_feed_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependency_vulns ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vuln_advisories', 'vuln_cve_signals', 'vuln_feed_state', 'runtime_advisories', 'dependency_vulns'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_write') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_write', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dependency_vulns' AND policyname = 'dependency_vulns_member_select') THEN
    CREATE POLICY dependency_vulns_member_select ON public.dependency_vulns FOR SELECT TO authenticated USING (
      project_id IN (SELECT id FROM public.projects WHERE owner_id = (SELECT auth.uid()))
      OR private.is_project_member(project_id)
    );
  END IF;
END $$;

GRANT SELECT ON TABLE public.dependency_vulns TO authenticated;

-- ── reports.source: append security_advisory ─────────────────────────────────

DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['security_advisory'];
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

COMMENT ON COLUMN public.reports.source IS
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review), ux_loop (a screen the mushi-ux loop flagged), library_modernizer (a dependency upgrade proposal), site_watch (a broken page on the live site), security_advisory (a known hole in a dependency or runtime, ADR 0038).';

-- ── gate_runs.gate: append portfolio_radar_vulns ─────────────────────────────

DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['portfolio_radar_vulns'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.gate_runs'::regclass
     AND conname = 'gate_runs_gate_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'gate_runs_gate_check not found; refusing to guess the allowed gates';
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of gate_runs_gate_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.gate_runs DROP CONSTRAINT gate_runs_gate_check';
  EXECUTE format(
    'ALTER TABLE public.gate_runs ADD CONSTRAINT gate_runs_gate_check CHECK (gate IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

COMMENT ON CONSTRAINT gate_runs_gate_check ON public.gate_runs IS
  'Allowlist of valid gate discriminators. portfolio_radar / portfolio_radar_ci / portfolio_radar_vulns / store_review '
  'are the app hole checks (ADR 0017, ADR 0038); radar is Mushi''s own setup checks (T1). '
  'Extend it by reading the current values (see 20261002140100), not by restating a list. '
  'Last extended: 2026-10-22.';

-- ── Cron: daily at 05:25 UTC, after radar-scan (04:05) ───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-vuln-watch schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-vuln-watch';

  PERFORM cron.schedule(
    'mushi-vuln-watch',
    '25 5 * * *',
    $cron$select mushi.cron_http_post('vuln-watch', jsonb_build_object('trigger', 'cron'));$cron$
  );
END $$;
