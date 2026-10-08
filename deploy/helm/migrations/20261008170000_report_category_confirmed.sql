-- A person confirmed this report's category in triage (PATCH category).
-- A reporter's feature request may be dispatched to auto-fix once a person
-- confirms a defect category; before this column, the only signal was a
-- category that differed from the classifier's, so agreeing with the
-- classifier ("yes, it is visual") could never unblock it.
alter table public.reports
  add column if not exists category_confirmed_at timestamptz,
  add column if not exists category_confirmed_by uuid;

comment on column public.reports.category_confirmed_at is
  'When a console user set the category in triage. Unblocks dispatch for a reporter feature request with a non-other category.';
