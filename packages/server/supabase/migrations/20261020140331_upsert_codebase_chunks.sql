-- Upsert codebase chunks with a statement timeout that fits a vector update.
--
-- The indexer wrote project_codebase_files through PostgREST, under the
-- authenticator role's 8s statement_timeout. Changing a chunk's embedding
-- updates idx_codebase_embedding_ivf_half (the old list entry is removed by
-- a list scan). That single statement was canceled with SQLSTATE 57014
-- ("canceling statement due to statement timeout"); the logged path was the
-- file being indexed. A metadata refresh of 200 rows held the same locks.
--
-- PostgREST hoists a called function's set statement_timeout onto the
-- transaction, so this RPC gets 30s and every other request keeps 8s.
-- A null embedding leaves the stored vector in place (refresh must not
-- rewrite the index). Conflict target matches uq_codebase_chunks
-- (project_id, file_path, symbol_name) NULLS NOT DISTINCT. Service role only.
-- The caller sends at most 25 rows.

create or replace function public.upsert_codebase_chunks(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
set statement_timeout = '30s'
as $fn$
declare
  written integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_rows) > 25 then
    raise exception 'upsert_codebase_chunks batch exceeds 25 rows'
      using errcode = '22023';
  end if;

  insert into public.project_codebase_files as existing (
    project_id,
    file_path,
    symbol_name,
    signature,
    line_start,
    line_end,
    language,
    content_hash,
    content_preview,
    imports,
    last_modified,
    tombstoned_at,
    embedding,
    embedding_model
  )
  select
    r.project_id,
    r.file_path,
    r.symbol_name,
    r.signature,
    r.line_start,
    r.line_end,
    r.language,
    r.content_hash,
    r.content_preview,
    case
      when r.imports is null then '{}'::text[]
      else (
        select coalesce(array_agg(elem order by ord), '{}'::text[])
        from jsonb_array_elements_text(r.imports) with ordinality as u(elem, ord)
      )
    end,
    coalesce(r.last_modified, now()),
    r.tombstoned_at,
    case
      when r.embedding is null then null::extensions.vector(1536)
      else r.embedding::text::extensions.vector(1536)
    end,
    r.embedding_model
  from jsonb_to_recordset(p_rows) as r(
    project_id uuid,
    file_path text,
    symbol_name text,
    signature text,
    line_start integer,
    line_end integer,
    language text,
    content_hash text,
    content_preview text,
    imports jsonb,
    last_modified timestamptz,
    tombstoned_at timestamptz,
    embedding jsonb,
    embedding_model text
  )
  on conflict (project_id, file_path, symbol_name) do update set
    signature = excluded.signature,
    line_start = excluded.line_start,
    line_end = excluded.line_end,
    language = excluded.language,
    content_hash = excluded.content_hash,
    content_preview = excluded.content_preview,
    imports = excluded.imports,
    last_modified = excluded.last_modified,
    tombstoned_at = excluded.tombstoned_at,
    embedding = coalesce(excluded.embedding, existing.embedding),
    embedding_model = coalesce(excluded.embedding_model, existing.embedding_model);

  get diagnostics written = row_count;
  return written;
end;
$fn$;

revoke all on function public.upsert_codebase_chunks(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_codebase_chunks(jsonb) to service_role;

notify pgrst, 'reload schema';
