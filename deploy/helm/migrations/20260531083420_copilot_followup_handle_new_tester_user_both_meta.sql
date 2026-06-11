-- Migration: copilot_followup_handle_new_tester_user_both_meta
-- Deployed: 2026-05-31 via Supabase MCP (apply_migration)
-- Reason: Copilot PR #144 fix — make the tester auto-provision trigger
--   tolerate both raw_app_meta_data (set by server-side admin API) AND
--   raw_user_meta_data (set by client-side supabase.auth.signInWithOtp
--   options.data). Previously only raw_app_meta_data was checked, so
--   client-side signup with signup_intent='tester' silently failed to
--   provision tester rows.

CREATE OR REPLACE FUNCTION private.handle_new_tester_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
  v_intent text;
BEGIN
  v_intent := COALESCE(
    NEW.raw_app_meta_data  ->> 'signup_intent',
    NEW.raw_user_meta_data ->> 'signup_intent'
  );

  IF v_intent = 'tester' THEN
    INSERT INTO public.mushi_testers (auth_user_id, marketing_opt_in)
    VALUES (NEW.id, false)
    ON CONFLICT (auth_user_id) DO NOTHING;

    INSERT INTO public.mushi_tester_profiles (tester_id)
    SELECT id FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    INSERT INTO public.tester_balances (tester_id, current_points, total_points_lifetime, total_points_30d)
    SELECT id, 0, 0, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    INSERT INTO public.tester_reputation (tester_id, score)
    SELECT id, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
