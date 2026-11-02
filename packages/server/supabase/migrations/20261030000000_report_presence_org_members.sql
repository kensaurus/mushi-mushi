-- Org members could not mark themselves as viewing a report: the INSERT
-- policy only allowed direct project_members rows, while the SELECT policy
-- (org_member_select) already accepts organization members through
-- private.is_project_member. An owner who reaches an app as an org admin got
-- a 403 on every report page (console sweep 2026-10-30). Same check as the
-- codebase-understand tables (20260616005239): a member either way, own row only.
ALTER POLICY members_upsert_own_report_presence ON public.report_presence
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      private.is_project_member(project_id)
      OR project_id IN (
        SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (SELECT auth.uid())
      )
    )
  );
