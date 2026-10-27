-- ============================================================================
-- 20261027183000_repo_housekeeping_items
--
-- Repo clean-up from the console (ADR 0051, console ops plan P4). On
-- 2026-10-27 the owner deleted 1,316 merged or closed PR branches and closed
-- superseded agent PRs by hand. The /repo "Clean up" tab now does the same
-- through a connector action (ADR 0037's request → approve → execute path):
-- the preview lists each branch or PR with its reason and head commit, an
-- owner or admin approves exactly that list, and the run re-checks every item.
--
--   repo_housekeeping_items   one row per item a clean-up action touched:
--                             the branch and the commit it pointed at, or the
--                             PR and its head, the outcome and why. The row is
--                             written BEFORE a branch is deleted, so "Restore"
--                             (recreate the branch at that commit) never
--                             depends on a write that came after the delete.
--
-- RLS: service role only. The console reads through
-- /v1/admin/projects/:id/repo-cleanup.
--
-- ADDITIVE: one table. Apply BEFORE deploying api-ext. Until it exists the
-- preview still works, and a run refuses with MIGRATION_PENDING before it
-- touches GitHub.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.repo_housekeeping_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id        uuid NOT NULL REFERENCES public.connector_actions(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- owner/name, lower case
  repo             text NOT NULL CHECK (repo ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  action           text NOT NULL CHECK (action IN ('delete_branches', 'close_prs', 'set_delete_branch_on_merge', 'restore_branches')),
  -- the item's identity inside its action ('branch:<name>', 'pr:<n>', 'setting:delete_branch_on_merge')
  item_key         text NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 300),
  branch           text CHECK (branch IS NULL OR char_length(branch) <= 255),
  pr_number        integer CHECK (pr_number IS NULL OR pr_number > 0),
  fix_attempt_id   uuid,
  -- the commit the approved list recorded (a branch tip or a PR head)
  expected_sha     text CHECK (expected_sha IS NULL OR expected_sha ~ '^[0-9a-f]{40}$'),
  -- the commit the branch pointed at when Mushi deleted it; what Restore recreates
  deleted_sha      text CHECK (deleted_sha IS NULL OR deleted_sha ~ '^[0-9a-f]{40}$'),
  -- 'cas': GitHub deleted the ref only if it still pointed at expected_sha;
  -- 'reread': read the ref, then deleted it (a push in between is the race the console states)
  method           text CHECK (method IS NULL OR method IN ('cas', 'reread')),
  outcome          text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'done', 'refused', 'skipped', 'failed')),
  detail           text CHECK (detail IS NULL OR char_length(detail) <= 500),
  restored_by_action_id uuid REFERENCES public.connector_actions(id) ON DELETE SET NULL,
  restored_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, item_key)
);

COMMENT ON TABLE public.repo_housekeeping_items IS
  'ADR 0051: one row per branch, PR or repo setting a repo clean-up action touched, with the commit it pointed at (for Restore). Service role only.';

CREATE INDEX IF NOT EXISTS repo_housekeeping_items_project_idx
  ON public.repo_housekeeping_items (project_id, created_at DESC);

-- Restore and the "already asked" check look up a branch's latest row.
CREATE INDEX IF NOT EXISTS repo_housekeeping_items_branch_idx
  ON public.repo_housekeeping_items (project_id, repo, branch)
  WHERE branch IS NOT NULL;

-- ── RLS: service role only ──────────────────────────────────────────────────
ALTER TABLE public.repo_housekeeping_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repo_housekeeping_items_service_all ON public.repo_housekeeping_items;
CREATE POLICY repo_housekeeping_items_service_all ON public.repo_housekeeping_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.repo_housekeeping_items FROM anon, authenticated;
