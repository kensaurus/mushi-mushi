-- match_report_embeddings exact-scans vectors until PostgREST's 8s
-- statement_timeout cancels it (57014). Callers log "Similarity search failed".
--
-- The project predicate is on reports, not report_embeddings. The planner
-- either detoasts every embedding in the project or walks the shared HNSW
-- graph (idx_embeddings_default) and applies the project filter afterwards.
-- A cold exact scan of a large project, or a walk across every tenant, does
-- not finish in 8s.
--
-- Same split as match_codebase_files (20261009152000). Count at most 2001
-- of this project's text-embedding-3-small rows, starting from
-- reports.project_id so other tenants are not read. Up to 2000 rows stay an
-- exact sort of that project only: a selective project is where a filtered
-- HNSW walk stops early (hnsw.max_scan_tuples) and returns a short list.
-- Above 2000, and only when pgvector is 0.8 or newer, the existing partial
-- HNSW index is scanned with iterative scan. The index is not dropped or
-- rebuilt, and project_id is not copied onto the table.
--
-- hnsw.iterative_scan is not a function SET clause. On pgvector before 0.8
-- that parameter is rejected and CREATE FUNCTION would fail. The version is
-- checked at call time; older servers keep the exact sort. The function is
-- volatile because that check applies set_config for the scan.
--
-- Those set_config calls are transaction-local (the third argument is true).
-- The previous hnsw.iterative_scan, hnsw.ef_search and enable_seqscan values
-- are saved and written back before the function returns, and again when the
-- scan errors, so a caller that runs this RPC inside a larger transaction
-- keeps its own planner settings for later statements.
--
-- When the iterative scan returns fewer rows than match_count, raise
-- match_report_embeddings_hnsw_short. A strict threshold also returns a
-- short list, so the warning is a signal to compare with match_count, not
-- proof a neighbor was dropped. pgvector older than 0.8 never takes this
-- branch (extversion is read at call time) and can still exact-scan.

create or replace function public.match_report_embeddings(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_project_id uuid
)
returns table (
  report_id uuid,
  similarity double precision,
  description text,
  category text,
  created_at timestamptz,
  report_group_id uuid
)
language plpgsql
volatile
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  project_rows integer;
  use_hnsw boolean := false;
  vector_version text;
  prev_iterative_scan text;
  prev_ef_search text;
  prev_seqscan text;
  hnsw_rows integer := 0;
begin
  -- Stop once the exact-scan cap is crossed. A full count would read every
  -- report of a large project before choosing the index plan.
  select count(*)::int
    into project_rows
  from (
    select 1
    from public.reports r
    join public.report_embeddings re
      on re.report_id = r.id
     and re.model = 'text-embedding-3-small'
    where r.project_id = p_project_id
    limit 2001
  ) capped;

  if project_rows > 2000 then
    begin
      select extversion
        into vector_version
      from pg_extension
      where extname = 'vector';

      if vector_version is not null
         and (
           split_part(vector_version, '.', 1)::int > 0
           or split_part(vector_version, '.', 2)::int >= 8
         )
      then
        prev_iterative_scan := current_setting('hnsw.iterative_scan', true);
        prev_ef_search := current_setting('hnsw.ef_search', true);
        prev_seqscan := current_setting('enable_seqscan', true);
        if prev_iterative_scan is not null
           and prev_ef_search is not null
           and prev_seqscan is not null
        then
          use_hnsw := true;
        end if;
      end if;
    exception
      when undefined_object or invalid_parameter_value or insufficient_privilege
        or data_exception or numeric_value_out_of_range then
        use_hnsw := false;
    end;
  end if;

  if use_hnsw then
    begin
      -- A failure on the second or third setting is undone here. The
      -- subtransaction rolls those writes back; the explicit restore covers
      -- a rollback that does not.
      perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
      perform set_config('hnsw.ef_search', '100', true);
      perform set_config('enable_seqscan', 'off', true);
    exception
      when undefined_object or invalid_parameter_value or insufficient_privilege
        or data_exception then
        perform set_config('hnsw.iterative_scan', prev_iterative_scan, true);
        perform set_config('hnsw.ef_search', prev_ef_search, true);
        perform set_config('enable_seqscan', prev_seqscan, true);
        use_hnsw := false;
    end;
  end if;

  if use_hnsw then
    begin
      return query
        with hits as materialized (
          select
            re.report_id,
            (re.embedding <=> query_embedding) as distance,
            r.description,
            r.category,
            r.created_at,
            r.report_group_id
          from public.report_embeddings re
          join public.reports r on r.id = re.report_id
          where r.project_id::text = p_project_id::text
            and re.model = 'text-embedding-3-small'
            and (1 - (re.embedding <=> query_embedding)) > match_threshold
          order by re.embedding <=> query_embedding
          limit match_count
        )
        select
          h.report_id,
          (1 - h.distance)::double precision,
          h.description,
          h.category,
          h.created_at,
          h.report_group_id
        from hits h
        order by h.distance;
      get diagnostics hnsw_rows = row_count;
    exception
      when others then
        perform set_config('hnsw.iterative_scan', prev_iterative_scan, true);
        perform set_config('hnsw.ef_search', prev_ef_search, true);
        perform set_config('enable_seqscan', prev_seqscan, true);
        raise;
    end;

    perform set_config('hnsw.iterative_scan', prev_iterative_scan, true);
    perform set_config('hnsw.ef_search', prev_ef_search, true);
    perform set_config('enable_seqscan', prev_seqscan, true);

    -- Fewer rows than requested: the iterative walk can stop early, and a
    -- high threshold also stops early. Either way the caller asked for more.
    if match_count is not null and hnsw_rows < match_count then
      raise warning 'match_report_embeddings_hnsw_short project_id=% returned=% match_count=%',
        p_project_id, hnsw_rows, match_count;
    end if;
  else
    return query
      with scoped as materialized (
        select
          re.report_id,
          (re.embedding <=> query_embedding) as distance
        from public.reports r
        join public.report_embeddings re
          on re.report_id = r.id
         and re.model = 'text-embedding-3-small'
        where r.project_id = p_project_id
      )
      select
        s.report_id,
        (1 - s.distance)::double precision,
        r.description,
        r.category,
        r.created_at,
        r.report_group_id
      from scoped s
      join public.reports r on r.id = s.report_id
      where (1 - s.distance) > match_threshold
      order by s.distance
      limit match_count;
  end if;
end;
$function$;

notify pgrst, 'reload schema';
