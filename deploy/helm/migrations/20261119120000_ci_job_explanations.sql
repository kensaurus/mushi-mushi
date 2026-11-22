-- Plain-English explanations of failed CI jobs, one per job attempt (2026-11-19, ADR 0033 amendment).
--
-- The console's CI page has an "Explain" button on a failed job: OpenAI's mini model reads the
-- screened log excerpt and answers with a cause, one next step and code / flaky / infra
-- (api/routes/ci-job-debug.ts). The answer is kept so a second view of the same attempt costs
-- nothing. Only the model's short answer is stored: never log text.
--
-- Keyed by the ci_jobs row (unique per project, job and attempt), so a re-run is a new row and a
-- new explanation, and rows go when ci_jobs drops the job (kept 30 days).
--
-- Service role only: the api edge function reads and writes it after checking the caller may read
-- the job's project. Until this is applied the route answers from an in-memory cache.

create table if not exists public.ci_job_explanations (
  ci_job_id   uuid primary key references public.ci_jobs(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  cause       text not null check (char_length(cause) between 1 and 400),
  next_step   text not null check (char_length(next_step) between 1 and 300),
  kind        text not null check (kind in ('code', 'flaky', 'infra', 'cancelled')),
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ci_job_explanations_project on public.ci_job_explanations (project_id, created_at desc);

alter table public.ci_job_explanations enable row level security;
revoke all on table public.ci_job_explanations from public, anon, authenticated;
grant select, insert, update, delete on table public.ci_job_explanations to service_role;

comment on table public.ci_job_explanations is
  'Cached plain-English explanation of a failed CI job attempt (cause, next step, kind, model). Written by the api edge function (POST /v1/admin/ci/jobs/:id/explain, service role); no log text is stored.';
