-- Make the tester GDPR RPCs work for the only caller allowed to run them.
--
-- 20260527050000 revoked EXECUTE on export_tester_data / delete_tester_data
-- from anon and authenticated, so only the service role (the `api` edge
-- function, after it resolves the tester from the caller's JWT) can call
-- them. Both functions still guarded on `auth_user_id = auth.uid()`, which is
-- NULL for the service role, so:
--   * POST /v1/tester/delete deleted nothing and answered { ok: true };
--   * POST /v1/tester/export downloaded {"error":"not_found_or_forbidden"}.
-- Found while fixing console group K #214 (tester "Delete permanently").
--
-- The guard now also admits the service role. Bodies are otherwise copied
-- unchanged from 20260523006000_mushi_tester_auto_provision.sql (the export
-- also returns the KYC legal name added in 20261004120000), and
-- CREATE OR REPLACE keeps the existing EXECUTE revokes.

CREATE OR REPLACE FUNCTION public.export_tester_data(p_tester_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  -- Guard: only the owning auth user may call this.
  -- The api edge function calls this with the service role after resolving
  -- the tester from the caller's JWT, so the service role passes the guard.
  SELECT CASE
    WHEN (
      SELECT 1 FROM public.mushi_testers
       WHERE id = p_tester_id
         AND (auth_user_id = auth.uid() OR auth.role() = 'service_role')
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
                          'withholding_status', tkyc.withholding_status,
                          'legal_name', tkyc.legal_name
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
     AND (auth_user_id = auth.uid() OR auth.role() = 'service_role');

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
