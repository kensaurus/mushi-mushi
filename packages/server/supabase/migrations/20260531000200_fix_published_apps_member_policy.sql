-- Migration: fix_published_apps_member_policy
-- PURPOSE: Migration 20260523001000_published_apps.sql created the
--   `published_apps_org_admin_all` policy granting FOR ALL (INSERT/UPDATE/
--   DELETE/SELECT) to ARRAY['owner', 'admin', 'member'].
--
--   The comment on that migration states "project owners + org admins can
--   INSERT/UPDATE/DELETE", and the policy name itself (`org_admin_all`) implies
--   member exclusion. Including 'member' allows any regular org member to
--   publish, unpublish, pause, or delete the app listing — a significant
--   over-privilege for a public-facing marketplace record.
--
--   The comparable `tester_subs_org_admin` policy in the same migration
--   correctly restricts write access to ARRAY['owner', 'admin'], confirming
--   'member' was unintentionally included here.
--
--   Fix: drop and recreate the policy restricted to owner + admin only.
--   The public SELECT policy (published_apps_public_read FOR SELECT TO anon)
--   is unaffected and continues to allow anyone to read public listings.

DROP POLICY IF EXISTS published_apps_org_admin_all ON public.published_apps;

CREATE POLICY published_apps_org_admin_all ON public.published_apps
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner', 'admin']));
