-- ivfflat.probes 10 (20261009154000) returned 3 of the exact top 5 for a
-- report in the largest project (23.5k chunks). At 20 probes all three test
-- reports matched the exact top 5 (15/15), at ~350 ms warm per lookup.

-- Load pgvector so the ivfflat.* settings are registered (see 154000).
select extensions.vector_dims('[1]'::extensions.vector);

alter function public.match_codebase_files(vector, uuid, integer, text)
  set ivfflat.probes = '20';
alter function public.match_codebase_files(vector, uuid, integer, text)
  set ivfflat.max_probes = '60';
