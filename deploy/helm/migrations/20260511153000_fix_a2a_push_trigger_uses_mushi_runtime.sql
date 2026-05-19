-- Fix the A2A push notification trigger so it works on hosted Supabase.
--
-- Sentry Seer caught this in PR #99 review: the original trigger reads
-- `current_setting('app.settings.supabase_url', true)` and
-- `current_setting('app.settings.service_role_key', true)`. Hosted Supabase
-- does NOT set those GUCs via `ALTER DATABASE SET`, so both values are
-- always NULL on `dxptnwrhwsqckaftyymj` and the function silently RETURNs
-- without ever calling pg_net. Net effect: the entire A2A push pipeline is
-- a no-op on the primary deployment target.
--
-- Fix: route through the same helpers the drift-watch cron, retention
-- sweep, and stranded-pipeline recovery already use:
--   - public.mushi_runtime_supabase_url()  -- reads from mushi_runtime_config
--   - public.mushi_internal_auth_header()  -- composes 'Bearer <token>',
--                                            falls back to legacy GUC
-- These were introduced in `20260423040000_wave_t_runtime_config_and_rls_initplan.sql`.

CREATE OR REPLACE FUNCTION public.fn_a2a_push_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_supabase_url TEXT;
  v_auth_header  TEXT;
  v_request_id   BIGINT;
BEGIN
  IF NEW.push_notification_config IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Use the runtime-config helpers so this works on hosted Supabase where
  -- the legacy `app.settings.*` GUCs are not configured. The helpers
  -- transparently fall back to the legacy GUC path for self-hosted
  -- clusters that haven't migrated to mushi_runtime_config yet.
  v_supabase_url := public.mushi_runtime_supabase_url();
  v_auth_header  := public.mushi_internal_auth_header();

  IF v_supabase_url IS NULL OR v_auth_header IS NULL THEN
    -- Configuration missing on this cluster. Silent skip is correct
    -- here: a status update must never be blocked by absent push wiring.
    -- Operators can detect this state by querying mushi_runtime_config.
    RETURN NEW;
  END IF;

  -- net.http_post is non-blocking; the response lands in net._http_response
  -- and is reaped automatically. We only care that the POST got queued.
  SELECT net.http_post(
    url     := v_supabase_url || '/functions/v1/a2a-push-notify',
    body    := jsonb_build_object('taskId', NEW.id, 'newStatus', NEW.status, 'previousStatus', OLD.status),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', v_auth_header
               ),
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  RETURN NEW;
END;
$$;

-- Re-revoke from anon to satisfy the security definer ACL audit (the
-- CREATE OR REPLACE preserves ACLs but we re-state explicitly for clarity).
REVOKE EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_a2a_push_on_status_change() TO service_role;

COMMENT ON FUNCTION public.fn_a2a_push_on_status_change() IS
  'AFTER UPDATE OF status trigger on fix_dispatch_jobs. Posts to the a2a-push-notify edge function via pg_net when the row has push_notification_config set. Uses mushi_runtime_supabase_url() / mushi_internal_auth_header() so it works on hosted Supabase where app.settings.* GUCs are not configured.';
