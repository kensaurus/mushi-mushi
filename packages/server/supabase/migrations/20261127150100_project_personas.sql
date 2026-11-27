-- =============================================================================
-- 20261127150100_project_personas
--
-- ADR 0073 (Plan 025 P3): personas are user profiles a project keeps; test
-- accounts are a per-project opt-in; a run reserves its LLM budget before it
-- starts and releases what it did not use.
--
--   project_personas        who a first-time user test (fresh eyes) or a PDCA
--                           critic plays: name, goal, locale, device,
--                           expertise, accessibility needs, patience (a step
--                           cap) and a cost cap. Members read them; the API
--                           writes them through the service role.
--   ux_runs.persona_id      the persona a fresh-eyes run played
--   ux_runs.account_refs    the ids (never passwords) of the test accounts a
--                           project's own test-account hook made for the run,
--                           so the run's end can ask the hook to delete them
--   pdca_runs.project_persona_id
--                           the user a PDCA critic judges for, on top of its
--                           rubric persona (agent_personas)
--   project_settings.fresh_eyes_accounts
--                           off (default) | mushi | hook. Replaces "Mushi's own
--                           project only" (ADR 0053): `mushi` makes accounts
--                           in this Mushi deployment's own sign-in (operators
--                           only); `hook` asks the app's own backend for them.
--   project_settings.fresh_eyes_account_hook_url / _secret_id
--                           the app's test-account hook and the Vault id of its
--                           signing secret (the secret itself is in Vault)
--   llm_run_reservations    budget held for one run while it runs
--   reserve_llm_run_budget / charge_llm_run_reservation / refund_llm_run_reservation /
--   release_llm_run_reservation
--                           the moves (a refund gives back a failed call's charge)
--   work_hosts.takes        adds 'fresh_eyes_persona': a daemon that forwards a
--                           persona to mushi-ux
--
-- ADDITIVE and idempotent: new tables, new nullable / defaulted columns, a
-- widened CHECK, new functions. Apply BEFORE deploying api, api-ext and
-- pdca-runner.
--
-- Verify after apply:
--   select relrowsecurity from pg_class where relname in ('project_personas', 'llm_run_reservations');   -- t, t
--   select has_table_privilege('authenticated', 'public.project_personas', 'insert');                    -- f
--   select has_table_privilege('authenticated', 'public.llm_run_reservations', 'select');               -- f
--   select has_function_privilege('authenticated', 'public.reserve_llm_run_budget(uuid, uuid, text, numeric, numeric, uuid, integer)', 'execute'); -- f
--   select column_name from information_schema.columns
--    where table_name = 'project_settings' and column_name like 'fresh_eyes_account%';                 -- 3 rows
-- =============================================================================

-- ── project_personas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_personas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  preset          text CHECK (preset IS NULL OR preset IN ('first_time', 'power_user', 'older_user', 'japanese_user', 'screen_reader_user', 'impatient_mobile')),
  goal            text CHECK (goal IS NULL OR char_length(goal) BETWEEN 1 AND 300),
  locale          text NOT NULL DEFAULT 'en-US' CHECK (char_length(locale) <= 35 AND locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$'),
  device          text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile', 'tablet')),
  expertise       text NOT NULL DEFAULT 'new' CHECK (expertise IN ('new', 'casual', 'power')),
  accessibility   text[] NOT NULL DEFAULT '{}'::text[]
                    CHECK (accessibility <@ ARRAY['screen_reader', 'low_vision', 'keyboard_only', 'reduced_motion', 'color_blind', 'motor', 'plain_language']::text[]),
  patience_steps  integer NOT NULL DEFAULT 30 CHECK (patience_steps BETWEEN 5 AND 80),
  cost_cap_usd    numeric(8, 2) NOT NULL DEFAULT 1 CHECK (cost_cap_usd >= 0.05 AND cost_cap_usd <= 20),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

COMMENT ON TABLE public.project_personas IS
  'ADR 0073: user profiles a project keeps for its first-time user tests (fresh eyes) and PDCA critics: who the visitor is (goal, locale, device, expertise, accessibility needs), how patient (patience_steps caps the steps a visitor takes) and what a run may spend (cost_cap_usd caps the run''s LLM reservation). Separate from agent_personas, the rubric critics. Members read; the API writes through the service role. Deleting archives (archived_at), so past runs keep their persona.';

CREATE UNIQUE INDEX IF NOT EXISTS project_personas_live_name_uniq
  ON public.project_personas (project_id, lower(btrim(name)))
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS project_personas_project_live
  ON public.project_personas (project_id, created_at)
  WHERE archived_at IS NULL;

ALTER TABLE public.project_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_personas_member_select ON public.project_personas;
CREATE POLICY project_personas_member_select ON public.project_personas
  FOR SELECT TO authenticated USING ((SELECT private.is_project_member(project_id)));
DROP POLICY IF EXISTS project_personas_service_write ON public.project_personas;
CREATE POLICY project_personas_service_write ON public.project_personas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.project_personas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.project_personas FROM authenticated;
GRANT SELECT ON TABLE public.project_personas TO authenticated;

-- ── ux_runs / pdca_runs: the persona a run played ───────────────────────────
ALTER TABLE public.ux_runs
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES public.project_personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_refs jsonb
    CHECK (account_refs IS NULL OR (jsonb_typeof(account_refs) = 'array' AND jsonb_array_length(account_refs) <= 10));

COMMENT ON COLUMN public.ux_runs.persona_id IS
  'ADR 0073: the project persona a fresh-eyes run played (its goal, device, locale, needs and step cap). NULL: the plain first-time visitor.';
COMMENT ON COLUMN public.ux_runs.account_refs IS
  'ADR 0073: the account ids a project''s test-account hook returned for this run (never a password), so the run''s end can ask the hook to delete them. NULL for runs without hook accounts.';

CREATE INDEX IF NOT EXISTS ux_runs_persona_started
  ON public.ux_runs (persona_id, started_at DESC)
  WHERE persona_id IS NOT NULL;

ALTER TABLE public.pdca_runs
  ADD COLUMN IF NOT EXISTS project_persona_id uuid REFERENCES public.project_personas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pdca_runs.project_persona_id IS
  'ADR 0073: the project persona the critic judges for (who the user is), on top of its rubric persona (persona, an agent_personas slug).';

-- ── project_settings: test accounts, opt-in per project ─────────────────────
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS fresh_eyes_accounts text NOT NULL DEFAULT 'off'
    CHECK (fresh_eyes_accounts IN ('off', 'mushi', 'hook')),
  ADD COLUMN IF NOT EXISTS fresh_eyes_account_hook_url text
    CHECK (fresh_eyes_account_hook_url IS NULL OR (char_length(fresh_eyes_account_hook_url) <= 500 AND fresh_eyes_account_hook_url ~ '^https://')),
  ADD COLUMN IF NOT EXISTS fresh_eyes_account_hook_secret_id text;

COMMENT ON COLUMN public.project_settings.fresh_eyes_accounts IS
  'ADR 0073: whether a first-time user test may sign up with test accounts. off (default): it stops at the sign-up wall. mushi: accounts in this Mushi deployment''s own sign-in (for an app that signs in there; operators only), flagged and deleted after 24 h (ADR 0053). hook: the app''s own backend makes them through fresh_eyes_account_hook_url, signed with the secret in Vault. Either way only an owner or admin''s console click grants them for one run, at most 12 an hour.';
COMMENT ON COLUMN public.project_settings.fresh_eyes_account_hook_url IS
  'ADR 0073: https address of the app''s test-account hook. Mushi POSTs mushi.test_account.create (and .expire when the run ends) with an X-Mushi-Signature HMAC-SHA256 header.';
COMMENT ON COLUMN public.project_settings.fresh_eyes_account_hook_secret_id IS
  'ADR 0073: Vault secret id of the hook''s signing secret (name mushi_<project_id>_fresh_eyes_hook). The secret is shown once when made.';

-- ── work_hosts.takes: a daemon that forwards a persona ──────────────────────
ALTER TABLE public.work_hosts DROP CONSTRAINT IF EXISTS work_hosts_takes_check;
ALTER TABLE public.work_hosts
  ADD CONSTRAINT work_hosts_takes_check CHECK (takes <@ ARRAY['fresh_eyes', 'fresh_eyes_persona']::text[]);

-- ── llm_run_reservations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.llm_run_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- The ux_runs row this holds budget for. Not a foreign key: the reservation
  -- is made before the run row exists, so a refused run never shows up.
  ux_run_id     uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('fresh_eyes', 'scorecard')),
  reserved_usd  numeric(10, 4) NOT NULL CHECK (reserved_usd > 0 AND reserved_usd <= 50),
  charged_usd   numeric(10, 4) NOT NULL DEFAULT 0 CHECK (charged_usd >= 0),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released')),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  released_at   timestamptz,
  CHECK (charged_usd <= reserved_usd)
);

