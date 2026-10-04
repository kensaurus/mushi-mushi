-- Publish the tables the admin console listens to for live updates.
--
-- The console subscribes (useRealtimeReload / postgres_changes) to about 50
-- tables, but only 17 were in the supabase_realtime publication. On every
-- other table the subscription joined and then never fired, so pages such as
-- Reports, Fixes, Repo, Judge, Graph and Audit only changed on reload
-- (2026-10-04 console QA: a posted triage note did not appear).
--
-- Only tables that signed-in members can already SELECT, and that hold no
-- secrets or tokens, are added. Postgres Changes authorizes every event
-- against the subscriber's RLS, so nobody receives a row they could not
-- already read. Left out on purpose:
--   - credentials or one-time tokens: project_api_keys, project_plugins,
--     invitations, tester_redemptions, support_tickets;
--   - tables authenticated cannot SELECT at all (project_settings,
--     project_storage_settings, releases, release_credits, pdca_runs,
--     pdca_iterations): an event could never be delivered.
--
-- Idempotent: a table already in the publication is skipped.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reports',
    'report_groups',
    'fix_attempts',
    'fix_events',
    'fix_dispatch_jobs',
    'fix_verifications',
    'classification_evaluations',
    'prompt_versions',
    'graph_nodes',
    'graph_edges',
    'bug_ontology',
    'research_sessions',
    'research_snippets',
    'inventory_proposals',
    'nl_query_history',
    'integration_health_history',
    'plugin_dispatch_log',
    'projects',
    'organizations',
    'organization_members',
    'project_repos',
    'project_retention_policies',
    'audit_logs',
    'usage_events',
    'discovery_events',
    'end_user_points',
    'billing_subscriptions'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
