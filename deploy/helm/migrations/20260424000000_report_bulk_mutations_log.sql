-- ----------------------------------------------------------------------------
-- 20260424000000_report_bulk_mutations_log.sql
-- Wave T.2.4a (2026-04-24): undo-on-bulk for the admin Reports triage UX.
--
-- Triage operators routinely bulk-Dismiss / bulk-Set-status N reports, then
-- realise within seconds that the action was wrong (clicked the wrong filter,
-- mis-read severity, sent legitimate criticals to the bin). The Linear /
-- Gmail pattern is to surface a 10-second "Undo" affordance immediately
-- after the action — we mirror that, but with a generous 10-minute server-
-- side window so the affordance survives a tab refresh or accidental
-- navigation.
--
-- Each row in `report_bulk_mutations` is one bulk apply call:
--   - `payload`  — the user-supplied action and value (`set_status: 'fixed'`).
--   - `prior_state` — array of {id, status, severity, category} snapshots
--     taken *before* applying. The undo path replays these straight back
--     onto the rows, reverting in a single transaction.
--   - `expires_at` (default now() + 10 min) — undo is rejected past this
--     window so we don't time-travel reports days later.
--   - `undone_at`  — non-null once the undo path has run; the same
--     mutation cannot be undone twice.
--
-- RLS: this table is admin-only. Application code uses the service-role
-- client (which bypasses RLS) but we still install owner-scoped policies so
-- a future admin-with-anon-jwt path can't accidentally read another admin's
-- mutation history.
-- ----------------------------------------------------------------------------

create table if not exists report_bulk_mutations (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  action text not null check (action in ('set_status', 'set_severity', 'set_category', 'dismiss')),
  payload jsonb not null,
  prior_state jsonb not null default '[]'::jsonb,
  affected_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  undone_at timestamptz
);

-- Lookup pattern: "show me undoable mutations by this admin, newest first,
-- still within the expiry window". The composite index covers both the
-- admin filter and the recency sort in one b-tree pass.
create index if not exists idx_report_bulk_mutations_admin_expires
  on report_bulk_mutations (admin_id, expires_at desc);

-- Garbage-collect expired mutations after 30 days. The undo path already
-- enforces the 10-minute window at read time, but we don't want this table
-- to grow unbounded. Pg_cron handles the actual cleanup elsewhere — this
-- index keeps the cleanup query cheap.
create index if not exists idx_report_bulk_mutations_expires
  on report_bulk_mutations (expires_at)
  where undone_at is null;

alter table report_bulk_mutations enable row level security;

-- Owner can read their own mutations (drives the undo toast surface and
-- audit trail). Service role bypasses RLS so the API path that records and
-- undoes mutations is unaffected.
-- IMPORTANT: wrap auth.uid() in a subquery so PostgreSQL caches the result for
-- the entire query plan instead of re-evaluating per row. Supabase's
-- performance linter (auth_rls_initplan) flags raw `auth.uid()` calls inside
-- USING / WITH CHECK clauses — see docs/audit-2026-04-23/SUMMARY.md (T10) and
-- migrations 20260418005100, 20260420000200, 20260423040000 for the same
-- pattern applied across the rest of the schema.
drop policy if exists "Owner can read own bulk mutations" on report_bulk_mutations;
create policy "Owner can read own bulk mutations"
  on report_bulk_mutations
  for select
  using (admin_id = (select auth.uid()));

-- No insert/update/delete policies for non-service callers — bulk apply +
-- undo go through the API which uses the service-role client. This keeps
-- the audit log monotonic and prevents tampering.

comment on table report_bulk_mutations is
  'Wave T.2.4a undo-on-bulk log. Each row captures one bulk admin mutation against `reports`, with a snapshot of the prior state so the undo endpoint can revert it within a 10-minute window.';
comment on column report_bulk_mutations.prior_state is
  'JSON array of {id, status, severity, category} snapshots taken before the bulk apply. The undo path replays these straight back onto the rows.';
comment on column report_bulk_mutations.expires_at is
  'After this timestamp the mutation is no longer undoable. Default 10 minutes from creation — matches the Linear / Gmail "Undo" pattern.';
