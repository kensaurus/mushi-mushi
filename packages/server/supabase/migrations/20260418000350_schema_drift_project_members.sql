-- =============================================================================
-- Schema drift fix — declare `project_members` and `integration_health_history`
-- in source so a fresh `supabase db reset` matches production. Both tables are
-- referenced by edge functions ([packages/server/supabase/functions/api/index.ts])
-- but were created out-of-band on the live `dxptnwrhwsqckaftyymj` cloud and
-- never recorded as migrations, so they would be missing on a fresh local stack.
--
-- Captured from the live cloud schema (see the cloud-drift audit notes); the
-- definitions here are bit-for-bit equivalents (columns, defaults, FKs, checks,
-- indexes, RLS, policies, trigger). Idempotent: re-running on a DB that already
-- has the tables is a no-op thanks to `IF NOT EXISTS` and `pg_policies` guards.
-- =============================================================================

-- -------------------------------------------------------------------------
-- project_members
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_members (
  project_id uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON public.project_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_project_role
  ON public.project_members USING btree (project_id, role);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.project_members_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_members_updated_at ON public.project_members;
CREATE TRIGGER trg_project_members_updated_at
  BEFORE UPDATE ON public.project_members
  FOR EACH ROW
  EXECUTE FUNCTION public.project_members_touch_updated_at();

DO $policies$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_members'
       AND policyname = 'members_read_project_members'
  ) THEN
    CREATE POLICY members_read_project_members ON public.project_members
      FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_members'
       AND policyname = 'owners_insert_project_members'
  ) THEN
    CREATE POLICY owners_insert_project_members ON public.project_members
      FOR INSERT TO authenticated
      WITH CHECK (
        project_id IN (
          SELECT pm.project_id FROM public.project_members pm
           WHERE pm.user_id = (SELECT auth.uid())
             AND pm.role IN ('owner', 'admin')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_members'
       AND policyname = 'owners_update_project_members'
  ) THEN
    CREATE POLICY owners_update_project_members ON public.project_members
      FOR UPDATE TO authenticated
      USING (
        project_id IN (
          SELECT pm.project_id FROM public.project_members pm
           WHERE pm.user_id = (SELECT auth.uid())
             AND pm.role IN ('owner', 'admin')
        )
      )
      WITH CHECK (
        project_id IN (
          SELECT pm.project_id FROM public.project_members pm
           WHERE pm.user_id = (SELECT auth.uid())
             AND pm.role IN ('owner', 'admin')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_members'
       AND policyname = 'owners_or_self_delete_project_members'
  ) THEN
    CREATE POLICY owners_or_self_delete_project_members ON public.project_members
      FOR DELETE TO authenticated
      USING (
        user_id = (SELECT auth.uid())
        OR project_id IN (
          SELECT pm.project_id FROM public.project_members pm
           WHERE pm.user_id = (SELECT auth.uid())
             AND pm.role IN ('owner', 'admin')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'project_members'
       AND policyname = 'service_role_all_project_members'
  ) THEN
    CREATE POLICY service_role_all_project_members ON public.project_members
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $policies$;

COMMENT ON TABLE public.project_members IS
  'Project membership + role for multi-tenant access control. Mirrors live cloud schema; reconciled during cloud-drift reconciliation.';

-- -------------------------------------------------------------------------
-- integration_health_history
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_health_history (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  status      text        NOT NULL
              CHECK (status IN ('ok', 'degraded', 'down', 'unknown')),
  latency_ms  integer,
  message     text,
  source      text        NOT NULL DEFAULT 'manual',
  checked_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_health_project_kind_time
  ON public.integration_health_history USING btree (project_id, kind, checked_at DESC);

ALTER TABLE public.integration_health_history ENABLE ROW LEVEL SECURITY;

DO $policies$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'integration_health_history'
       AND policyname = 'members_read_health'
  ) THEN
    CREATE POLICY members_read_health ON public.integration_health_history
      FOR SELECT
      USING (
        project_id IN (
          SELECT pm.project_id FROM public.project_members pm
           WHERE pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'integration_health_history'
       AND policyname = 'service_writes_health'
  ) THEN
    CREATE POLICY service_writes_health ON public.integration_health_history
      FOR ALL
      USING ((SELECT auth.role()) = 'service_role')
      WITH CHECK ((SELECT auth.role()) = 'service_role');
  END IF;
END $policies$;

COMMENT ON TABLE public.integration_health_history IS
  'Append-only ping log for project integrations (sentry/github/jira/etc). Powers the /health admin page and the integration_health view.';
