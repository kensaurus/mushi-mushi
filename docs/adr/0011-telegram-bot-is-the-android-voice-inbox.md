# 0011. A Telegram bot is the Android voice inbox

Status: Accepted            Date: 2026-09-12

## Context

iOS has a first-party path (Shortcuts + Siri dictation posts text). Android
has none: Google sunset Conversational Actions on 2023-06-13, App Actions can
only launch the app's own intents, and `androidx.appfunctions` is at
1.0.0-alpha11 (2026-08-26) with Gemini access in a private preview for
selected partners. A native Android app would need a Play listing and a
release train for a feature that is a voice note.

## Decision

Android users talk to a per-project Telegram bot. The bot token is stored as a
vault reference on `project_settings`, the webhook is registered with a
per-project `secret_token`, chats bind to a project through a one-time
`/start <code>` minted in the console, voice notes are downloaded through
`getFile` (20 MB cap) and transcribed by the same STT path as every other
inbox, and confirmation is an inline keyboard. The installed admin PWA with
`share_target` and tap-to-talk is the secondary Android path for people who
do not use Telegram.

## Rejected alternatives

- **App Actions / custom intents** — launches a screen; cannot deliver text in
  the background, and Assistant is being replaced by Gemini anyway.
- **AppFunctions + Gemini** — the right long-term API, but private preview by
  invitation; supersede this ADR when it is public.
- **A native Android app** — a release train for a voice note.
- **LINE, WhatsApp, Discord bots** — viable later; Telegram has the simplest
  bot API (no business verification, secret-token webhooks, opus voice notes).

## Consequences

Telegram becomes a processor of voice data for projects that enable it (the
docs say so). The `telegram-webhook` function is public (no Supabase JWT) and
relies on the secret-token header plus chat bindings for authorisation.
