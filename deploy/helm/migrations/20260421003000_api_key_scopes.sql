-- ---------------------------------------------------------------------------
-- API key scopes for MCP
-- ---------------------------------------------------------------------------
-- Before this migration project_api_keys.scopes defaulted to '{report:write}'
-- and was never actually consulted — `apiKeyAuth` only checked `is_active`.
-- The MCP server (packages/mcp) now needs to hit /v1/admin/* routes that were
-- previously JWT-only, so we promote `scopes` from a purely advisory array
-- into an enforced capability list with a well-defined vocabulary.
--
-- Scope vocabulary:
--   report:write  — SDK ingest (existing behaviour; still the default for
--                   keys minted pre-MCP and for new project bootstrap keys).
--   mcp:read      — MCP read tools (get_recent_reports, get_report_detail,
--                   get_blast_radius, project://dashboard, …).
--   mcp:write     — MCP mutating tools (dispatch_fix, trigger_judge,
--                   transition_status, submit_fix_result). Always implies
--                   mcp:read — enforced in auth middleware.
--
-- We also denormalise the project owner id onto the key row so the auth
-- middleware can resolve "the user this request executes as" in a single
-- keyed SELECT instead of chaining through projects every time. The
-- denormalised column is kept honest by a trigger in this same migration.
-- ---------------------------------------------------------------------------

-- 1. Owner denormalisation -------------------------------------------------
alter table project_api_keys
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

update project_api_keys k
  set owner_user_id = p.owner_id
  from projects p
  where p.id = k.project_id
    and k.owner_user_id is null;

create or replace function sync_project_api_key_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select owner_id into new.owner_user_id
    from projects
    where id = new.project_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_project_api_key_owner on project_api_keys;
create trigger trg_sync_project_api_key_owner
  before insert or update of project_id on project_api_keys
  for each row execute function sync_project_api_key_owner();

create index if not exists idx_api_keys_owner on project_api_keys(owner_user_id);

-- 2. Scope CHECK constraint ------------------------------------------------
-- Accept only known scopes. Rejecting unknown strings early stops
-- "ghost" scopes from silently granting (or failing to grant) access.
alter table project_api_keys
  drop constraint if exists project_api_keys_scopes_valid;

alter table project_api_keys
  add constraint project_api_keys_scopes_valid
  check (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write']::text[]
    and cardinality(scopes) > 0
  );

-- 3. Helper: does a key row grant a given scope? ---------------------------
-- mcp:write implies mcp:read. Written as a pure SQL function so the RLS
-- policies below can reuse it without re-inlining the implication logic.
create or replace function api_key_has_scope(p_scopes text[], p_required text)
returns boolean
language sql
immutable
as $$
  select case
    when p_required = 'mcp:read'
      then ('mcp:read' = any(p_scopes) or 'mcp:write' = any(p_scopes))
    else p_required = any(p_scopes)
  end;
$$;

comment on function api_key_has_scope(text[], text) is
  'True iff p_scopes grants p_required. mcp:write implies mcp:read.';

-- 4. Note ------------------------------------------------------------------
-- RLS on project_api_keys is owner-scoped already via existing policies.
-- No new policies needed; the middleware enforces scopes at request time
-- with a constant-time membership check against the row we just fetched.
