-- Plan 025 follow-up (2026-11-27): the four foreign keys the performance
-- advisor flagged on today's tables, and least-privilege grants on the tables
-- members read under RLS.
--
-- 1. unindexed_foreign_keys (INFO). Each FK below had no covering index, so a
--    delete of the parent row (an auth user, a project) scans the child table.
--      project_personas.created_by      (20261127150100) -> auth.users, on delete set null
--      llm_run_reservations.created_by  (20261127150100) -> auth.users, on delete set null
--      ux_baselines.created_by          (20261127130000) -> auth.users, on delete set null
--      release_kit_assets.project_id    (20261127140000) -> projects,   on delete cascade
--    The tables are small, so a plain CREATE INDEX (db push runs each file in a
--    transaction, which CONCURRENTLY cannot use).
--
-- 2. pg_graphql_authenticated_table_exposed (WARN, aggregated). Policy, kept:
--    a table members read under RLS keeps SELECT for `authenticated`, so it
--    stays visible in the authenticated GraphQL schema. RLS decides the rows
--    (20260527020000 section 6: "We deliberately do NOT revoke from
--    authenticated"). ADR 0073 decision 1 says members read project_personas
--    under private.is_project_member, and the 0072/0074 migrations grant member
--    SELECT on ux_baselines, release_kits and release_kit_assets the same way.
--    Tables only the service role touches revoke both roles instead
--    (20260430010001 migration_progress, 20260615051757, llm_run_reservations).
--
--    What this file does fix: write privileges nothing uses. RLS has no
--    authenticated write policy on these tables, but TRUNCATE is not covered
--    by RLS, and agent_personas still carried anon's default DML grants. Every
--    write goes through the service client (routes/ux-timeline.ts,
--    personas.ts, pdca.ts, packages/agents/src/pdca.ts).

set lock_timeout = '5s';

create index if not exists project_personas_created_by_idx
  on public.project_personas (created_by);
create index if not exists llm_run_reservations_created_by_idx
  on public.llm_run_reservations (created_by);
create index if not exists ux_baselines_created_by_idx
  on public.ux_baselines (created_by);
create index if not exists release_kit_assets_project_id_idx
  on public.release_kit_assets (project_id);

-- Members keep SELECT (RLS: authenticated_read_personas / *_member_select).
revoke insert, update, delete, truncate, references, trigger on table public.agent_personas from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.ux_baselines from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.project_personas from anon, authenticated;
grant select on table public.agent_personas to authenticated;
grant select on table public.ux_baselines to authenticated;
grant select on table public.project_personas to authenticated;

notify pgrst, 'reload schema';
