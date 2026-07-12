/*
FILE: 20260616120000_tester_reputation_rls_tighten.sql
PURPOSE: Restrict tester_reputation reads to self-only (remove global USING(true) policy).
*/

DROP POLICY IF EXISTS tester_rep_org_admin_read ON public.tester_reputation;

COMMENT ON POLICY tester_rep_self_read ON public.tester_reputation IS
  'Testers read only their own reputation score. Org admins use service-role API routes.';
