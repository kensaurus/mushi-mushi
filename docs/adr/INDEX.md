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
