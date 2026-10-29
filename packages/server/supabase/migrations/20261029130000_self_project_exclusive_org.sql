-- ============================================================================
-- 20261029130000_self_project_exclusive_org
--
-- end_users are unique on (organization_id, external_user_id). The company
-- funnel resolves a console user with that key (resolveSelfEndUser), so every
-- other project in the self project's organization shares its people.
-- Migration 20260922000018 moved the hosted self project into mushi-company.
-- That org was shared again (warnIfSelfOrgShared logs
-- "self organization holds more than one project").
--
-- Repair, hosted only: when the configured self project is the known hosted
-- project, or it still sits in an org this repo reserved (mushi-company /
-- mushi-self*), and that org has another project, move just that project into
-- a new Pro complimentary organization and copy the members. Copy the end
-- users its funnel rows already point at and repoint those rows, so a later
-- upsert from a sibling app does not rewrite the funnel person. Other
-- projects stay where they are. Reports are left on the old end user: reward
-- points and erasure are org identity, not funnel events.
--
-- Then reject the next write that would put a second project in that org, or
-- move the self project into an org that already has one. A self-hosted
-- install that points self_project_id at its own team is not moved and not
-- locked. An already-exclusive org is left untouched. Idempotent.
-- ============================================================================

create or replace function public.company_funnel_project_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $id$
declare
  v_raw text;
  v_id uuid;
  -- Hosted mushi-mushi self project. Absent on self-hosted databases.
  c_hosted constant uuid := '67a6453c-375d-41d7-833a-b33471159442';
begin
  select nullif(trim(value), '') into v_raw
    from public.mushi_runtime_config
   where key = 'self_project_id';
  if v_raw is not null then
    begin
      v_id := v_raw::uuid;
    exception
      when invalid_text_representation then
        v_id := null;
    end;
  end if;
  if v_id is not null then
    return v_id;
  end if;
  if exists (select 1 from public.projects where id = c_hosted) then
    return c_hosted;
  end if;
  return null;
end;
$id$;

comment on function public.company_funnel_project_id() is
  'Configured company-funnel project (mushi_runtime_config.self_project_id), else the hosted self project when that row exists.';

create or replace function public.enforce_self_project_exclusive_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c_hosted constant uuid := '67a6453c-375d-41d7-833a-b33471159442';
  v_self uuid;
  v_slug text;
  v_org uuid;
begin
  -- Renames and other updates must not take the lock or the config read.
  if tg_op = 'UPDATE' and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  v_self := public.company_funnel_project_id();
  if v_self is null then
    return new;
  end if;

  select o.slug into v_slug
    from public.projects p
    join public.organizations o on o.id = p.organization_id
   where p.id = v_self;

  -- Self-hosted teams are not the hosted funnel, even when self_project_id is set.
  if v_self is distinct from c_hosted
     and coalesce(v_slug, '') <> 'mushi-company'
     and coalesce(v_slug, '') not like 'mushi-self%' then
    return new;
  end if;

  if new.id = v_self then
    if exists (
      select 1
        from public.projects p
       where p.organization_id = new.organization_id
         and p.id <> v_self
    ) then
      raise exception 'SELF_ORG_SHARED'
        using errcode = '23514',
              hint = 'The company-funnel project must be the only project in its organization';
    end if;
    return new;
  end if;

  select p.organization_id into v_org
    from public.projects p
   where p.id = v_self;

  if v_org is not null and new.organization_id = v_org then
    raise exception 'SELF_ORG_SHARED'
      using errcode = '23514',
            hint = 'The company-funnel project must be the only project in its organization';
  end if;

  return new;
end;
$fn$;

comment on function public.enforce_self_project_exclusive_org() is
  'Rejects a second project in the hosted company-funnel organization. Raises SELF_ORG_SHARED (23514).';

revoke all on function public.company_funnel_project_id() from public, anon, authenticated;
revoke all on function public.enforce_self_project_exclusive_org() from public, anon, authenticated;

drop trigger if exists trg_projects_self_org_exclusive on public.projects;
create trigger trg_projects_self_org_exclusive
  before insert or update of organization_id on public.projects
  for each row
  execute function public.enforce_self_project_exclusive_org();