COMMENT ON TABLE public.llm_run_reservations IS
  'ADR 0073: LLM budget one UX run holds while it runs. A run reserves its estimate (capped by its persona''s cost_cap_usd) before it starts; the project''s monthly budget minus this month''s spend minus every other open reservation must cover it. Each model call or filed report the run makes charges it, and stops at the reservation. The run''s end releases what it did not charge; an open reservation stops counting at expires_at. Service role only.';

CREATE UNIQUE INDEX IF NOT EXISTS llm_run_reservations_run_uniq ON public.llm_run_reservations (ux_run_id);
CREATE INDEX IF NOT EXISTS llm_run_reservations_project_open
  ON public.llm_run_reservations (project_id, expires_at)
  WHERE status = 'open';

ALTER TABLE public.llm_run_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_run_reservations_service_all ON public.llm_run_reservations;
CREATE POLICY llm_run_reservations_service_all ON public.llm_run_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.llm_run_reservations FROM anon, authenticated;

/**
 * Reserve p_usd for one run. p_headroom_usd is the project's monthly budget
 * minus this month's priced spend (read by the caller, _shared/llm-budget.ts),
 * or NULL when the project has no budget (the run's own cap still holds).
 * Serialized per project, so two runs cannot both take the last dollars.
 * Idempotent per run: a second call returns the first reservation.
 */
