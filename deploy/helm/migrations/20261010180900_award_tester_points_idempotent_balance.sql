-- ============================================================================
-- 20261010180900_award_tester_points_idempotent_balance
--
-- award_tester_points() returned balance_after = current + delta even when
-- ON CONFLICT (idempotency_key) DO NOTHING skipped the insert. On a replay
-- nothing was written and the balance did not move, so the payload claimed a
-- balance the tester does not have. On a skip it now returns the stored
-- balance.
--
-- Started from the live body (pg_get_functiondef on 2026-10-10). Signature,
-- SECURITY DEFINER and search_path are unchanged; CREATE OR REPLACE keeps the
-- grants from 20260527050000_revoke_anon_auth_execute_on_internal_rpcs.
-- What is awarded is unchanged: only the returned balance_after differs, and
-- only on an idempotent skip.
-- ============================================================================

create or replace function public.award_tester_points(
  p_tester_id uuid,
  p_delta_points integer,
  p_reason text,
  p_submission_id uuid default null::uuid,
  p_app_id uuid default null::uuid,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_current_balance int;
  v_new_balance     int;
  v_ledger_id       uuid;
begin
  select coalesce(current_points, 0) into v_current_balance from public.tester_balances where tester_id = p_tester_id;
  v_current_balance := coalesce(v_current_balance, 0);
  v_new_balance     := v_current_balance + p_delta_points;
  if v_new_balance < 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'current', v_current_balance);
  end if;
  insert into public.tester_credit_ledger (tester_id, delta_points, balance_after_points, reason, submission_id, app_id, idempotency_key)
  values (p_tester_id, p_delta_points, v_new_balance, p_reason, p_submission_id, p_app_id, coalesce(p_idempotency_key, gen_random_uuid()::text))
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;
  return jsonb_build_object(
    'ledger_id',       v_ledger_id,
    'delta_points',    p_delta_points,
    -- A skipped replay wrote nothing: the balance is still the stored one.
    'balance_after',   case when v_ledger_id is null then v_current_balance else v_new_balance end,
    'idempotent_skip', v_ledger_id is null
  );
end;
$function$;