do $move$
declare
  c_hosted constant uuid := '67a6453c-375d-41d7-833a-b33471159442';
  v_self uuid;
  v_old uuid;
  v_org uuid;
  v_owner uuid;
  v_project_owner uuid;
  v_org_owner uuid;
  v_slug text;
  v_new_slug text;
  v_count integer;
begin
  v_self := public.company_funnel_project_id();
  if v_self is null then
    return;
  end if;

  select p.organization_id, p.owner_id, o.slug, o.owner_id
    into v_old, v_project_owner, v_slug, v_org_owner
    from public.projects p
    join public.organizations o on o.id = p.organization_id
   where p.id = v_self;
  if not found then
    return;
  end if;

  select count(*) into v_count
    from public.projects
   where organization_id = v_old;
  if v_count <= 1 then
    return;
  end if;

  if v_self is distinct from c_hosted
     and coalesce(v_slug, '') <> 'mushi-company'
     and coalesce(v_slug, '') not like 'mushi-self%' then
    return;
  end if;

  v_owner := coalesce(v_project_owner, v_org_owner);
  if v_owner is null then
    raise notice 'self project % has no owner; left in its shared organization', v_self;
    return;
  end if;

  v_new_slug := 'mushi-self';
  if exists (select 1 from public.organizations where slug = v_new_slug) then
    v_new_slug := 'mushi-self-funnel';
  end if;
  if exists (select 1 from public.organizations where slug = v_new_slug) then
    v_new_slug := 'mushi-self-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  -- Pro + complimentary: a free org would sweep the funnel project's reports.
  insert into public.organizations (slug, name, owner_id, plan_id, is_personal, billing_mode)
  values (v_new_slug, 'Mushi', v_owner, 'pro', false, 'complimentary')
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  select v_org, om.user_id, om.role
    from public.organization_members om
   where om.organization_id = v_old
  on conflict do nothing;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_owner, 'owner')
  on conflict do nothing;

  insert into public.end_users (
    organization_id, external_user_id, email_hash, display_name,
    jwt_provider, jwt_subject, jwt_verified_at, opted_in_to_rewards,
    anti_fraud_flags, first_seen_at, last_seen_at, created_at, updated_at, traits
  )
  select
    v_org, eu.external_user_id, eu.email_hash, eu.display_name,
    eu.jwt_provider, eu.jwt_subject, eu.jwt_verified_at, eu.opted_in_to_rewards,
    eu.anti_fraud_flags, eu.first_seen_at, eu.last_seen_at, eu.created_at, eu.updated_at, eu.traits
    from public.end_users eu
   where eu.organization_id = v_old
     and eu.id in (
       select pe.end_user_id from public.product_events pe
        where pe.project_id = v_self and pe.end_user_id is not null
       union
       select s.end_user_id from public.end_user_sessions s
        where s.project_id = v_self and s.end_user_id is not null
       union
       select m.end_user_id from public.sdk_assistant_messages m
        where m.project_id = v_self and m.end_user_id is not null
     )
  on conflict (organization_id, external_user_id) do nothing;

  -- Move before repointing so the funnel rows follow people in the new org.
  update public.projects
     set organization_id = v_org,
         updated_at = now()
   where id = v_self;

  update public.product_events pe
     set end_user_id = neu.id
    from public.end_users oeu
    join public.end_users neu
      on neu.organization_id = v_org
     and neu.external_user_id = oeu.external_user_id
   where pe.project_id = v_self
     and pe.end_user_id = oeu.id
     and oeu.organization_id = v_old;

  update public.end_user_sessions s
     set end_user_id = neu.id
    from public.end_users oeu
    join public.end_users neu
      on neu.organization_id = v_org
     and neu.external_user_id = oeu.external_user_id
   where s.project_id = v_self
     and s.end_user_id = oeu.id
     and oeu.organization_id = v_old;

  update public.sdk_assistant_messages m
     set end_user_id = neu.id
    from public.end_users oeu
    join public.end_users neu
      on neu.organization_id = v_org
     and neu.external_user_id = oeu.external_user_id
   where m.project_id = v_self
     and m.end_user_id = oeu.id
     and oeu.organization_id = v_old;
end;
$move$;
