-- ============================================================
-- Mushi Mushi v2.1 — passive inventory discovery (whitepaper §6 hybrid mode)
--
-- Adds the data plane for SDK-side passive discovery:
--   * `discovery_events`        — append-only stream from @mushi-mushi/web
--                                 SDK clients with `discoverInventory: true`.
--   * `discovery_observed_inventory` — view: per (project, route) aggregate
--                                 with testid + api union, distinct user
--                                 count, and 30-day-rolling window.
--   * `inventory_proposals`     — draft inventory.yaml proposals produced by
--                                 the Claude proposer; admins can edit, then
--                                 accept (in which case `inventory.ingest` is
--                                 called server-side) or discard.
--
-- Privacy posture (matches the user's `min_plus_dom_summary` choice):
--   - Only `route`, `page_title`, `testids[]`, `network_paths[]`, `dom_summary`
--     (≤200 chars) are persisted.
--   - `user_id_hash` is a one-way SHA-256 of `mushi.userId || session_id`,
--     never the raw value.
--   - `query_param_keys[]` records the *keys* observed (for route-template
--     hinting) but never values.
-- ============================================================

CREATE TABLE IF NOT EXISTS discovery_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Framework-normalized route (e.g. /practice/[id], not /practice/abc-123).
  -- Normalization happens client-side; the server stores what it gets but
  -- enforces a soft length cap.
  route             TEXT        NOT NULL CHECK (length(route) BETWEEN 1 AND 400),
  page_title        TEXT        CHECK (page_title IS NULL OR length(page_title) <= 300),
  -- ≤200-char summary of <h1>/<title>/<main> first text run. Lets the
  -- proposer name stories better without slurping arbitrary DOM content.
  dom_summary       TEXT        CHECK (dom_summary IS NULL OR length(dom_summary) <= 240),
  testids           TEXT[]      NOT NULL DEFAULT '{}',
  network_paths     TEXT[]      NOT NULL DEFAULT '{}',
  query_param_keys  TEXT[]      NOT NULL DEFAULT '{}',
  user_id_hash      TEXT        CHECK (user_id_hash IS NULL OR length(user_id_hash) = 64),
  sdk_version       TEXT        CHECK (sdk_version IS NULL OR length(sdk_version) <= 40),
  raw               JSONB,
  -- A rolling-window cleanup column: the bg job deletes rows older than
  -- this so the table never grows unbounded for chatty customers.
  retain_until      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS discovery_events_project_route_idx
  ON discovery_events(project_id, route);
CREATE INDEX IF NOT EXISTS discovery_events_recent_idx
  ON discovery_events(project_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS discovery_events_retain_idx
  ON discovery_events(retain_until)
  WHERE retain_until IS NOT NULL;

ALTER TABLE discovery_events ENABLE ROW LEVEL SECURITY;

-- Service role inserts; readers must be a project member (org-aware via
-- private.is_project_member, which the Teams v1 migration installed).
-- All policies use the (SELECT auth.uid()) initplan pattern + scope
-- helper-based membership so the planner caches across rows.
DROP POLICY IF EXISTS discovery_events_admin_select ON discovery_events;
CREATE POLICY discovery_events_admin_select ON discovery_events
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS discovery_events_service_all ON discovery_events;
CREATE POLICY discovery_events_service_all ON discovery_events
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- GraphQL / PostgREST hardening: the only intended writers are the
-- service-role-keyed Edge Function (`/v1/sdk/discovery`) and the
-- background prune cron. Project members read via the route handlers,
-- never via /rest/v1/discovery_events.
REVOKE ALL ON discovery_events FROM anon, authenticated;

COMMENT ON TABLE discovery_events IS
  'Mushi v2.1: append-only stream of (route, testids, network) tuples emitted by SDK clients with discoverInventory:true. Coalesced into discovery_observed_inventory for the proposer.';

-- ----------------------------------------------------------------
-- discovery_observed_inventory — denormalised, 30-day rolling.
--
-- The proposer reads this view; never the raw events. Materialising
-- as a view (not a matview) keeps it always-fresh — the cardinality
-- is tiny (≤ a few hundred rows per project) so the scan cost is fine.
-- ----------------------------------------------------------------
-- security_invoker = true so the view runs queries with the *caller's*
-- permissions, inheriting `discovery_events` RLS. Without this, the view
-- would resolve as the migration author (definer) and any logged-in user
-- could SELECT it through PostgREST/GraphQL and read every project's
-- routes / testids / network paths. We REVOKE base grants below as
-- belt-and-braces.
CREATE OR REPLACE VIEW discovery_observed_inventory
WITH (security_invoker = true)
AS
WITH recent AS (
  SELECT * FROM discovery_events
   WHERE observed_at > now() - interval '30 days'
),
exploded_testids AS (
  SELECT project_id, route, unnest(testids) AS testid
    FROM recent
   WHERE array_length(testids, 1) IS NOT NULL
),
exploded_apis AS (
  SELECT project_id, route, unnest(network_paths) AS api_path
    FROM recent
   WHERE array_length(network_paths, 1) IS NOT NULL
),
exploded_query AS (
  SELECT project_id, route, unnest(query_param_keys) AS qk
    FROM recent
   WHERE array_length(query_param_keys, 1) IS NOT NULL
),
testid_agg AS (
  SELECT project_id, route, array_agg(DISTINCT testid ORDER BY testid) AS testids
    FROM exploded_testids
   GROUP BY project_id, route
),
api_agg AS (
  SELECT project_id, route, array_agg(DISTINCT api_path ORDER BY api_path) AS apis
    FROM exploded_apis
   GROUP BY project_id, route
),
query_agg AS (
  SELECT project_id, route, array_agg(DISTINCT qk ORDER BY qk) AS query_keys
    FROM exploded_query
   GROUP BY project_id, route
)
SELECT
  r.project_id,
  r.route,
  -- Pick the most recent non-null title + summary (a route's title can
  -- legitimately change over a release).
  (array_agg(r.page_title ORDER BY r.observed_at DESC) FILTER (WHERE r.page_title IS NOT NULL))[1] AS latest_title,
  (array_agg(r.dom_summary ORDER BY r.observed_at DESC) FILTER (WHERE r.dom_summary IS NOT NULL))[1] AS latest_dom_summary,
  COUNT(*)                                                AS observation_count,
  COALESCE(t.testids, '{}'::text[])                       AS observed_testids,
  COALESCE(a.apis,    '{}'::text[])                       AS observed_apis,
  COALESCE(q.query_keys, '{}'::text[])                    AS observed_query_keys,
  COUNT(DISTINCT r.user_id_hash) FILTER (WHERE r.user_id_hash IS NOT NULL) AS distinct_users,
  MAX(r.observed_at)                                      AS last_seen_at,
  MIN(r.observed_at)                                      AS first_seen_at
  FROM recent r
  LEFT JOIN testid_agg t USING (project_id, route)
  LEFT JOIN api_agg    a USING (project_id, route)
  LEFT JOIN query_agg  q USING (project_id, route)
 GROUP BY r.project_id, r.route, t.testids, a.apis, q.query_keys;

COMMENT ON VIEW discovery_observed_inventory IS
  'Per-(project, route) aggregate of the last 30 days of SDK discovery events. Source of truth for inventory-propose. Runs with security_invoker so it inherits discovery_events RLS.';

-- Closes pg_graphql discovery + PostgREST direct read. The route handler
-- (`GET /v1/admin/inventory/:id/discovery`) is the only intended reader.
REVOKE ALL ON discovery_observed_inventory FROM anon, authenticated;

-- ----------------------------------------------------------------
-- inventory_proposals — Claude-generated drafts pending admin review.
-- ----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE inventory_proposal_status AS ENUM ('draft', 'accepted', 'discarded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS inventory_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status          inventory_proposal_status NOT NULL DEFAULT 'draft',
  proposed_yaml   TEXT NOT NULL,
  -- The same shape we send into ingestInventory(); validating it
  -- happens at insert time and the row never gets created if Zod
  -- rejects, so consumers can trust this column is structurally valid.
  proposed_parsed JSONB NOT NULL,
  -- Per-story rationale the LLM emitted alongside the YAML, indexed
  -- by user_story.id, so the review UI can render "Why did the model
  -- think this is a story?" callouts inline.
  rationale_by_story JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_model       TEXT NOT NULL,
  llm_input_hash  TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  inventory_id    UUID REFERENCES inventories(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  decided_at      TIMESTAMPTZ,
  decided_by      UUID
);

CREATE INDEX IF NOT EXISTS inventory_proposals_project_idx
  ON inventory_proposals(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_proposals_status_idx
  ON inventory_proposals(project_id, status);

ALTER TABLE inventory_proposals ENABLE ROW LEVEL SECURITY;

-- Project members can READ proposals for their project. Writes go
-- through the route handlers (POST /propose creates, PATCH edits draft,
-- accept / discard transition status) which run with the service role.
-- Granting members FOR ALL would let them PATCH /rest/v1/inventory_proposals
-- to set status='accepted' and bypass ingestInventory()'s validation.
DROP POLICY IF EXISTS inventory_proposals_admin_all ON inventory_proposals;
DROP POLICY IF EXISTS inventory_proposals_member_select ON inventory_proposals;
CREATE POLICY inventory_proposals_member_select ON inventory_proposals
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS inventory_proposals_service_all ON inventory_proposals;
CREATE POLICY inventory_proposals_service_all ON inventory_proposals
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Same hardening as discovery_events: route handlers only.
REVOKE ALL ON inventory_proposals FROM anon, authenticated;

COMMENT ON TABLE inventory_proposals IS
  'Mushi v2.1: LLM-drafted inventory.yaml proposals awaiting admin accept/discard. The accept path calls ingestInventory() server-side and links inventory_id back.';

-- ----------------------------------------------------------------
-- Realtime: admins viewing /inventory should see the proposal pop in
-- as soon as the proposer finishes.
-- ----------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE inventory_proposals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE discovery_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ----------------------------------------------------------------
-- Daily cleanup: discard rows older than retain_until. pg_cron runs
-- this if available; the migration is idempotent if it isn't.
-- ----------------------------------------------------------------
DO $$
DECLARE
  has_cron BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO has_cron;
  IF has_cron THEN
    -- Use cron.unschedule_by_name() to avoid double-scheduling on re-runs.
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'mushi-discovery-events-prune';
    PERFORM cron.schedule(
      'mushi-discovery-events-prune',
      '0 4 * * *',
      $sql$ DELETE FROM discovery_events WHERE retain_until < now() $sql$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipping discovery_events prune schedule';
  END IF;
END $$;
