-- Migration: RLS tighten phase 1 (R1 + R2)
-- Drops the cross-tenant USING(true) SELECT policies from llm_invocations and
-- anti_gaming_events. Both tables already have a correctly-scoped
-- "org_member_select" policy (USING private.is_project_member(project_id)) that
-- limits reads to the authenticated user's own projects. Keeping both policies
-- OR'd together made the permissive one win, leaking LLM cost data and
-- anti-fraud signals across all projects to any authenticated user.

-- R1: llm_invocations
DROP POLICY IF EXISTS "authenticated_reads_llm_invocations" ON public.llm_invocations;

-- R2: anti_gaming_events
DROP POLICY IF EXISTS "authenticated_reads_ag_events" ON public.anti_gaming_events;
