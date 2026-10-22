-- ============================================================================
-- 20261022052438_ci_placement
--
-- Choose where CI runs (Plan 022 Phase 7b, ADR 0037). Mushi may change one
-- thing: a repo Actions variable from an allowlist (LINUX_RUNNER,
-- RUNNER_<WORKFLOW>), through a request → owner/admin approval (1 h) →
-- console execution with a payload hash and a compare-and-set on the
-- variable's current value. Never runner labels, registrations or a
-- dispatcher.
--
--   ci_runner_policies     per organization, filled by the owner (nothing is
--                          seeded): no paid GitHub-hosted minutes on private
--                          repos, repos allowed on GitHub-hosted anyway,
--                          external controllers Mushi must not compete with
--                          (shown read-only), standby runners that are never
--                          a target
--   connector_actions      a GitHub action may name its connector kind
--                          instead of a connector instance: GitHub is
--                          legacy-backed (the project's own stored token),
--                          so it has no connector_instances row. Every other
--                          connector still needs its instance.
--   ci_placement_watches   after a change runs: the next jobs that read the
--                          variable, whether they landed where expected and
--                          how long they waited; the revert request, if any
--
-- ADDITIVE: two tables, one nullable column, one relaxed NOT NULL guarded by
-- a CHECK. Apply after 20261022050303_ci_cost_compare and before deploying
-- api-ext and ci-jobs-collector.
-- ============================================================================

-- ── ci_runner_policies ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_runner_policies (
  organization_id            uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  no_paid_hosted_on_private  boolean NOT NULL DEFAULT false,
  -- owner/repo names that may run on GitHub-hosted even with the rule above.
  hosted_allowed_repos       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(hosted_allowed_repos) <= 200),
  -- [{name, owner, repos: [owner/repo], note?}], at most 20.
  external_controllers       jsonb NOT NULL DEFAULT '[]'::jsonb
                               CHECK (jsonb_typeof(external_controllers) = 'array' AND jsonb_array_length(external_controllers) <= 20),
  -- Runner names or labels (`*` wildcards) that are never a target.
  standby_runners            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(standby_runners) <= 100),
  -- Where the owner took it from, e.g. "CI-AGREEMENT.md, 2026-10-22".
  source_note                text CHECK (source_note IS NULL OR char_length(source_note) <= 300),
  updated_by                 uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ci_runner_policies IS
  'Plan 022 Phase 7b (ADR 0037): the organization''s CI agreement as Mushi enforces it when changing where CI runs. Checked when a placement change is requested and again when it runs. Written only by PUT /v1/admin/ci/policy (console, owner/admin; turning off no_paid_hosted_on_private needs an owner).';

ALTER TABLE public.ci_runner_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_runner_policies_member_select ON public.ci_runner_policies;
CREATE POLICY ci_runner_policies_member_select
  ON public.ci_runner_policies FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(organization_id)));

DROP POLICY IF EXISTS ci_runner_policies_service_write ON public.ci_runner_policies;
CREATE POLICY ci_runner_policies_service_write
  ON public.ci_runner_policies FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.ci_runner_policies FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ci_runner_policies FROM authenticated;
GRANT SELECT ON TABLE public.ci_runner_policies TO authenticated;

-- ── connector_actions: legacy-backed GitHub actions ─────────────────────────
ALTER TABLE public.connector_actions
  ADD COLUMN IF NOT EXISTS connector_kind text CHECK (connector_kind IS NULL OR connector_kind = 'github');

ALTER TABLE public.connector_actions
  ALTER COLUMN connector_instance_id DROP NOT NULL;

ALTER TABLE public.connector_actions
  DROP CONSTRAINT IF EXISTS connector_actions_instance_or_kind;
ALTER TABLE public.connector_actions
  ADD CONSTRAINT connector_actions_instance_or_kind
  CHECK (connector_instance_id IS NOT NULL OR connector_kind = 'github');

COMMENT ON COLUMN public.connector_actions.connector_kind IS
  'Set instead of connector_instance_id for a legacy-backed connector (GitHub: the project''s own stored token). Only GitHub CI placement actions use it (set_actions_variable / delete_actions_variable, ADR 0037).';

-- ── ci_placement_watches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_placement_watches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  action_id         uuid NOT NULL UNIQUE REFERENCES public.connector_actions(id) ON DELETE CASCADE,
  repo              text NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  variable          text NOT NULL CHECK (variable ~ '^(LINUX_RUNNER|RUNNER_[A-Z0-9_]{1,60})$'),
  previous_value    text,
  new_value         text,
  -- The labels the moved jobs should now ask for.
  expected_labels   text[] NOT NULL DEFAULT '{}',
  -- [{workflow, job}] the change moves.
  jobs              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(jobs) = 'array'),
  started_at        timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'ok', 'alert', 'reverted', 'expired')),
  jobs_seen         integer NOT NULL DEFAULT 0 CHECK (jobs_seen >= 0),
  unexpected        integer NOT NULL DEFAULT 0 CHECK (unexpected >= 0),
  slow              integer NOT NULL DEFAULT 0 CHECK (slow >= 0),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  last_checked_at   timestamptz,
  revert_action_id  uuid REFERENCES public.connector_actions(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ci_placement_watches IS
  'Plan 022 Phase 7b (ADR 0037): after a CI placement change runs, the next 10 jobs that read the variable: where they ran and how long they waited (alert when one lands elsewhere or waits over 30 min). Updated by ci-jobs-collector from ci_jobs, no GitHub calls. Service-role writes.';

CREATE INDEX IF NOT EXISTS idx_ci_placement_watches_open
  ON public.ci_placement_watches (organization_id, started_at DESC)
  WHERE status = 'watching';

ALTER TABLE public.ci_placement_watches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_placement_watches_member_select ON public.ci_placement_watches;
CREATE POLICY ci_placement_watches_member_select
  ON public.ci_placement_watches FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(organization_id)));

DROP POLICY IF EXISTS ci_placement_watches_service_write ON public.ci_placement_watches;
CREATE POLICY ci_placement_watches_service_write
  ON public.ci_placement_watches FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.ci_placement_watches FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ci_placement_watches FROM authenticated;
GRANT SELECT ON TABLE public.ci_placement_watches TO authenticated;
