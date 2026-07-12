-- Clear legacy fix_branch_template values that predate the MUSHI-<uuid>-<slug> convention.
-- generateFixBranchName now falls back to the default when a custom template is invalid.

UPDATE project_settings
SET fix_branch_template = NULL,
    updated_at = now()
WHERE fix_branch_template LIKE 'mushi/fix/%';
