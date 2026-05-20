-- Hot list for /fixes: latest attempts per project regardless of status.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_project_created_desc
  ON public.fix_attempts (project_id, created_at DESC);
