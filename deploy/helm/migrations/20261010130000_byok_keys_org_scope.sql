-- AI keys shared by every app in an organization (ADR 0023).
--
-- A key belonged to one project, so one Firecrawl or Anthropic key had to be
-- pasted into each app; glot.it had a working Firecrawl key and the other
-- eight apps had none (2026-10-10). A byok_keys row now belongs to exactly
-- one owner: a project (as before) or an organization. resolveLlmKeys uses a
-- project's own keys first, then its organization's.
--
-- Additive: every existing row keeps its project_id and organization_id is
-- null, so a reader that still filters on project_id sees exactly what it
-- saw before and never an organization key.

alter table public.byok_keys
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.byok_keys alter column project_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.byok_keys'::regclass and conname = 'byok_keys_one_owner_check'
  ) then
    alter table public.byok_keys
      add constraint byok_keys_one_owner_check check ((project_id is null) <> (organization_id is null));
  end if;
end $$;

create index if not exists idx_byok_keys_org_active_ordered
  on public.byok_keys (organization_id, provider_slug, priority)
  where status = 'active' and organization_id is not null;

-- Members of the organization can see (not read the secret of) its keys, as
-- they can see their project's. Writes stay service-role only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'byok_keys' and policyname = 'byok_keys_org_member_select'
  ) then
    create policy byok_keys_org_member_select on public.byok_keys
      for select to authenticated
      using (organization_id is not null and (select private.is_org_member(organization_id)));
  end if;
end $$;

comment on column public.byok_keys.organization_id is
  'Set for a key shared by every project in the organization; project_id is then null.';