CREATE OR REPLACE FUNCTION public.reserve_llm_run_budget(
  p_project_id uuid,
  p_ux_run_id uuid,
  p_kind text,
  p_usd numeric,
  p_headroom_usd numeric,
  p_created_by uuid,
  p_ttl_hours integer
)
RETURNS TABLE (ok boolean, reservation_id uuid, held_elsewhere_usd numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_held numeric;
  v_id uuid;
BEGIN
  IF p_usd IS NULL OR p_usd <= 0 OR p_usd > 50 THEN
    RAISE EXCEPTION 'reserve_llm_run_budget: p_usd must be in (0, 50]' USING errcode = 'check_violation';
  END IF;
  IF p_ttl_hours IS NULL OR p_ttl_hours < 1 OR p_ttl_hours > 72 THEN
    RAISE EXCEPTION 'reserve_llm_run_budget: p_ttl_hours must be 1 to 72' USING errcode = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('llm_run_reservation:' || p_project_id::text, 0));

  SELECT r.id INTO v_existing FROM public.llm_run_reservations r WHERE r.ux_run_id = p_ux_run_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT true, v_existing, 0::numeric;
    RETURN;
  END IF;

  SELECT COALESCE(sum(r.reserved_usd - r.charged_usd), 0) INTO v_held
    FROM public.llm_run_reservations r
   WHERE r.project_id = p_project_id AND r.status = 'open' AND r.expires_at > now();

  IF p_headroom_usd IS NOT NULL AND v_held + p_usd > p_headroom_usd THEN
    RETURN QUERY SELECT false, NULL::uuid, v_held;
    RETURN;
  END IF;

  INSERT INTO public.llm_run_reservations (project_id, ux_run_id, kind, reserved_usd, created_by, expires_at)
  VALUES (p_project_id, p_ux_run_id, p_kind, p_usd, p_created_by, now() + make_interval(hours => p_ttl_hours))
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, v_id, v_held;
END;
$$;

/**
 * Charge p_usd to a run's open reservation. True when it fit; false when the
 * run has no open, unexpired reservation with that much left (the caller
 * refuses the call). A run with no reservation at all is the caller's case.
 */
CREATE OR REPLACE FUNCTION public.charge_llm_run_reservation(p_ux_run_id uuid, p_usd numeric)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH charged AS (
    UPDATE public.llm_run_reservations
       SET charged_usd = charged_usd + p_usd
     WHERE ux_run_id = p_ux_run_id
       AND status = 'open'
       AND expires_at > now()
       AND p_usd > 0
       AND charged_usd + p_usd <= reserved_usd
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM charged);
$$;

/**
 * Give back p_usd a run charged for a call that then failed (the model was
 * not reached, or answered nothing usable), so a retry does not eat the
 * budget the run's later calls need. Never below zero; open runs only.
 */
CREATE OR REPLACE FUNCTION public.refund_llm_run_reservation(p_ux_run_id uuid, p_usd numeric)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH refunded AS (
    UPDATE public.llm_run_reservations
       SET charged_usd = GREATEST(0, charged_usd - p_usd)
     WHERE ux_run_id = p_ux_run_id
       AND status = 'open'
       AND p_usd > 0
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM refunded);
$$;

/** Release a run's reservation; the amount it frees (0 when there was none open). */
CREATE OR REPLACE FUNCTION public.release_llm_run_reservation(p_ux_run_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH released AS (
    UPDATE public.llm_run_reservations
       SET status = 'released', released_at = now()
     WHERE ux_run_id = p_ux_run_id AND status = 'open'
    RETURNING reserved_usd - charged_usd AS freed
  )
  SELECT COALESCE((SELECT sum(freed) FROM released), 0);
$$;

REVOKE ALL ON FUNCTION public.reserve_llm_run_budget(uuid, uuid, text, numeric, numeric, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.charge_llm_run_reservation(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_llm_run_reservation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_llm_run_reservation(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_llm_run_budget(uuid, uuid, text, numeric, numeric, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.charge_llm_run_reservation(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_llm_run_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_llm_run_reservation(uuid, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
