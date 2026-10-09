-- ============================================================================
-- 20260922000018_self_project_own_org
--
-- The hosted mushi-mushi self project (MUSHI_SELF_PROJECT_ID, the company
-- funnel) shared the founder's personal organization with six customer-style
-- apps. end_users are organization-scoped, so console identify() rows and the
-- founder apps' end users lived in one namespace, and org-level settings made
-- for those apps applied to the company funnel too.
--
-- Give the self project its own organization: same owner and members, Pro
-- plan (retention resolves from the org plan; a free org would sweep the self
-- project's reports after 7 days), complimentary billing.
--
-- Hosted-only data move. Applied to production on 2026-09-22; this file is
-- idempotent and does nothing where the self project does not exist
-- (self-hosted installs, fresh databases).
-- ============================================================================

do $$
declare
  v_self  uuid := '67a6453c-375d-41d7-833a-b33471159442';
  v_owner uuid := 'eb0c15cc-4139-490b-a335-35b3d87428df';
  v_old   uuid;
  v_org   uuid;
begin
  select organization_id into v_old from public.projects where id = v_self;
  if not found then
    return;
  end if;

  select id into v_org from public.organizations where slug = 'mushi-company';
  if v_org is null then
    insert into public.organizations (slug, name, owner_id, plan_id, is_personal, billing_mode)
    values ('mushi-company', 'Mushi Mushi', v_owner, 'pro', false, 'complimentary')
    returning id into v_org;
  end if;

  if v_old is distinct from v_org then
    insert into public.organization_members (organization_id, user_id, role)
    select v_org, om.user_id, om.role
      from public.organization_members om
     where om.organization_id = v_old
    on conflict do nothing;

    update public.projects set organization_id = v_org, updated_at = now() where id = v_self;
  end if;
end $$;
