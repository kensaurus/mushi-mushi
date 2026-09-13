# Architecture Decision Records — index

Decision memory for agents and humans. **Code shows what was decided; this
shows why, and what was rejected.** Read this before proposing a change to
architecture, dependencies, conventions, positioning, or testing posture — an
Accepted ADR is not a suggestion, and re-proposing a rejected alternative is
the slowest form of drift.

If a change genuinely needs to contradict an Accepted ADR: **surface it, cite
the ADR, and ask.** Do not silently comply and do not silently override. A
reversal produces a new ADR that supersedes the old one, by the human, on
purpose.

| # | Title | Status | Decision |
|---|-------|--------|----------|
| [0001](0001-no-sentry-routing-wrapper-in-the-admin-router.md) | Keep the admin router unwrapped by Sentry | Accepted | Bare `<Routes>` — the Sentry wrapper broke hook order under React 19 StrictMode |
| [0002](0002-disable-openai-strict-structured-outputs-for-optional-field-schemas.md) | Disable OpenAI strict structured outputs for optional-field schemas | Accepted | `openai(MODEL, { structuredOutputs: false })` when the Zod schema has `.optional()` |
| [0003](0003-feed-gradient-custom-properties-through-the-image-typed-utility.md) | Feed gradient custom properties through `bg-(image:--var)` | Accepted | `bg-[var(--gradient-x)]` compiles to `background-color` and renders nothing |
| [0004](0004-lead-with-the-bug-mediator-category.md) | Lead with "the bug mediator for AI-built apps" | Accepted | One queue between users, monitoring, trackers, chat, and coding agents |
| [0005](0005-treat-the-local-dev-backend-as-production.md) | Treat the local dev backend as production | Accepted | `pnpm dev` proxies to the live project — browser testing is read-only by default |
| [0006](0006-never-hand-authenticated-sessions-to-peer-agents.md) | Never hand authenticated sessions to peer agents | Accepted | No `state-save`, profile path, or credential env-var names to another agent |
| [0007](0007-knip-is-the-dead-code-gate.md) | Knip is the dead-code gate, ratcheted inside the build job | Accepted | knip@6 twice in `build` with pinned --max-issues; Deno excluded by project negation; public barrels tagged `@public` |
| [0008](0008-keep-the-hosted-mcp-server-hand-rolled.md) | Keep the hosted MCP server hand-rolled; add the 2026-07-28 era in place | Accepted | Dual-era handler; no SDK in the edge bundle; npm `packages/mcp` moves to SDK v2 |
| [0009](0009-a2a-1-0-wire-format-with-0-3-aliases.md) | Speak the A2A 1.0 wire format, keep 0.3 names as aliases | Accepted | `taskPushNotificationConfig`, StreamResponse callbacks, `agent-card.json`, old paths aliased |
| [0010](0010-voice-intake-openai-stt-under-byok-with-a-narrow-scope.md) | Voice intake: OpenAI STT under BYOK, narrow `voice:write` scope, audio deleted after transcription | Accepted | gpt-transcribe then gpt-4o-mini-transcribe; no Groq; verbatim confirmation; privileged verbs refused |
| [0011](0011-telegram-bot-is-the-android-voice-inbox.md) | A Telegram bot is the Android voice inbox | Accepted | No public Assistant/Gemini path; per-project bot + secret-token webhook + chat binding |
| [0012](0012-web-push-via-pushforge-with-an-endpoint-allowlist.md) | Web Push on Web Crypto behind an endpoint allowlist | Accepted, library choice reversed | `@pushforge/builder` emits pre-standard `aesgcm`, not RFC 8291 `aes128gcm`, so RFC 8291/8292 are implemented directly; fcm / mozilla / apple / wns hosts only; VAPID as edge secrets |
| [0013](0013-cloud-coding-agents-run-through-edge-adapters.md) | Cloud coding agents dispatch through edge adapters; `packages/agents` archived | Accepted | Cursor v1 + v0 webhook + poller, GitHub Agent Tasks, Anthropic stub; unknown agent = 400 |
| [0014](0014-mcp-npm-package-runs-on-sdk-v2.md) | The published MCP package runs on SDK v2; the hosted server stays hand-rolled | Accepted | Splits the decision from 0008 — no bundle cap on npm; `serveStdio` is what serves 2026-07-28; unknown tool now `-32602` |

## Conventions

- **File:** `docs/adr/NNNN-short-title.md`, numbered sequentially, one page.
- **Statuses:** Proposed → Accepted → Superseded by NNNN / Deprecated.
- **Never edit an Accepted ADR's decision** — supersede it with a new one that
  links back. The history is the point.
- **Same PR:** an ADR lands with the change it records, not afterwards.

## What gets an ADR

Anything an agent could plausibly reverse while "helping": stack and dependency
choices (and the rejected ones), architecture and layering, conventions with
non-obvious rationale, product/scope decisions that shape code, and reversals
of past attempts — the "we already tried that" archive.

**Not** ADRs: routine implementation choices, anything a linter or CI gate
already enforces mechanically, TODOs, or meeting notes. Over-recording kills
the system as surely as under-recording.
