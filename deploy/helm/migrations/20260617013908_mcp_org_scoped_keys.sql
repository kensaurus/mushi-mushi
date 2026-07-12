-- ---------------------------------------------------------------------------
-- MCP org-scoped API keys
-- ---------------------------------------------------------------------------
-- Phase 2A: Allow a single API key to access multiple projects (account mode).
--
-- Previously, project_api_keys.project_id was NOT NULL, binding every key
-- to exactly one project. An org-scoped key (is_org_scoped = true) has
-- project_id = NULL and gives the caller access to ALL projects owned by
-- owner_user_id. This mirrors how Supabase PATs work.
--
-- Safety: the CHECK constraint below guarantees every row is EITHER
--   project-scoped  (project_id IS NOT NULL AND NOT is_org_scoped), OR
--   org-scoped      (project_id IS NULL AND is_org_scoped = true)
-- — there is no ambiguous "both null" or "both set" state.
--
-- The auth middleware (packages/server/supabase/functions/_shared/auth.ts)
-- is updated in the same PR to handle org-scoped key resolution.
-- ---------------------------------------------------------------------------

-- Pre-condition guard: ensure 0 rows currently have null project_id
-- (they don't, since the column is NOT NULL, but belt-and-suspenders).
do $$
begin
  if exists (select 1 from project_api_keys where project_id is null) then
    raise exception 'Pre-condition failed: project_api_keys already has NULL project_id rows. Inspect before proceeding.';
  end if;
end;
$$;

-- 1. Make project_id nullable ------------------------------------------------
alter table project_api_keys
  alter column project_id drop not null;

-- 2. Add is_org_scoped flag ---------------------------------------------------
alter table project_api_keys
  add column if not exists is_org_scoped boolean not null default false;

-- 3. Exclusivity constraint ---------------------------------------------------
-- Either project-scoped (has project_id, not org) or org-scoped (no project_id, is_org).
alter table project_api_keys
  drop constraint if exists project_api_keys_scope_exclusivity;

alter table project_api_keys
  add constraint project_api_keys_scope_exclusivity check (
    (project_id is not null and not is_org_scoped)
    or
    (project_id is null and is_org_scoped)
  );

-- 4. Update the owner-sync trigger to skip org-scoped keys -------------------
-- Org-scoped keys have owner_user_id set explicitly at insert by the API
-- route (from the JWT subject). The trigger only fires for project-scoped keys.
create or replace function sync_project_api_key_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only auto-derive owner from project for project-scoped keys.
  -- Org-scoped keys have owner_user_id set by the caller at insert time.
  if new.project_id is not null then
    select owner_id into new.owner_user_id
      from projects
      where id = new.project_id;
  end if;
  return new;
end;
$$;

-- 5. Partial index for org-scoped key lookup (auth hot path) -----------------
create index if not exists idx_api_keys_org_scoped
  on project_api_keys (owner_user_id, is_org_scoped, key_hash)
  where is_org_scoped = true and is_active = true;

-- 6. Comment -----------------------------------------------------------------
comment on column project_api_keys.is_org_scoped is
  'When true, project_id IS NULL and this key grants access to ALL projects '
  'owned by owner_user_id. Equivalent to a Supabase Personal Access Token. '
  'Enforced by the scope-exclusivity CHECK constraint and auth middleware.';

comment on column project_api_keys.project_id is
  'The project this key is bound to, or NULL for org-scoped keys. '
  'Nullable since 20260617200000_mcp_org_scoped_keys migration.';
