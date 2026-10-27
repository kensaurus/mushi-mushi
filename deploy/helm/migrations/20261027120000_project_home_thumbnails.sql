/*
FILE: 20261027120000_project_home_thumbnails.sql
PURPOSE: A screenshot of each app's live site for the console Home card
         (api/routes/project-home.ts, _shared/home-thumbnail.ts).

OVERVIEW:
- project_home_thumbnails: one row per app. storage_path is the object in the
  private `app-thumbnails` bucket (<project_id>/home.<png|jpg|webp>, one
  object per app, overwritten on each capture, so no retention sweep is
  needed). last_attempt_at is the capture claim: a conditional update on it
  lets only one caller bill the project's Firecrawl key at a time (Refresh:
  once per 10 minutes; capture on view: once a day).
- Firecrawl's own screenshot URL is never stored; the console reads the
  object through a 1-hour signed URL minted by the api.
- The bucket is service-role only, exactly like 'screenshots', 'voice-intake'
  and 'ux-captures'. Members read the table row; only the service role writes.

Idempotent: safe to re-run. On conflict the bucket caps are refreshed and the
bucket is forced private again.
*/

create table if not exists public.project_home_thumbnails (
  project_id      uuid primary key references public.projects(id) on delete cascade,
  storage_path    text check (storage_path is null or char_length(storage_path) <= 200),
  page_url        text check (page_url is null or char_length(page_url) <= 2000),
  captured_at     timestamptz,
  last_attempt_at timestamptz,
  last_error      text check (last_error is null or char_length(last_error) <= 300),
  updated_at      timestamptz not null default now()
);

comment on table public.project_home_thumbnails is
  'Console Home: the latest screenshot of each app''s live site (private bucket app-thumbnails), captured on the project''s own Firecrawl key.';
comment on column public.project_home_thumbnails.last_attempt_at is
  'Capture claim: set by a conditional update so only one caller captures (and bills the key) at a time.';

alter table public.project_home_thumbnails enable row level security;

drop policy if exists project_home_thumbnails_member_select on public.project_home_thumbnails;
create policy project_home_thumbnails_member_select on public.project_home_thumbnails
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists project_home_thumbnails_service_write on public.project_home_thumbnails;
create policy project_home_thumbnails_service_write on public.project_home_thumbnails
  for all to service_role using (true) with check (true);

revoke all on table public.project_home_thumbnails from anon;
grant select on table public.project_home_thumbnails to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-thumbnails', 'app-thumbnails', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']::text[])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
