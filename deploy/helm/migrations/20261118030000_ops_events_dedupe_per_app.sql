-- Ops hub: dedupe per app, not per organization (2026-11-18).
-- Every app of an owner sits in one organization, so two apps sending the same
-- dedupe_key (yen-yen's daily sales digest, `sales.daily:<date>`, sent once per
-- app key) collided: the first app's event was stored and every other app's
-- was answered "duplicate" and dropped. Threads are scoped the same way in
-- _shared/ops-events.ts. NULLS NOT DISTINCT keeps one event per key for
-- organization-level events with no project.
CREATE UNIQUE INDEX IF NOT EXISTS ops_events_project_dedupe_key
  ON public.ops_events (organization_id, project_id, dedupe_key) NULLS NOT DISTINCT
  WHERE dedupe_key IS NOT NULL;
DROP INDEX IF EXISTS public.ops_events_org_dedupe_key;
