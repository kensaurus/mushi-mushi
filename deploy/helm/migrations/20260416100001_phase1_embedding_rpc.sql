create or replace function match_report_embeddings(
  query_embedding vector,
  match_threshold float,
  match_count int,
  p_project_id uuid
)
returns table (
  report_id uuid,
  similarity float,
  description text,
  category text,
  created_at timestamptz,
  report_group_id uuid
)
language sql stable
as $$
  select
    re.report_id,
    1 - (re.embedding <=> query_embedding) as similarity,
    r.description,
    r.category,
    r.created_at,
    r.report_group_id
  from report_embeddings re
  join reports r on r.id = re.report_id
  where r.project_id = p_project_id
    and re.model = 'text-embedding-3-small'
    and 1 - (re.embedding <=> query_embedding) > match_threshold
  order by re.embedding <=> query_embedding
  limit match_count;
$$;
