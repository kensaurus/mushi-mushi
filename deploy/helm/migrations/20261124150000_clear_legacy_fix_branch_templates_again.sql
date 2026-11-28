-- 20260624142449 cleared the legacy 'mushi/fix/...' templates, but the column
-- default kept writing the same value into every new project until
-- 20261124140000. Nine projects carried it again and opened Settings on "Fix
-- branch pattern no longer allowed". generateFixBranchName already falls back
-- to the server default for them, so NULL (the server default) changes nothing
-- about the branches fixes use. Owner approved the cleanup 2026-11-24.
update public.project_settings
set fix_branch_template = null,
    updated_at = now()
where fix_branch_template like 'mushi/fix/%';
