-- Codebase search on a short vector, inside one project (2026-10-31).
--
-- match_codebase_files timed out (MUSHI-MUSHI-SERVER-2D, 8 s) because every
-- project shared one IVFFlat index of 427 MB on a 1 GB instance (256 MB of
-- shared_buffers): a per-project query probed lists full of other projects'
-- vectors, read about 100 MB a call (pg_stat_statements: 312,870 blocks over 24
-- calls, mean 4.5 s), and evicted everything else from the cache. pgvector's own
-- guidance: tenants sharing an approximate index hurt each other's recall and
-- speed.
--
-- text-embedding-3-small embeddings may be shortened by truncating and
-- renormalizing (OpenAI embeddings guide). The first 768 dimensions as halfvec
-- are 1.5 KB instead of 6 KB, kept in the row (storage main), and give 95%
-- top-5 agreement with an exact search on the full vector (measured on yen-yen
-- and the-wanting-mind, 60 neighbours). match_codebase_files now does an exact
-- search on them within the project: the largest project (26.5k chunks) reads
-- about 60 MB at most, and no shared index is needed. The trigger keeps the
-- column in step with every write, so the indexers do not change.

alter table public.project_codebase_files
  add column if not exists embedding_768 extensions.halfvec(768);

alter table public.project_codebase_files
  alter column embedding_768 set storage main;

comment on column public.project_codebase_files.embedding_768 is
  'First 768 dimensions of embedding, renormalized, as halfvec. Kept in step by trg_codebase_embedding_768; searched by match_codebase_files.';

create or replace function public.codebase_embedding_768()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
begin
  new.embedding_768 := case
    when new.embedding is null then null
    else extensions.l2_normalize(extensions.subvector(new.embedding, 1, 768))::extensions.halfvec(768)
  end;
  return new;
end;
$$;

revoke all on function public.codebase_embedding_768() from public, anon, authenticated;

drop trigger if exists trg_codebase_embedding_768 on public.project_codebase_files;
create trigger trg_codebase_embedding_768
  before insert or update of embedding on public.project_codebase_files
  for each row execute function public.codebase_embedding_768();

-- Existing rows were filled in batches by a one-shot pg_cron job (8,000 rows a
-- minute), not here: one UPDATE of 90k rows does not fit the statement timeout.
-- match_codebase_files moves to this column in 20261031030333.
