-- match_codebase_files: exact search on embedding_768 within the project
-- (2026-10-31). Applied after every row of embedding_768 was filled (see
-- 20261031024512), so search never ran on a half-filled column.
--
-- Measured on prod right after the switch: tsumagoi (20.7k chunks) 2,742 ms ->
-- 244 ms; solo-boss-cloud (26.5k, the largest) 454 ms; the statement timeout is
-- 8 s. idx_codebase_embedding_ivf_half (427 MB) is no longer read and was
-- dropped with DROP INDEX CONCURRENTLY through a one-shot pg_cron job (a
-- migration runs in a transaction, where CONCURRENTLY is refused).

-- Load pgvector so its settings are registered before the function below.
select extensions.vector_dims('[1]'::extensions.vector);

create or replace function public.match_codebase_files(
  query_embedding vector,
  match_project uuid,
  match_count integer default 5,
  path_prefix text default null
)
returns table(
  id uuid,
  file_path text,
  content_preview text,
  component_tag text,
  symbol_name text,
  signature text,
  line_start integer,
  line_end integer,
  similarity double precision
)
language sql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
  with q as (
    select l2_normalize(subvector(query_embedding, 1, 768))::halfvec(768) as v
  ),
  hits as materialized (
    select
      pcf.id, pcf.file_path, pcf.content_preview, pcf.component_tag, pcf.symbol_name,
      pcf.signature, pcf.line_start, pcf.line_end,
      (pcf.embedding_768 <=> q.v) as distance
    from project_codebase_files pcf, q
    where pcf.project_id = match_project
      and pcf.tombstoned_at is null
      and pcf.embedding_768 is not null
      and (
        path_prefix is null
        or pcf.file_path = path_prefix
        or pcf.file_path like path_prefix || '/%'
      )
    order by pcf.embedding_768 <=> q.v
    limit greatest(1, least(coalesce(match_count, 5), 50))
  )
  select h.id, h.file_path, h.content_preview, h.component_tag, h.symbol_name,
         h.signature, h.line_start, h.line_end, (1 - h.distance)::double precision
  from hits h
  order by h.distance;
$function$;
