-- ============================================================
-- Mushi Mushi v2 — Revoke anon SELECT on authenticated-only tables
-- ============================================================
-- These tables have RLS policies that require an authenticated
-- `auth.uid()` (org membership, project membership, or tester
-- self-ownership). Granting anon SELECT exposes their structure to
-- the GraphQL anon schema even though no rows are ever returned.
-- Revoking SELECT removes the GraphQL exposure entirely while
-- preserving every existing authenticated flow.
--
-- Tables intentionally NOT touched:
--   - published_apps / published_app_bounties / published_app_targeting
--     (have explicit `public_read` policies for visibility='public')
--   - tester_leaderboard_30d{,_public} (intentional public leaderboard)
-- ============================================================

DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    -- Authenticated-only knowledge / learning
    'public.agent_personas',

    -- Project-scoped QA artefacts
    'public.qa_stories',
    'public.qa_story_evidence',
    'public.qa_story_runs',

    -- Tester / org-member scoped reward & reputation data
    'public.quest_progress',
    'public.reward_quests',
    'public.reward_rules',
    'public.reward_tiers',
    'public.tester_app_subscriptions',
    'public.tester_reputation',
    'public.tester_reputation_events',
    'public.tester_submissions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    BEGIN
      EXECUTE format('REVOKE SELECT ON %s FROM anon', tbl);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Skipping missing table %', tbl;
    END;
  END LOOP;
END $$;
