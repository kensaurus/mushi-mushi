-- ============================================================
-- Advisor follow-up for 20260707100000_mcp_oauth (lint 0026):
-- the deny-all RLS policies block every row, but the default
-- table grants still let anon/authenticated *discover* the
-- tables through the GraphQL schema. Only the service-role
-- edge functions ever touch these tables — revoke everything
-- else, matching the repo's revoke_anon_* precedent.
-- ============================================================

REVOKE ALL ON public.mcp_oauth_clients  FROM anon, authenticated;
REVOKE ALL ON public.mcp_oauth_requests FROM anon, authenticated;
