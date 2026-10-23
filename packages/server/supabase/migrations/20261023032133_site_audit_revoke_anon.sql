-- Site audit tables are read by signed-in members only (RLS already returns
-- no rows to anon); revoke the default anon grant so they are not
-- discoverable in the GraphQL schema without signing in (advisor 2026-10-23).
revoke all on table public.site_audits, public.site_audit_findings from anon;
