-- Document spec-compliant fix branch naming convention (Jun 2026).
-- Validation is enforced in API (validateFixBranchTemplate) and generateFixBranchName.
-- Pattern: <type>/MUSHI-<report-uuid>-<slug>
-- Types: feature|bugfix|hotfix|refactor|chore|docs|test|ci

comment on column project_settings.fix_branch_template is
  'Optional branch template. Tokens: {date}, {category}, {shortId}, {reportId}, {slug}. '
  'Must compile to <type>/MUSHI-<uuid>-<slug> when set. NULL uses server default.';
