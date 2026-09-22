-- ============================================================================
-- 20260922000019_reporter_key_verifier
--
-- Store a one-way verifier of the reporter credential, not the credential.
--
-- SDKs authenticate to the reporter-thread routes (/v1/reporter/*) with the
-- SHA-256 digest of their reporter token (X-Reporter-Token-Hash; the HMAC
-- beside it is keyed by the public API key, so the digest alone passes). Every
-- reporter table stored that same digest, so any value an org member could
-- read (the console shows it with a copy button) or an integration echoed
-- could be replayed to read an end user's threads and reply as them.
--
-- Storage now holds `rk1_` || sha256(digest) — public.mushi_reporter_key — the
-- same value the api derives from whatever the client presents
-- (_shared/reporter-token.ts). The wire protocol is unchanged, so installed
-- SDKs keep working. A stored key presented back is not a digest, is hashed
-- as a raw token, and matches nothing.
--
-- mushi.rekey_reporter_tokens() converts every stored digest (64 lowercase
-- hex) and leaves sentinels ('cron:library', 'voice-intake', 'tester:<id>',
-- ...) and existing keys alone, so it is idempotent: run it again after the
-- api deploy to convert rows the previous api version wrote in between. On
-- the unique-keyed tables a row whose converted twin already exists is left
-- as it is and counted in `skipped`; resolve those by hand.
--
-- mushi_link_reporter_token is callable by any signed-in user; it now derives
-- the key itself, so a stored key copied from the console claims nothing.
-- ============================================================================

create or replace function public.mushi_reporter_key(p_presented text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'rk1_' || encode(
    sha256(convert_to(
      case
        when p_presented ~* '^[0-9a-f]{64}$' then lower(p_presented)
        else encode(sha256(convert_to(p_presented, 'UTF8')), 'hex')
      end,
      'UTF8')),
    'hex')
$$;

comment on function public.mushi_reporter_key(text) is
  'Stored reporter key for a client-presented reporter token or its SHA-256 hex digest: rk1_ || sha256(digest). SQL twin of reporterKey() in _shared/reporter-token.ts.';

revoke all on function public.mushi_reporter_key(text) from public, anon, authenticated;
grant execute on function public.mushi_reporter_key(text) to service_role;

create or replace function public.mushi_link_reporter_token(p_reporter_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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

  update public.reports
  set    tester_id = v_tester_id
  where  reporter_token_hash = public.mushi_reporter_key(p_reporter_token_hash)
    and  (tester_id is null or tester_id = v_tester_id);

  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'linked', v_updated);
end;
$$;

create or replace function mushi.rekey_reporter_tokens()
returns table (table_name text, converted bigint, skipped bigint)
language plpgsql
set search_path = ''
as $$
declare
  n bigint;
  s bigint;
begin
  -- Rekeying is not an edit: keep updated_at (and "recently updated" views)
  -- as they were.
  alter table public.reports disable trigger reports_updated_at;
  alter table public.reporter_devices disable trigger trg_reporter_devices_updated_at;
  alter table public.reporter_notifications disable trigger trg_reporter_notifications_updated_at;
  alter table public.reporter_reputation disable trigger set_reporter_reputation_updated_at;
  alter table public.support_tickets disable trigger trg_support_tickets_updated_at;

  -- Plain columns
  update public.reports set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'reports'; converted := n; skipped := 0; return next;

  update public.end_user_sessions set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'end_user_sessions'; converted := n; skipped := 0; return next;

  update public.anti_gaming_events set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'anti_gaming_events'; converted := n; skipped := 0; return next;

  update public.notification_deliveries set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'notification_deliveries'; converted := n; skipped := 0; return next;

  update public.reporter_notifications set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'reporter_notifications'; converted := n; skipped := 0; return next;

  update public.report_comments set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'report_comments'; converted := n; skipped := 0; return next;

  update public.sdk_assistant_messages set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'sdk_assistant_messages'; converted := n; skipped := 0; return next;

  update public.support_tickets set reporter_token_hash = public.mushi_reporter_key(reporter_token_hash)
   where reporter_token_hash ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'support_tickets'; converted := n; skipped := 0; return next;

  update public.product_events set anon_id = public.mushi_reporter_key(anon_id)
   where anon_id ~ '^[0-9a-f]{64}$';
  get diagnostics n = row_count; table_name := 'product_events.anon_id'; converted := n; skipped := 0; return next;

  -- Unique-keyed columns: never merge two reporters' rows silently.
  update public.reporter_reputation t set reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash)
   where t.reporter_token_hash ~ '^[0-9a-f]{64}$'
     and not exists (select 1 from public.reporter_reputation x
                      where x.project_id = t.project_id
                        and x.reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash));
  get diagnostics n = row_count;
  select count(*) into s from public.reporter_reputation where reporter_token_hash ~ '^[0-9a-f]{64}$';
  table_name := 'reporter_reputation'; converted := n; skipped := s; return next;

  update public.reporter_notification_prefs t set reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash)
   where t.reporter_token_hash ~ '^[0-9a-f]{64}$'
     and not exists (select 1 from public.reporter_notification_prefs x
                      where x.project_id = t.project_id
                        and x.reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash));
  get diagnostics n = row_count;
  select count(*) into s from public.reporter_notification_prefs where reporter_token_hash ~ '^[0-9a-f]{64}$';
  table_name := 'reporter_notification_prefs'; converted := n; skipped := s; return next;

  update public.reporter_push_subscriptions t set reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash)
   where t.reporter_token_hash ~ '^[0-9a-f]{64}$'
     and not exists (select 1 from public.reporter_push_subscriptions x
                      where x.project_id = t.project_id
                        and x.endpoint = t.endpoint
                        and x.reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash));
  get diagnostics n = row_count;
  select count(*) into s from public.reporter_push_subscriptions where reporter_token_hash ~ '^[0-9a-f]{64}$';
  table_name := 'reporter_push_subscriptions'; converted := n; skipped := s; return next;

  update public.feature_request_reporter_votes t set reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash)
   where t.reporter_token_hash ~ '^[0-9a-f]{64}$'
     and not exists (select 1 from public.feature_request_reporter_votes x
                      where x.request_id = t.request_id
                        and x.reporter_token_hash = public.mushi_reporter_key(t.reporter_token_hash));
  get diagnostics n = row_count;
  select count(*) into s from public.feature_request_reporter_votes where reporter_token_hash ~ '^[0-9a-f]{64}$';
  table_name := 'feature_request_reporter_votes'; converted := n; skipped := s; return next;

  update public.experiment_assignments t set reporter_token = public.mushi_reporter_key(t.reporter_token)
   where t.reporter_token ~ '^[0-9a-f]{64}$'
     and not exists (select 1 from public.experiment_assignments x
                      where x.experiment_id = t.experiment_id
                        and x.reporter_token = public.mushi_reporter_key(t.reporter_token));
  get diagnostics n = row_count;
  select count(*) into s from public.experiment_assignments where reporter_token ~ '^[0-9a-f]{64}$';
  table_name := 'experiment_assignments'; converted := n; skipped := s; return next;

  -- Anti-fraud device rows keep a list; convert each element, keep first-seen
  -- order, drop a duplicate the conversion creates.
  update public.reporter_devices d
     set reporter_tokens = (
       select array_agg(k order by first_ord)
         from (select case when x ~ '^[0-9a-f]{64}$' then public.mushi_reporter_key(x) else x end as k,
                      min(ord) as first_ord
                 from unnest(d.reporter_tokens) with ordinality as u(x, ord)
                group by 1) keyed)
   where exists (select 1 from unnest(d.reporter_tokens) as x where x ~ '^[0-9a-f]{64}$');
  get diagnostics n = row_count; table_name := 'reporter_devices.reporter_tokens'; converted := n; skipped := 0; return next;

  alter table public.reports enable trigger reports_updated_at;
  alter table public.reporter_devices enable trigger trg_reporter_devices_updated_at;
  alter table public.reporter_notifications enable trigger trg_reporter_notifications_updated_at;
  alter table public.reporter_reputation enable trigger set_reporter_reputation_updated_at;
  alter table public.support_tickets enable trigger trg_support_tickets_updated_at;
end;
$$;

comment on function mushi.rekey_reporter_tokens() is
  'Idempotent: converts stored reporter-token digests to mushi_reporter_key(). Run after migration 20260922000019 and again once the matching api is deployed.';

revoke all on function mushi.rekey_reporter_tokens() from public, anon, authenticated;

select * from mushi.rekey_reporter_tokens();

comment on column public.reports.reporter_token_hash is
  'One-way reporter key: rk1_ || sha256(sha256(token)) (public.mushi_reporter_key). Not a credential; sentinels such as cron:<job> are not keys.';
comment on column public.end_user_sessions.reporter_token_hash is
  'One-way reporter key (public.mushi_reporter_key); never the token or its digest.';
comment on column public.product_events.anon_id is
  'One-way key of the anonymous id the SDK sent (public.mushi_reporter_key); never the raw value.';
