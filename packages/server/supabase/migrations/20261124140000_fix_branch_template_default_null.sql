-- New projects got fix_branch_template = 'mushi/fix/{date}-{category}-{shortId}'
-- from the column default: the pattern the MUSHI-<uuid>-<slug> convention
-- (20260623131542) rejects and 20260624142449 cleared from existing rows, but
-- the default itself was never changed. Every project created since then opened
-- Settings on "Fix branch pattern no longer allowed" (fresh-account walk,
-- 2026-11-24). NULL means "use the server default", which the column comment
-- already documents.
alter table public.project_settings alter column fix_branch_template set default null;
