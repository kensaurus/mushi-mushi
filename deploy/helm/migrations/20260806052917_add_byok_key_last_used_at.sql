-- Track the credential that actually completed a provider call. This powers
-- pool-aware Settings surfaces without marking every resolved candidate used.

alter table public.byok_keys
  add column if not exists last_used_at timestamptz;

comment on column public.byok_keys.last_used_at is
  'Timestamp of the latest successful provider call completed with this pooled credential.';

notify pgrst, 'reload schema';
