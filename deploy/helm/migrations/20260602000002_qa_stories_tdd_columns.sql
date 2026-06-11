-- Phase 2: TDD column additions to qa_stories + qa_story_runs
-- Adds: source, approval_status, automation_mode, origin_story_node_id
-- These columns power the TDD scenario gating (auto / review / approve)
-- and link a generated test back to the inventory user story it came from.

-- 1. New columns on qa_stories
ALTER TABLE public.qa_stories
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'test_gen_from_story', 'test_gen_from_report', 'pdca')),
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending_review', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS automation_mode text NOT NULL DEFAULT 'auto'
    CHECK (automation_mode IN ('auto', 'review', 'approve')),
  ADD COLUMN IF NOT EXISTS origin_story_node_id text,  -- inventory user_story.id slug
  ADD COLUMN IF NOT EXISTS origin_report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generated_pr_url text,
  ADD COLUMN IF NOT EXISTS generation_model text;

-- 2. Index for pending review queue
CREATE INDEX IF NOT EXISTS idx_qa_stories_pending_review
  ON public.qa_stories(project_id, approval_status)
  WHERE approval_status = 'pending_review';

-- 3. qa-story-runner: runner must gate on approval_status = 'approved'
-- This is enforced in application logic, but the index makes it fast.
CREATE INDEX IF NOT EXISTS idx_qa_stories_runnable
  ON public.qa_stories(project_id, enabled, approval_status)
  WHERE enabled = true AND approval_status = 'approved';

-- 4. PDCA improvement tracking on qa_stories
--    parent_story_id links an improved/cloned story back to its predecessor
ALTER TABLE public.qa_stories
  ADD COLUMN IF NOT EXISTS parent_story_id uuid REFERENCES public.qa_stories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pdca_iteration int NOT NULL DEFAULT 0;

-- Flush PostgREST's schema/config caches so the new qa_stories columns are
-- visible to API callers immediately after deploy, avoiding transient
-- "column does not exist" errors (repo convention for structural migrations).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
