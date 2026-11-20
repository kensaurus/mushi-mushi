-- =============================================================================
-- ADR 0063: code-audit findings get a root-cause identity, a backlog cap and
-- an honest lifecycle.
--
-- 2026-11-21: 550 open code_audit reports from one sweep, about 312 of them
-- the same handful of problems filed once per screen, 208 with a fix PR and
-- none merged. The old dedupe key (file + free-text rule + hash of one line)
-- made every screen a new report.
--
--   reports.pattern_key        category + root file (worker/audit-patterns.ts):
--                              one open code_audit report per (app, key)
--   reports.affected_screens   the screens where the parent's pattern was seen
--   code_audit_keys.pattern_key + merged   an exact replay still dedupes; a
--                              key that only added a screen to an open parent
--                              does not count toward the hourly cap
--   code_audit_deferred        findings over the app's open cap wait here,
--                              outside every open count, until a slot frees
--   project_settings.code_audit_open_cap   default 25
--   work_lanes.audit_rechecked_at   the audit lane's last recheck sweep
--
-- No status is added: a duplicate child is dismissed/duplicate with
-- parent_report_id, a regression reopens the old parent ('reopened'), a
-- rejected fix leaves the report 'triaged' (the local fix lane only claims
-- classified and reopened). Additive and idempotent.
-- =============================================================================

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS pattern_key text
    CHECK (pattern_key IS NULL OR char_length(pattern_key) BETWEEN 1 AND 400),
  ADD COLUMN IF NOT EXISTS affected_screens jsonb
    CHECK (affected_screens IS NULL OR jsonb_typeof(affected_screens) = 'array');

COMMENT ON COLUMN public.reports.pattern_key IS
  'ADR 0063: a code-audit finding''s root-cause identity, category + root file (the shared component or route kind one fix lands in). One open code_audit report per app and key; new occurrences go to affected_screens. NULL for every other source and for findings filed before 2026-11-21.';
COMMENT ON COLUMN public.reports.affected_screens IS
  'ADR 0063: the screens where this report''s pattern was seen, [{screen, file, line, title, at}], newest last, at most 50.';

-- One open parent per pattern; the race between two workers is settled here.
CREATE UNIQUE INDEX IF NOT EXISTS reports_code_audit_open_pattern_uniq
  ON public.reports (project_id, pattern_key)
  WHERE source = 'code_audit'
    AND pattern_key IS NOT NULL
    AND parent_report_id IS NULL
    AND status IN ('new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress');

-- The newest fixed parent of a pattern, for a regression.
CREATE INDEX IF NOT EXISTS idx_reports_code_audit_pattern
  ON public.reports (project_id, pattern_key, created_at DESC)
  WHERE source = 'code_audit' AND pattern_key IS NOT NULL;

ALTER TABLE public.code_audit_keys
  ADD COLUMN IF NOT EXISTS pattern_key text
    CHECK (pattern_key IS NULL OR char_length(pattern_key) BETWEEN 1 AND 400),
  ADD COLUMN IF NOT EXISTS merged boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.code_audit_keys.merged IS
  'ADR 0063: true when this key only added a screen to an open pattern parent (report_id is that parent). The hourly audit cap counts only keys that filed a report.';

CREATE TABLE IF NOT EXISTS public.code_audit_deferred (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pattern_key  text NOT NULL CHECK (char_length(pattern_key) BETWEEN 1 AND 400),
  audit_key    text NOT NULL CHECK (char_length(audit_key) BETWEEN 1 AND 500),
  -- The finding as the worker sent it (parseAuditFinding), re-filed when a slot frees.
  finding      jsonb NOT NULL CHECK (jsonb_typeof(finding) = 'object'),
  -- severity × confidence (auditFindingScore): the best waits least.
  score        real NOT NULL CHECK (score >= 0),
  lane_id      uuid REFERENCES public.work_lanes(id) ON DELETE SET NULL,
  seen_count   integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  deferred_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_audit_deferred_project_pattern_unique UNIQUE (project_id, pattern_key)
);

COMMENT ON TABLE public.code_audit_deferred IS
  'ADR 0063: reproduced code-audit findings over the app''s open cap (project_settings.code_audit_open_cap). Not a report, so outside every open count. The audit lane''s daily recheck re-files the best of them, after checking them again on the default branch, when a slot frees. Service role only.';

CREATE INDEX IF NOT EXISTS idx_code_audit_deferred_project_score
  ON public.code_audit_deferred (project_id, score DESC, deferred_at ASC);

ALTER TABLE public.code_audit_deferred ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS code_audit_deferred_service_all ON public.code_audit_deferred;
CREATE POLICY code_audit_deferred_service_all ON public.code_audit_deferred
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.code_audit_deferred FROM anon, authenticated;

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS code_audit_open_cap integer NOT NULL DEFAULT 25
    CHECK (code_audit_open_cap BETWEEN 1 AND 500);

COMMENT ON COLUMN public.project_settings.code_audit_open_cap IS
  'ADR 0063: at most this many open code_audit reports (pattern parents) per app. Past it the audit lane stops proposing and new findings wait in code_audit_deferred.';

ALTER TABLE public.work_lanes
  ADD COLUMN IF NOT EXISTS audit_rechecked_at timestamptz;

COMMENT ON COLUMN public.work_lanes.audit_rechecked_at IS
  'ADR 0063: when this audit lane last rechecked every open code-audit report of its app on the default branch. The claim asks for a recheck when it is NULL or older than 20 hours.';
