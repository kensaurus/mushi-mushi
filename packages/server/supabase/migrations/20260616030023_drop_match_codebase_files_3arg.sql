-- PostgREST cannot disambiguate match_codebase_files(vector, uuid, integer) vs
-- match_codebase_files(vector, uuid, integer, text) when path_prefix is omitted
-- or null — callers get PGRST203 / "function is not unique" and RAG returns empty.
-- Keep the 4-arg form only (path_prefix DEFAULT NULL).

DROP FUNCTION IF EXISTS public.match_codebase_files(vector, uuid, integer);
DROP FUNCTION IF EXISTS public.match_codebase_files(vector(1536), uuid, integer);

GRANT EXECUTE ON FUNCTION public.match_codebase_files(vector, uuid, integer, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
