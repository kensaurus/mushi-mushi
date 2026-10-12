/*
FILE: 20261012030000_mcp_account_key_selected_projects.sql
PURPOSE: Let an account-level (org-scoped) API key be limited to a chosen set
         of projects, so one MCP OAuth connection can reach "all my projects"
         or "only these projects" (ADR 0026).

OVERVIEW:
  An account key (is_org_scoped = true, project_id NULL) reaches every project
  its owner can reach. allowed_project_ids narrows that: when set, the key
  reaches only the listed projects the owner can still reach (the API
  intersects the two on every request, so a stale id grants nothing and a
  lost membership still removes access). NULL keeps today's behaviour.

  The CHECK keeps the column on account keys only, non-empty, and bounded.
*/

alter table public.project_api_keys
  add column if not exists allowed_project_ids uuid[];

alter table public.project_api_keys
  drop constraint if exists project_api_keys_allowed_projects_account_only;

alter table public.project_api_keys
  add constraint project_api_keys_allowed_projects_account_only check (
    allowed_project_ids is null
    or (is_org_scoped and cardinality(allowed_project_ids) between 1 and 200)
  );

comment on column public.project_api_keys.allowed_project_ids is
  'Account keys only: when set, the key reaches just these projects (intersected '
  'with the owner''s current access on every request). NULL = every project the '
  'owner can reach. See ADR 0026.';
