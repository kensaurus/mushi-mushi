/*
FILE: 20260912008000_usage_events_voice_minutes.sql
PURPOSE: Let voice intake record transcribed minutes in the usage ledger
         (plan docs/execplans/dead-code-voice-agent-loop.md, C7
         "usage events for billing").

OVERVIEW:
`usage_events.event_name` is guarded by a CHECK allowlist. `_shared/voice-intake.ts`
inserts `voice_minutes_transcribed` after a successful transcription, with the
session id, source, clip duration, STT model and STT cost in `metadata`. Without
this migration that insert fails the constraint and is swallowed by the caller's
non-fatal branch — the ledger stays empty and nobody notices.

NOT BILLABLE. `usage-aggregator/index.ts` pushes a Stripe meter event only for
event names in its own `meteredEvents` list, and `voice_minutes_transcribed` is
deliberately absent from it. This row is an internal cost record for the console
and for per-project review. Adding it to that list is what would make it
billable, and that needs a priced SKU and a Stripe meter created by
stripe-bootstrap.mjs first.

`quantity` is whole started minutes, matching how the daily minutes cap counts
(`VOICE_MINUTES_PER_DAY`), so the ledger and the cap never disagree.

DEPENDENCIES: public.usage_events

Idempotent: safe to re-run.
*/

ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_name_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_event_name_check
  CHECK (event_name = ANY (ARRAY[
    'reports_ingested'::text,
    'fixes_attempted'::text,
    'fixes_succeeded'::text,
    'classifier_tokens'::text,
    'diagnoses'::text,
    'voice_minutes_transcribed'::text
  ]));

COMMENT ON CONSTRAINT usage_events_event_name_check ON public.usage_events IS
  'Allowlist of internal usage event names. Being listed here does NOT make an '
  'event billable — usage-aggregator/index.ts maps only its own meteredEvents '
  'list to Stripe meters. voice_minutes_transcribed is intentionally recorded '
  'but not metered.';
