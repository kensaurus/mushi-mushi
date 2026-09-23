-- ============================================================================
-- 20260922000015_end_user_erasure
--
-- Audit #30 / #31: DELETE /v1/sdk/me deleted only the end_users row.
--
-- 1. What it left behind. end_user_sessions and product_events reference
--    end_users ON DELETE SET NULL, so an erased person's sessions (with their
--    reporter-token digest) and analytics events survived, and
--    session_page_views has no FK at all. erase_end_user() removes them, by
--    end_user_id and by the reporter-token digests seen on the person's own
--    sessions (the same device's anonymous rows), in one transaction.
-- 2. What it destroyed. reward_payouts and reward_disputes cascaded, so
--    erasing a person erased the money trail. They now keep the row, lose the
--    link (ON DELETE SET NULL) and record end_user_erased_at for audit.
--    reward_payout_accounts (keyed by end_user_id: the person's Stripe Connect
--    link) is identity data and still goes with the person.
--
-- Caller: api/routes/rewards.ts after identity proof (host JWT or a verified
-- X-Mushi-User-Token). Service role only.
-- ============================================================================

-- ── 1. keep financial records, unlink the person ─────────────────────────────
alter table public.reward_payouts   alter column end_user_id drop not null;
alter table public.reward_disputes  alter column end_user_id drop not null;

alter table public.reward_payouts   add column if not exists end_user_erased_at timestamptz;
alter table public.reward_disputes  add column if not exists end_user_erased_at timestamptz;

alter table public.reward_payouts
  drop constraint if exists reward_payouts_end_user_id_fkey,
  add constraint reward_payouts_end_user_id_fkey
    foreign key (end_user_id) references public.end_users(id) on delete set null;
alter table public.reward_disputes
  drop constraint if exists reward_disputes_end_user_id_fkey,
  add constraint reward_disputes_end_user_id_fkey
    foreign key (end_user_id) references public.end_users(id) on delete set null;

-- ── 2. erasure ──────────────────────────────────────────────────────────────
create or replace function public.erase_end_user(p_end_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tokens      text[];
  v_page_views  integer := 0;
  v_sessions    integer := 0;
  v_events      integer := 0;
  v_users       integer := 0;
begin
  -- Reporter-token digests from the person's identified sessions: the same
  -- device's anonymous sessions and pre-identify events carry them too.
  select coalesce(array_agg(distinct s.reporter_token_hash) filter (where s.reporter_token_hash is not null), '{}')
    into v_tokens
    from public.end_user_sessions s
   where s.end_user_id = p_end_user_id;

  update public.reward_payouts  set end_user_erased_at = now() where end_user_id = p_end_user_id;
  update public.reward_disputes set end_user_erased_at = now() where end_user_id = p_end_user_id;

  delete from public.session_page_views pv
   using public.end_user_sessions s
   where pv.project_id = s.project_id
     and pv.session_id = s.session_id
     and (s.end_user_id = p_end_user_id or s.reporter_token_hash = any(v_tokens));
  get diagnostics v_page_views = row_count;

  delete from public.end_user_sessions s
   where s.end_user_id = p_end_user_id or s.reporter_token_hash = any(v_tokens);
  get diagnostics v_sessions = row_count;

  delete from public.product_events e
   where e.end_user_id = p_end_user_id or e.anon_id = any(v_tokens);
  get diagnostics v_events = row_count;

  -- Cascades end_user_activity, end_user_points, quest_progress and the payout
  -- account link; unlinks reports, assistant messages, release credits and the
  -- payout / dispute records above.
  delete from public.end_users where id = p_end_user_id;
  get diagnostics v_users = row_count;

  return jsonb_build_object(
    'end_users', v_users,
    'sessions', v_sessions,
    'page_views', v_page_views,
    'product_events', v_events
  );
end;
$fn$;

revoke all on function public.erase_end_user(uuid) from public, anon, authenticated;
grant execute on function public.erase_end_user(uuid) to service_role;
