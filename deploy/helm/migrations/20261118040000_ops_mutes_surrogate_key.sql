-- ops_mutes: an id primary key instead of (organization_id, project_id) (2026-11-18).
-- A table whose composite primary key holds foreign keys to both projects and
-- organizations is a junction to PostgREST, so `projects` gained a second
-- relationship to `organizations`. Every `projects → organizations(...)` embed
-- then failed with PGRST201 ("Could not embed because more than one
-- relationship was found"), from 20261117120000_ops_hub until this fix: the
-- org's "Run AI on: OpenAI" switch read as Claude (ai-provider.ts fails closed
-- to the default), and retention-sweep's projects read failed.
-- The pair stays unique, so `upsert(..., { onConflict: 'organization_id,project_id' })`
-- (muteProject) is unchanged. Applied on production 2026-11-18 with its ledger row.
ALTER TABLE public.ops_mutes DROP CONSTRAINT ops_mutes_pkey;
ALTER TABLE public.ops_mutes ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.ops_mutes ADD CONSTRAINT ops_mutes_pkey PRIMARY KEY (id);
ALTER TABLE public.ops_mutes ADD CONSTRAINT ops_mutes_org_project_key UNIQUE (organization_id, project_id);
NOTIFY pgrst, 'reload schema';
