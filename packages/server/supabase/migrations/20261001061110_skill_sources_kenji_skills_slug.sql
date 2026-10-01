-- ============================================================================
-- 20261001061110_skill_sources_kenji_skills_slug
--
-- The skill pack behind Skill Pipelines was renamed on 2026-10-01:
-- github.com/kensaurus/cursor-kenji is now github.com/kensaurus/skills
-- ("kenji skills"). Same repo id (1152689029), same skills/*/SKILL.md layout.
--
-- Rows still saying kensaurus/cursor-kenji keep syncing for now: skill-sync
-- calls api.github.com without `redirect: 'manual'`, GitHub answers the old
-- slug with a same-origin 301 to /repositories/1152689029/..., and fetch
-- follows it with the Authorization header intact. But every tree and blob
-- call then costs two requests against the GitHub rate limit, and the
-- redirect dies for good if anyone creates a new repo at the old name. So
-- point the rows at the new slug.
--
-- Slugs are compared case-insensitively throughout (GitHub's are), while
-- UNIQUE (project_id, repo_slug) is case-sensitive. That is why each step is
-- its own statement: Postgres checks that constraint row by row, and the
-- order of data-modifying CTEs within one statement is not defined.
--
-- 1. Merge an empty replacement. A project that has an old-slug row and also
--    added kensaurus/skills, where the new row is enabled, is the project's
--    only kensaurus/skills row, and owns no agent_skills rows at all (never
--    synced, or synced nothing): the new row is deleted and the old row takes
--    its ref and enabled = true, then step 2 renames the old row. The result
--    is the new row the owner asked for, keeping the old row's id, catalog
--    and content hashes. Deleting a source that owns no skills loses nothing
--    (last_synced_* describe a sync that found no skills; the old row's own
--    values stay); it is the only DELETE here, and its WHERE re-checks that
--    the row owns none.
--
-- 2. Rename in place. A project with an old-slug row and no kensaurus/skills
--    row gets that row renamed (the enabled one first, then the oldest, if a
--    project somehow holds two that differ only in case; step 3 handles the
--    other). In place, not delete + re-add: agent_skills.source_id is
--    ON DELETE SET NULL, so a delete would leave every catalog row the source
--    owns with a NULL source (which the column reserves for manually created
--    skills), and a re-add would embed every skill again. Renaming keeps
--    source_id, ref, enabled and the content hashes, so the next sync skips
--    every unchanged file.
--
-- 3. Projects that still have BOTH rows: the kensaurus/skills row already
--    owns skills (the owner synced it), or it is disabled. Nothing is deleted.
--    The old row is retired only when the project's kensaurus/skills row is
--    enabled:
--      - skill_sources.enabled = false, so skill-sync (which loads enabled
--        rows only) stops fetching the same repo twice, and last_sync_error
--        says why (the Sources tab prints it under the row, in the error
--        colour; no sync clears it because disabled rows are never synced);
--      - its agent_skills rows go is_active = false, but only for slugs the
--        project's kensaurus/skills row already has active. Slugs only the
--        old source has stay active.
--    Why deactivate rather than leave or delete: the readers look a skill up
--    by slug alone with .maybeSingle(), with no project filter
--    (api/routes/skills.ts, _shared/skill-packet.ts, classify-report), so two
--    active rows for one slug make that lookup return nothing. This removes
--    the duplicates the rename itself creates (one repo synced twice by one
--    project); duplicates between projects predate it and are not touched.
--    Deactivating keeps the rows and their source_id (no orphans; pipeline
--    runs store slugs, not agent_skills ids), and is undone by setting
--    is_active and enabled back to true.
--    If the project's kensaurus/skills row is disabled, both rows are left
--    exactly as they are: the owner turned the new one off on purpose.
--
-- 4. The table comment claimed skill-sync seeds kensaurus/cursor-kenji for
--    new projects. No code ever did: rows only come from the admin Sources
--    tab (POST /v1/admin/skills/sources). Say that, and name the new slug.
--
-- Re-running changes nothing: after one run no project matches step 2, step 1
-- skips old rows step 3 already retired (by their last_sync_error text), and
-- step 3 re-applies the same flags.
-- ============================================================================

-- 1a. Hand the empty replacement's settings to the old row that will take
--     its place (same choice of row as step 2 makes).
with empty_replacement as (
  select t.project_id, t.ref
    from public.skill_sources t
   where lower(t.repo_slug) = 'kensaurus/skills'
     and t.enabled
     and not exists (select 1 from public.agent_skills a where a.source_id = t.id)
     and not exists (
           select 1
             from public.skill_sources u
            where u.project_id = t.project_id
              and lower(u.repo_slug) = 'kensaurus/skills'
              and u.id <> t.id
         )
     and exists (
           select 1
             from public.skill_sources s
            where s.project_id = t.project_id
              and lower(s.repo_slug) = 'kensaurus/cursor-kenji'
              and s.last_sync_error is distinct from 'Retired: kensaurus/cursor-kenji was renamed to kensaurus/skills, which this project already syncs.'
         )
),
keeper as (
  select distinct on (s.project_id) s.id, e.ref
    from public.skill_sources s
    join empty_replacement e on e.project_id = s.project_id
   where lower(s.repo_slug) = 'kensaurus/cursor-kenji'
     and s.last_sync_error is distinct from 'Retired: kensaurus/cursor-kenji was renamed to kensaurus/skills, which this project already syncs.'
   order by s.project_id, s.enabled desc, s.created_at, s.id
)
update public.skill_sources s
   set ref = k.ref,
       enabled = true
  from keeper k
 where s.id = k.id;

-- 1b. Delete the empty replacement (same conditions as 1a; it owns no skills).
delete from public.skill_sources t
 where lower(t.repo_slug) = 'kensaurus/skills'
   and t.enabled
   and not exists (select 1 from public.agent_skills a where a.source_id = t.id)
   and not exists (
         select 1
           from public.skill_sources u
          where u.project_id = t.project_id
            and lower(u.repo_slug) = 'kensaurus/skills'
            and u.id <> t.id
       )
   and exists (
         select 1
           from public.skill_sources s
          where s.project_id = t.project_id
            and lower(s.repo_slug) = 'kensaurus/cursor-kenji'
            and s.last_sync_error is distinct from 'Retired: kensaurus/cursor-kenji was renamed to kensaurus/skills, which this project already syncs.'
       );

-- 2. Rename in place where the project has no kensaurus/skills row.
with keeper as (
  select distinct on (s.project_id) s.id
    from public.skill_sources s
   where lower(s.repo_slug) = 'kensaurus/cursor-kenji'
     and not exists (
           select 1
             from public.skill_sources t
            where t.project_id = s.project_id
              and lower(t.repo_slug) = 'kensaurus/skills'
         )
   order by s.project_id, s.enabled desc, s.created_at, s.id
)
update public.skill_sources s
   set repo_slug = 'kensaurus/skills'
  from keeper k
 where s.id = k.id;

-- 3. Retire old-slug rows the project's enabled kensaurus/skills row replaces,
--    and deactivate their skills that the replacement already serves.
with retired as (
  update public.skill_sources s
     set enabled = false,
         last_sync_error = 'Retired: kensaurus/cursor-kenji was renamed to kensaurus/skills, which this project already syncs.'
   where lower(s.repo_slug) = 'kensaurus/cursor-kenji'
     and exists (
           select 1
             from public.skill_sources t
            where t.project_id = s.project_id
              and lower(t.repo_slug) = 'kensaurus/skills'
              and t.enabled
         )
  returning s.id, s.project_id
)
update public.agent_skills a
   set is_active = false
  from retired r
 where a.source_id = r.id
   and a.is_active
   and exists (
         select 1
           from public.skill_sources t
           join public.agent_skills b on b.source_id = t.id
          where t.project_id = r.project_id
            and lower(t.repo_slug) = 'kensaurus/skills'
            and t.enabled
            and b.slug = a.slug
            and b.is_active
       );

-- 4. Describe the table as it actually works.
comment on table public.skill_sources is
  'Allowlisted GitHub repositories (owner/repo) whose skills/*/SKILL.md files skill-sync copies into agent_skills. '
  'Rows are added per project from the admin Sources tab (POST /v1/admin/skills/sources); nothing seeds a default. '
  'Recommended source: kensaurus/skills (kenji skills, formerly kensaurus/cursor-kenji). Any skills.sh-compatible repo works.';
