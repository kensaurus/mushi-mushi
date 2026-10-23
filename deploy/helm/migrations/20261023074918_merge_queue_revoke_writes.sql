-- Only the service role writes the merge queue (ADR 0041); members read it.
revoke insert, update, delete, truncate on table public.fix_merge_queue from authenticated;
revoke all on table public.fix_merge_queue from anon;
