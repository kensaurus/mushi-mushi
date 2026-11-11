-- match_codebase_files: give the code search a 20s statement timeout
-- (2026-11-11). Body unchanged from 20261031030333 (exact search on
-- embedding_768 within one project).
--
-- Sentry 7780281601: the search was cancelled with SQLSTATE 57014 under the
-- authenticator role's 8s statement_timeout. The 10-31 switch to
-- embedding_768 fixed the warm case (EXPLAIN ANALYZE 2026-11-11 on the
-- largest project, 28,343 live rows: 83 ms, 11,834 buffers, all cache hits),
-- but a cold read of those ~11.6k heap pages still crosses 8s on this
-- instance: postgres_logs show two 57014s from this function on 2026-11-06
-- (15:09 and 23:15 UTC) and none from any other statement since 10-31.
-- pg_stat_statements since 10-31: mean 523 ms, max 5.2 s over 86 calls.
--
-- PostgREST hoists a called function's `set statement_timeout` onto the
-- transaction (db-hoisted-tx-settings, default includes statement_timeout;
-- https://docs.postgrest.org/en/v14/references/transactions.html, "Hoisted
-- Function Settings", read 2026-11-11; prod runs PostgREST 14.18), the same
-- mechanism upsert_codebase_chunks (30s) and write_codebase_graph (90s) use.
-- Every other request keeps 8s. 20s stays well inside the edge function
-- wall clock; callers are classify-report RAG and the console's codebase ask.
--
-- CREATE OR REPLACE keeps the existing grants. Signature unchanged.

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
set statement_timeout = '20s'
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
