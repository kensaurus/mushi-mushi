-- Migration: copilot_followup_recompute_comment_schema_notify
-- Deployed: 2026-05-31 via Supabase MCP (apply_migration)
-- Reason: Copilot PR #144 fixes:
--   1. COMMENT ON FUNCTION now uses explicit (uuid) signature per SQL best practice.
--   2. Schema comment corrects the misleading "pg_net moved out of public"
--      claim from 20260526150554 (pg_net is non-relocatable on Supabase).
--   3. NOTIFY pgrst to flush PostgREST schema + privilege caches.

COMMENT ON FUNCTION private.recompute_tester_reputation(uuid) IS
  'SQL helper for on-demand single-tester recompute. Invoke with '
  'SELECT private.recompute_tester_reputation(p_tester_id). The daily batch '
  'recompute runs via the recompute-tester-reputation edge function cron job.';

COMMENT ON SCHEMA public IS
  'Mushi Mushi v2 — public schema. Security advisor remediation '
  'applied 2026-05-27 (migrations 20260527020000 + copilot followups): '
  'security_invoker on public leaderboard view, search_path pinned on '
  'flagged functions, redundant service_role RLS policies dropped, '
  'EXECUTE revoked from anon/authenticated on trigger/cron functions, '
  'and SELECT revoked from anon on PII/financial tables (RLS still applies). '
  'pg_net remains in public — non-relocatable on Supabase; tracked as a '
  'WARN-level advisor that requires platform support to address.';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
