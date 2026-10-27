-- Review follow-ups (ADR 0032 amendment, 2026-10-23): the Cursor model for a
-- PR's last follow-up round. Null keeps every round on review_followup_model.
alter table public.organizations
  add column if not exists review_followup_escalation_model text;

comment on column public.organizations.review_followup_escalation_model is
  'Cursor model spec (id?param=value) for the last follow-up round on a PR; null = same as review_followup_model (ADR 0032 amendment 2026-10-23).';
