-- FILE: 20260509000002_webhook_audit_log.sql
-- PURPOSE: webhook_audit_log table for intrusion detection and replay-attack
--          prevention. Every inbound webhook (Sentry, GitHub, Jira, PagerDuty,
--          and future sources) writes a row here BEFORE processing.
--
--          Rows are used for:
--          1. Rate limiting: count rows per source_ip + webhook_source in the
--             last 60s via a DB query (or in-memory sliding window in the edge fn).
--          2. Replay detection: reject requests where the same
--             (webhook_source, delivery_id) already appears within the last 24h.
--          3. Audit trail: operators can query which IPs sent malformed / rejected
--             webhooks, which events were consumed, and the end-to-end latency.
--
--          Rows older than 30 days are swept by the retention-sweep edge function.
--
-- SEC: This table intentionally does NOT store the raw request body — doing so
--      would log API tokens and user content embedded in Sentry/GitHub payloads.
--      We store a SHA-256 of the body for idempotency without storing PII.

create table if not exists public.webhook_audit_log (
  id                uuid primary key default gen_random_uuid(),

  -- Which integration produced this webhook
  webhook_source    text not null
    check (webhook_source in (
      'sentry', 'sentry_seer', 'github', 'jira', 'pagerduty',
      'linear', 'slack', 'discord', 'datadog', 'new_relic',
      'honeycomb', 'opsgenie', 'cloudwatch', 'bugsnag', 'rollbar',
      'crashlytics', 'firebase_analytics', 'openai', 'unknown'
    )),

  -- The vendor's delivery ID (X-GitHub-Delivery, sentry-hook-resource-id, etc.)
  -- NULL when the vendor does not provide a delivery ID.
  delivery_id       text,

  -- SHA-256 of the raw request body (hex) for replay detection + idempotency.
  body_hash         text not null,

  -- Outcome after signature verification + processing
  outcome           text not null default 'pending'
    check (outcome in ('pending', 'accepted', 'rejected_signature', 'rejected_rate_limit', 'rejected_replay', 'error')),

  -- The project that received this webhook (NULL = could not determine)
  project_id        uuid references public.projects(id) on delete set null,

  -- Source IP (from X-Forwarded-For or CF-Connecting-IP)
  source_ip         inet,

  -- HTTP method, path, and response code written after processing completes
  http_method       text not null default 'POST',
  http_path         text,
  response_status   smallint,

  -- Processing latency in ms (written on completion)
  duration_ms       integer,

  -- Error message when outcome = 'error' or 'rejected_*'
  error_message     text,

  created_at        timestamptz not null default now()
);

-- Primary query patterns
create index webhook_audit_log_source_ip_idx  on public.webhook_audit_log (source_ip, webhook_source, created_at desc);
create index webhook_audit_log_source_ts_idx  on public.webhook_audit_log (webhook_source, created_at desc);
create index webhook_audit_log_delivery_idx   on public.webhook_audit_log (webhook_source, delivery_id) where delivery_id is not null;
create index webhook_audit_log_project_idx    on public.webhook_audit_log (project_id, created_at desc) where project_id is not null;

-- Row-level security: edge functions use service role (bypass RLS).
-- No direct client access needed.
--
-- Every policy wraps `auth.role()` / `auth.uid()` / `auth.jwt()` in a
-- `(select …)` subquery so Postgres evaluates them ONCE at planning time
-- (initplan) instead of per row. Supabase advisor lint 0003. The savings
-- become significant on this table because operator dashboards typically
-- scan thousands of audit rows per page.
--
-- Super-admin role lives in `auth.users.raw_app_meta_data.role`, surfaced
-- to the JWT under `app_metadata.role`. We deliberately do NOT join
-- `public.profiles` for the role check — that table is operator-managed
-- application data and was not present at the time these audit rows were
-- introduced; the JWT path also avoids one read per RLS evaluation.
alter table public.webhook_audit_log enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_audit_log'
      and policyname = 'service role full access'
  ) then
    create policy "service role full access" on public.webhook_audit_log
      for all
      using       ((select auth.role()) = 'service_role')
      with check  ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_audit_log'
      and policyname = 'operator read own project'
  ) then
    -- The original migration used `org_members` / `projects.org_id` which
    -- never existed in this schema (the actual tables are
    -- `organization_members` / `projects.organization_id`), so this policy
    -- silently failed to apply for the lifetime of the table. Fixed here so
    -- AuditPage / IntegrationsPage can scope rows to the caller's orgs.
    create policy "operator read own project" on public.webhook_audit_log
      for select using (
        project_id in (
          select id from public.projects
          where organization_id in (
            select organization_id from public.organization_members
            where user_id = (select auth.uid())
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_audit_log'
      and policyname = 'super admin read all'
  ) then
    create policy "super admin read all" on public.webhook_audit_log
      for select using (
        ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'super_admin'
      );
  end if;
end $$;
