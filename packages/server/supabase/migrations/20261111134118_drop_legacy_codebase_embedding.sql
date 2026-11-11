-- Drop the legacy 1536-d codebase embedding (2026-11-11 cost audit).
--
-- Apply only after 20261111134117_codebase_embedding_768_only is live and the
-- edge functions that read `embedding` (webhooks-github-indexer,
-- api's project-codebase stats) or wrote it (api's codebase and sync uploads)
-- are deployed without it. Search reads embedding_768 only
-- (match_codebase_files), and every writer now goes through
-- upsert_codebase_chunks, which writes embedding_768 only.
--
-- The column held derived vectors (text-embedding-3-small output, the first
-- 768 dimensions of which live on in embedding_768); dropping them was
-- approved by the owner on 2026-11-11. DROP COLUMN frees no disk by itself:
-- the space comes back as rows are rewritten, or at once with VACUUM FULL /
-- pg_repack (an owner decision, it locks the table).

set lock_timeout = '5s';

-- Never lose a search vector: every row that still has the 1536-d vector
-- must already have its 768-d copy.
do $$
begin
  if exists (
    select 1
    from public.project_codebase_files
    where embedding is not null
      and embedding_768 is null
  ) then
    raise exception 'project_codebase_files has rows with embedding but no embedding_768; backfill before dropping';
  end if;
end
$$;

drop trigger if exists trg_codebase_embedding_768 on public.project_codebase_files;
drop function if exists public.codebase_embedding_768();
alter table public.project_codebase_files drop column if exists embedding;
