-- A Cursor key Cursor refused for its plan's usage limit: new agents go to the
-- next key until then; runs it already started keep polling with it.
alter table public.byok_keys add column if not exists exhausted_until timestamptz;

comment on column public.byok_keys.exhausted_until is
  'Cursor refused this key for its usage limit; new agents use the next key in the pool until this time (agent-adapters cursorKeyForNewWork, spend-down).';
