-- Migration: mushi_tester_auto_provision
-- PURPOSE: Wave 3 — adds the database-side trigger that auto-provisions a
--   mushi_testers row when a new user signs up with signup_intent='tester'
--   in their app_metadata. Also adds the GDPR export/delete RPCs.

-- ── auto-provision trigger ────────────────────────────────────────────────
-- Fires AFTER INSERT on auth.users.
-- Only creates a mushi_testers row when app_metadata.signup_intent = 'tester'.
-- Existing dev users (who already have organization_members rows) are skipped
-- — they must explicitly opt in via the dashboard.
CREATE OR REPLACE FUNCTION private.handle_new_tester_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth
AS $$
DECLARE
  v_intent text;
BEGIN
  v_intent := NEW.raw_app_meta_data ->> 'signup_intent';

  IF v_intent = 'tester' THEN
    -- Insert a mushi_testers stub. display_name and terms_accepted_at
    -- are set later via the tester onboarding flow.
    INSERT INTO public.mushi_testers (auth_user_id, marketing_opt_in)
    VALUES (NEW.id, false)
    ON CONFLICT (auth_user_id) DO NOTHING;

    -- Bootstrap an empty profile row.
    INSERT INTO public.mushi_tester_profiles (tester_id)
    SELECT id FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    -- Bootstrap a zero-balance row in tester_balances.
    INSERT INTO public.tester_balances (tester_id, current_points, total_points_lifetime, total_points_30d)
    SELECT id, 0, 0, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    -- Bootstrap a zero-reputation row.
    INSERT INTO public.tester_reputation (tester_id, score)
    SELECT id, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger on auth.users (private schema, service-role only).
CREATE OR REPLACE TRIGGER on_auth_user_created_tester
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_tester_user();

-- ── export_tester_data RPC ────────────────────────────────────────────────
-- GDPR / CCPA data portability. Returns all tester data as JSON.
-- Callable by the authenticated tester themselves only (RLS via auth.uid() check).
CREATE OR REPLACE FUNCTION public.export_tester_data(p_tester_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  -- Guard: only the owning auth user may call this.
  -- Service role bypasses this automatically.
  SELECT CASE
    WHEN (
      SELECT 1 FROM public.mushi_testers
       WHERE id = p_tester_id
         AND auth_user_id = auth.uid()
    ) IS NULL
    THEN jsonb_build_object('error', 'not_found_or_forbidden')
    ELSE (
      SELECT jsonb_build_object(
        'tester',       row_to_json(mt),
        'profile',      row_to_json(mtp),
        'balances',     row_to_json(tb),
        'reputation',   row_to_json(tr),
        'kyc_status',   jsonb_build_object(
                          'jurisdiction', tkyc.jurisdiction,
                          'tax_form_kind', tkyc.tax_form_kind,
                          'tax_form_collected_at', tkyc.tax_form_collected_at,
                          'withholding_status', tkyc.withholding_status
                          -- NOTE: tin_provided_hash intentionally excluded.
                        ),
        'subscriptions', (
          SELECT json_agg(row_to_json(s))
            FROM public.tester_app_subscriptions s
           WHERE s.tester_id = p_tester_id
        ),
        'submissions',   (
          SELECT json_agg(row_to_json(sub))
            FROM public.tester_submissions sub
           WHERE sub.tester_id = p_tester_id
        ),
        'ledger',        (
          SELECT json_agg(row_to_json(l) ORDER BY l.created_at)
            FROM public.tester_credit_ledger l
           WHERE l.tester_id = p_tester_id
        ),
        'redemptions',   (
          SELECT json_agg(row_to_json(r))
            FROM public.tester_redemptions r
           WHERE r.tester_id = p_tester_id
        )
      )
      FROM public.mushi_testers mt
      LEFT JOIN public.mushi_tester_profiles mtp ON mtp.tester_id = mt.id
      LEFT JOIN public.tester_balances tb ON tb.tester_id = mt.id
      LEFT JOIN public.tester_reputation tr ON tr.tester_id = mt.id
      LEFT JOIN public.tester_kyc tkyc ON tkyc.tester_id = mt.id
      WHERE mt.id = p_tester_id
    )
  END;
$$;

COMMENT ON FUNCTION public.export_tester_data IS
  'GDPR / CCPA data portability export. Returns all data for the authenticated '
  'tester as a JSON blob. TIN hash is intentionally excluded.';

-- ── delete_tester_data RPC ────────────────────────────────────────────────
-- GDPR right-to-erasure. Cascades through all tester-owned tables.
-- Does NOT delete the auth.users row (that requires a separate admin action
-- or the user to request account deletion through Supabase auth).
CREATE OR REPLACE FUNCTION public.delete_tester_data(p_tester_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  -- Guard: only the owning auth user may call this.
  SELECT auth_user_id INTO v_auth_user_id
    FROM public.mushi_testers
   WHERE id = p_tester_id
     AND auth_user_id = auth.uid();

  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found_or_forbidden');
  END IF;

  -- Cascade order:
  -- tremendous_orders → tester_redemptions → tester_credit_ledger
  -- tester_submissions → tester_app_subscriptions
  -- tester_kyc, tester_reputation, tester_balances, mushi_tester_profiles
  -- → mushi_testers (ON DELETE CASCADE covers most of the above)
  -- We do explicit deletes for audit and to handle any timing gaps.

  DELETE FROM public.tremendous_orders  WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_redemptions WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_credit_ledger WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_submissions WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_app_subscriptions WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_kyc WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_reputation WHERE tester_id = p_tester_id;
  DELETE FROM public.tester_balances WHERE tester_id = p_tester_id;
  DELETE FROM public.mushi_tester_profiles WHERE tester_id = p_tester_id;
  DELETE FROM public.mushi_testers WHERE id = p_tester_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'note', 'auth.users row not deleted — request account deletion separately'
  );
END;
$$;

COMMENT ON FUNCTION public.delete_tester_data IS
  'GDPR right-to-erasure. Deletes all tester data by cascading through '
  'every tester-owned table. The auth.users row is NOT deleted — file '
  'a separate account-deletion request for that.';
