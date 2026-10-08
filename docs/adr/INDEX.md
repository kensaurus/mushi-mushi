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
| [0015](0015-use-kensaurus-gmail-as-the-product-support-inbox.md) | Use kensaurus@gmail.com as the product support inbox | Accepted | Live inbox is Gmail; do not ship `support@kensaur.us` as the contact |
| [0016](0016-mushi-as-the-app-recipe-control-plane.md) | Mushi as the app recipe control plane | Accepted (owner-delegated, 2026-10-02); sequencing gate struck by [0017](0017-strike-the-plan-019-020-sequencing-gate.md) | Per-project recipe (schema, DTCG tokens, routes, gates, CI, deploy, env names, integrations) as diagnosis context, rolled up per organization into a portfolio; one connector interface (snapshot, drift, propose, act with approval) with least-privilege Vault credentials; drift → `gate_findings`; changes only as draft PRs; category and north star unchanged; amends 0004 |
| [0017](0017-strike-the-plan-019-020-sequencing-gate.md) | Strike the Plan 019/020 sequencing gate | Accepted | Owner, 2026-10-02: "complete all the phases"; Plan 020 §15 decisions taken (portfolio operator = same buyer, drift test counts a hole found before a user hits it; listings as code published by host CI; `public_probe`/`llm_usage`/`revenuecat` connectors; opt-in public diagram; enforce `monthly_llm_budget_usd`); every live connector action still needs a hash-matched, single-use, expiring human approval |
| [0018](0018-gate-findings-are-readable-on-every-plan.md) | Gate findings are readable on every plan | Accepted (owner-delegated, 2026-10-03) | `GET /v1/admin/inventory/:projectId/findings` and `list_gate_findings` drop `inventory_v2`; running gates, crawls, ingest and test generation keep it |
| [0019](0019-sdk-upgrade-lockfile-helper.md) | SDK upgrade PRs get their lockfile from a host-side workflow | Accepted (owner, 2026-10-03) | Host adds `mushi-sdk-lockfile.yml` (public composite action, package manager CLI, `--ignore-scripts`); Mushi pushes the bump, waits in `awaiting_lockfile`, opens the PR after the lockfile commit or 30 min; no hand-edited lockfiles, no `workflows` permission (0016) |
| [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) | The local UX loop runs coding agents in the CLI process, behind a write guard | Accepted (owner, 2026-10-06) | `@mushi-mushi/ux` spawns Cursor / Claude Code / Codex in a `mushi-ux/<run>` worktree; non-GET requests aborted during discovery; keep/revert by probes + pixel diff, different-model review advisory; agent never gets the session or CLI config (0006); cloud runs stay 0013 adapters |
| [0021](0021-a-second-model-may-veto-a-kept-ux-step.md) | A second model may veto a kept UX step; changes with nothing visible are kept for review | Accepted (owner, 2026-10-07) | Amends 0020 decision 4: measurements first; optional checker (Claude via `claude -p` or API) sees changed-area crops twice in swapped order and rolls back only when both prefer the original; invisible changes kept and flagged; nothing merges |
| [0022](0022-host-backend-erasure-deletes-the-subjects-reports.md) | Host-backend erasure deletes the subject's reports | Proposed | `POST /v1/sdk/erase-subject`: erase token signed with the identity secret (`purpose: erase-subject`, ≤5 min); deletes reports + reporter data in one project, screenshots first; org identity only with `erase_identity`; `DELETE /v1/sdk/me` keeps unlinking |

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
