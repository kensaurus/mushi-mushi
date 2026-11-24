-- A full rate-limit window must reject without taking the row lock.
--
-- scoped_rate_limit_claim increments, then raises rate_limit_exceeded when
-- the count is past the cap. That raise aborts the transaction, so the
-- increment never commits — the stored count stays at the cap — but every
-- rejected caller still waited on the row lock. A hot bucket (one IP on
-- sdk_sessions_ip, a shared NAT, a flood) therefore queues every request
-- for the rest of the minute. The wait is part of statement_timeout, so
-- the RPC comes back as "canceling statement due to statement timeout"
-- and callers that fail closed (POST /v1/sdk/session) reject work that
-- was only stuck behind the convoy.
--
-- Once the committed count is at the cap, a plain SELECT sees it and
-- raises rate_limit_exceeded without locking. Callers still under the cap
-- take the same INSERT ... ON CONFLICT lock they always did and still
-- succeed; there is no lock_timeout, so a brief wait does not become an
-- error for report ingest or any other scope. The ON CONFLICT update
-- itself stops at the cap, so a claim that raced past the read does not
-- write a dead tuple it would only roll back. The actor key, the cap, and
-- the P0001 rate_limit_exceeded error are unchanged. The primary key
-- (user_id, scope, window_start) already covers the read.

create or replace function public.scoped_rate_limit_claim(
  p_user_id uuid,
  p_scope text,
  p_max_per_window integer,
  p_window interval default '1 hour'
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_window timestamptz := date_bin(p_window, now(), 'epoch'::timestamptz);
  v_count integer;
begin
  if p_max_per_window <= 0 then
    raise exception 'scoped_rate_limit_claim: p_max_per_window must be > 0';
  end if;

  -- Reads the last committed count and does not wait on an in-flight update.
  select request_count into v_count
    from public.scoped_rate_limits
   where user_id = p_user_id
     and scope = p_scope
     and window_start = v_window;

  if v_count is not null and v_count >= p_max_per_window then
    raise exception 'rate_limit_exceeded: scope=% count=% cap=% window=%',
      p_scope, v_count, p_max_per_window, p_window
      using errcode = 'P0001';
  end if;

  -- A skipped ON CONFLICT update returns no row. INTO must not keep the
  -- pre-check count and treat that miss as a successful claim.
  v_count := null;

  insert into public.scoped_rate_limits (user_id, scope, window_start, request_count)
  values (p_user_id, p_scope, v_window, 1)
  on conflict (user_id, scope, window_start)
    do update set request_count = scoped_rate_limits.request_count + 1
    where scoped_rate_limits.request_count < p_max_per_window
  returning request_count into v_count;

  if v_count is null or v_count > p_max_per_window then
    raise exception 'rate_limit_exceeded: scope=% count=% cap=% window=%',
      p_scope, coalesce(v_count, p_max_per_window), p_max_per_window, p_window
      using errcode = 'P0001';
  end if;

  return v_count;
end;
$fn$;

revoke all on function public.scoped_rate_limit_claim(uuid, text, integer, interval) from public, anon, authenticated;
grant execute on function public.scoped_rate_limit_claim(uuid, text, integer, interval) to service_role;

comment on function public.scoped_rate_limit_claim(uuid, text, integer, interval) is
  'Claim one unit of a (actor, scope, window) budget. A window already at the cap raises rate_limit_exceeded (P0001) without locking the row; under the cap the counter increments as before.';
