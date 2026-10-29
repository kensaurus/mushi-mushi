-- =============================================================================
-- Stop scoped_rate_limit_claim from holding a hot counter until statement_timeout.
--
-- sdk_sessions_ip (and any other single actor+scope bucket) is one row.
-- Past the cap, the previous body incremented and then raised
-- rate_limit_exceeded, which aborts the transaction and rolls the increment
-- back. A flood still queued on that row lock and Postgres cancelled the
-- waiters with SQLSTATE 57014. The sessions route treated that timeout as a
-- rate-limit denial.
--
-- A committed count already at the cap is rejected with no row lock. The
-- write waits at most 250ms; if it cannot get the row it raises
-- rate_limit_busy (55P03) instead of sitting out statement_timeout. Callers
-- that only need a cap breach (P0001) can let a busy claim through.
-- =============================================================================

create or replace function public.scoped_rate_limit_claim(
  p_user_id uuid,
  p_scope text,
  p_max_per_window integer,
  p_window interval default '1 hour'
) returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_window timestamptz := date_bin(p_window, now(), 'epoch'::timestamptz);
  v_count integer;
begin
  if p_max_per_window <= 0 then
    raise exception 'scoped_rate_limit_claim: p_max_per_window must be > 0';
  end if;

  -- Snapshot read: no row lock. Once the committed count has filled the
  -- window, further calls must not queue behind the updater.
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

  perform set_config('lock_timeout', '250ms', true);

  begin
    update public.scoped_rate_limits
       set request_count = request_count + 1
     where user_id = p_user_id
       and scope = p_scope
       and window_start = v_window
    returning request_count into v_count;

    if not found then
      insert into public.scoped_rate_limits (user_id, scope, window_start, request_count)
      values (p_user_id, p_scope, v_window, 1)
      on conflict (user_id, scope, window_start)
        do update set request_count = scoped_rate_limits.request_count + 1
      returning request_count into v_count;
    end if;
  exception
    when lock_not_available or deadlock_detected then
      raise exception 'rate_limit_busy: scope=%', p_scope
        using errcode = '55P03';
  end;

  if v_count > p_max_per_window then
    raise exception 'rate_limit_exceeded: scope=% count=% cap=% window=%',
      p_scope, v_count, p_max_per_window, p_window
      using errcode = 'P0001';
  end if;

  return v_count;
end;
$$;
