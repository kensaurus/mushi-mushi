-- Rollback for 20261002150000_repo_digest_and_diagrams.
-- Drops the digest cache, the diagrams and every published diagram page.
-- Public diagram URLs then return 404; nothing else reads these tables.

DROP TABLE IF EXISTS public.public_repo_diagrams;
DROP TABLE IF EXISTS public.project_codebase_diagrams;
DROP TABLE IF EXISTS public.repo_digest_cache;

NOTIFY pgrst, 'reload schema';
