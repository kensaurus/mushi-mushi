-- Migration: RLS tighten phase 3 (R6)
-- Drops the authenticated USING(true) SELECT policy from console_knowledge_chunks.
--
-- This table stores static help-documentation chunks used by the page-aware
-- assistant (POST /v1/sdk/assistant). All reads in production are performed
-- by that edge function under the service-role, which bypasses RLS. No
-- authenticated client ever reads this table directly. After this drop, the
-- table has RLS enabled with zero authenticated-role policies, so Postgres
-- denies direct authenticated reads by default (service-role unaffected).

DROP POLICY IF EXISTS "console_knowledge_authenticated_select" ON public.console_knowledge_chunks;
