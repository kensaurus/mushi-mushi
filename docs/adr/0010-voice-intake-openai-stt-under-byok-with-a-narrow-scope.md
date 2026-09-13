# 0010. Voice intake: OpenAI transcription under BYOK, a narrow `voice:write` scope, audio deleted after transcription

Status: Accepted            Date: 2026-09-12

## Context

The voice loop lets a phone (iOS Shortcut, Slack clip, Telegram voice note,
installed PWA) turn speech into a Mushi report and, after confirmation, a
draft PR. Speech-to-text needs a vendor; the key that lives on a phone needs a
blast radius; the audio itself is personal data under GDPR and Japan's APPI.
The repo already resolves OpenAI keys through `resolveLlmKey` with BYOK,
wallet checks and failover; `gpt-transcribe` costs $0.0045/min, takes
`languages[]` (not `language`) and returns JSON only; `gpt-4o-mini-transcribe`
($0.003/min) is a same-key fallback. Groq's `whisper-large-v3-turbo` is
cheaper but would be a new BYOK provider (slug, validation probe, console UI).

## Decision

- STT is OpenAI only, through `withLlmFailover(db, projectId, 'openai', …)`:
  `gpt-transcribe` first with the project's `voice_languages`, then
  `gpt-4o-mini-transcribe`. No second vendor until a customer asks.
- Phone-resident keys carry the new scope `voice:write`, accepted only by the
  intake routes. `mcp:write` is not reused: it can dispatch, merge and edit
  settings.
- The audio object is deleted from the private `voice-intake` bucket as soon as
  the transcript is persisted, unless the project sets
  `voice_audio_retention_days`. Only the transcript, its SHA-256 and the audio
  SHA-256 are kept. Transcripts pass the PII scrubber before storage. Audio
  never reaches a coding agent; only the sanitised transcript does.
- Every voice request goes through a verbatim-transcript confirmation before a
  PR is opened, and the intake refuses privileged verbs (merge, deploy, delete,
  drop, force push, production, rollback and their Japanese forms) outright.
- `voice_intake_enabled` is off by default per project.

## Rejected alternatives

- **Groq as a fallback** — cheaper per minute, but a new vendor surface for a
  30-second clip whose cost is a fraction of a cent either way.
- **Web Speech API in the browser** — on-device recognition is desktop Chrome
  only; Android ignores `continuous`; standalone iOS is unreliable.
- **Reuse `mcp:write`** — no migration, but a stolen Shortcut key would then
  be able to merge PRs.
- **Keep audio for replay/debugging** — retention is opt-in per project instead.

## Consequences

Adding a vendor later means a new `LlmProvider` slug plus a probe and a console
field. The privacy policy and store labels must name OpenAI as a processor for
voice. The refusal list is a hard block, not a confirmation: a user who really
wants "deploy" types it in the console.
