-- Let organization members post triage notes on reports they can read.
--
-- Read access to report_comments was widened to organization members by
-- org_member_select (20260428000300_org_access_policies.sql), but the INSERT
-- policy still required a per-project project_members row. An org member who
-- could open a report got "new row violates row-level security policy" when
-- posting a note (2026-10-04 console audit, group B #83; confirmed against
-- live pg_policies the same day).
--
-- Viewers stay read-only: the org path requires owner, admin or member.
-- The legacy project_members path is kept unchanged.

DROP POLICY IF EXISTS "members_insert_report_comments" ON public.report_comments;
CREATE POLICY "members_insert_report_comments"
  ON public.report_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = (SELECT auth.uid())
    AND (
      project_id IN (
        SELECT pm.project_id FROM public.project_members pm
        WHERE pm.user_id = (SELECT auth.uid())
      )
      OR private.has_project_role(project_id, ARRAY['owner', 'admin', 'member'])
    )
  );
