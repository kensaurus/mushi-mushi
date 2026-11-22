-- Stop writing the legacy 1536-d codebase embedding (2026-11-11 cost audit).
--
-- project_codebase_files carries the full `embedding` vector(1536) (572 MB
-- over 97k rows) next to `embedding_768` halfvec(768) (144 MB), which
-- trg_codebase_embedding_768 derives from it. match_codebase_files reads only
-- embedding_768. This step makes every writer produce embedding_768 directly
-- and leave `embedding` NULL; a later migration drops the column once the
-- edge functions that read or wrote it directly are live without it.
--
-- Order matters: the trigger used to set embedding_768 := NULL whenever a
-- row was inserted without `embedding`. It now derives only when `embedding`
-- is given (old callers during the rollout) and otherwise keeps the
-- embedding_768 the writer set.

create or replace function public.codebase_embedding_768()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if new.embedding is not null then
    new.embedding_768 := extensions.l2_normalize(extensions.subvector(new.embedding, 1, 768))::extensions.halfvec(768);
    -- The 768-d copy is what search reads; the 1536-d source is not kept.
    new.embedding := null;
  end if;
  return new;
end;
$function$;

-- Same payload as before (an `embedding` of 1536 numbers per row), so edge
-- code deployed before this change keeps working. The vector is reduced the
-- way the trigger did it (first 768 dimensions, L2-normalized, half
-- precision) and only embedding_768 is written. A null embedding in the
-- payload keeps the stored one, as before.
create or replace function public.upsert_codebase_chunks(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
set statement_timeout to '30s'
as $function$
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
    embedding_768,
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
      when r.embedding is null then null::extensions.halfvec(768)
      else extensions.l2_normalize(
        extensions.subvector(r.embedding::text::extensions.vector(1536), 1, 768)
      )::extensions.halfvec(768)
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
    embedding_768 = coalesce(excluded.embedding_768, existing.embedding_768),
    embedding_model = coalesce(excluded.embedding_model, existing.embedding_model);

  get diagnostics written = row_count;
  return written;
end;
$function$;

revoke all on function public.upsert_codebase_chunks(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_codebase_chunks(jsonb) to service_role;
