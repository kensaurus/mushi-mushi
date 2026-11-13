-- Journey optimizer: record visits on demand (ADR 0058).
--
-- An app whose SDK runs with `trackSessions: 'on-demand'` sends no session
-- events until the console opens a recording window. While
-- `journey_recording_until` is in the future, GET /v1/sdk/config returns
-- `journeys: { recordUntil, sampleRate }` and that share of visitors (a stable
-- per-device draw) records page views until the window closes. Everyone else,
-- and everyone after the window, sends nothing: no load on real users unless
-- the owner asks for it.

alter table public.project_settings
  add column if not exists journey_recording_until timestamptz,
  add column if not exists journey_recording_sample real not null default 0.1
    check (journey_recording_sample > 0 and journey_recording_sample <= 1);

comment on column public.project_settings.journey_recording_until is
  'Journey optimizer: SDKs in trackSessions on-demand mode record visits until this time (null = off).';
comment on column public.project_settings.journey_recording_sample is
  'Journey optimizer: share of visitors (0-1] recorded while journey_recording_until is in the future.';
