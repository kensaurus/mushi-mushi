-- Rate-limit mushi_link_reporter_token (2026-11-11 security audit).
--
-- The function is SECURITY DEFINER and executable by `authenticated`, which
-- includes anonymous sign-ins, straight through /rest/v1/rpc. Ownership was
-- already right (it links only to the caller's own mushi_testers row, and
-- only reports no other tester holds), but nothing bounded how often one
-- account could run its UPDATE over reports. The SDK calls it once per
-- in-widget sign-in (POST /v1/tester/link-reporter), so 30 an hour per user
-- never limits real use.

create or replace function public.mushi_link_reporter_token(p_reporter_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tester_id uuid;
  v_updated   integer;
begin
  select id into v_tester_id
  from public.mushi_testers
  where auth_user_id = auth.uid()
  limit 1;

  if v_tester_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_tester');
  end if;

  begin
    perform public.scoped_rate_limit_claim(auth.uid(), 'tester_link_reporter', 30, interval '1 hour');
  exception when sqlstate 'P0001' then
    if sqlerrm like 'rate_limit_exceeded%' then
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;
    raise;
  end;

  update public.reports
  set    tester_id = v_tester_id
  where  reporter_token_hash = public.mushi_reporter_key(p_reporter_token_hash)
    and  (tester_id is null or tester_id = v_tester_id);

  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'linked', v_updated);
end;
$function$;

revoke all on function public.mushi_link_reporter_token(text) from public, anon;
grant execute on function public.mushi_link_reporter_token(text) to authenticated, service_role;
