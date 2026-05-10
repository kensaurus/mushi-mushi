-- ============================================================
-- Verify-steps correlation
-- ============================================================
--
-- Adds a structured verification blob to `fix_attempts` and a stable
-- foreign-key link from `fix_verifications` back to the attempt that
-- produced the PR. Motivated by the 2026-04-21 audit finding that the
-- judge could not answer "did attempt X actually verify?" without
-- stitching `fix_verifications` rows to `fix_attempts` rows via
-- `report_id` + timestamps — a brittle join that silently picks the
-- wrong row when two attempts land within the same minute.
--
-- Shape of `verify_steps` JSONB (written by @mushi-mushi/verify):
--   {
--     "status": "passed" | "failed" | "error",
--     "visualDiffScore": number,
--     "attachedSteps": Array<{ raw?: string } | { action, target?, value? }>,
--     "interactionResults": Array<{ step, success, action, ... }>,
--     "verifiedAt": ISO8601 string,
--     "errorMessage"?: string
--   }
--
-- Keep it fully JSONB — downstream consumers (Prompt Lab, Judge page)
-- introspect it with `jsonb_path_query`, so we deliberately don't shard
-- it into typed columns.

alter table if exists fix_attempts
  add column if not exists verify_steps jsonb;

comment on column fix_attempts.verify_steps is
  'Structured verification result from @mushi-mushi/verify runs against this attempt. See migration 20260422120000 for shape.';

alter table if exists fix_verifications
  add column if not exists fix_attempt_id uuid
    references fix_attempts(id) on delete set null;

create index if not exists idx_fix_verif_attempt
  on fix_verifications(fix_attempt_id)
  where fix_attempt_id is not null;

comment on column fix_verifications.fix_attempt_id is
  'Attempt that produced the PR being verified. Null only for verifications run against reports without a matching attempt (e.g. manual repro checks).';
