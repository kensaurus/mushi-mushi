# Plan 023 — Verifiably local: run all of Mushi on your own machines, and prove nothing leaves

Status: `PLANNED` (2026-10-21). Decision record: [ADR 0034](../adr/0034-verifiably-local-mode.md).

## Why

AI-built apps hold real users' data, and the people building them are wary
of yet another cloud service reading it. Mushi already works without
Sentry, Supabase cloud, or any one LLM vendor (VISION: standalone-first,
BYOK, self-host). It cannot yet promise "your bug data never leaves your
machines", because three paths still force traffic out, and nothing proves
the claim. Products that only offer a telemetry switch have been caught
sending data anyway (Copilot and Cursor under mitmproxy, Chaser Systems
2025-11-04; Trae, The Register 2025-07-28). Network-level enforcement plus a
self-test is the credible version.

## What forces traffic out today (inventory 2026-10-21)

| Gap | Where |
|---|---|
| Anthropic client has no base URL; probes hard-coded | `_shared/claude-messages.ts:70`, `integration-probes.ts:211,570`, `byok-validation.ts:176` |
| OpenAI-compatible base URL must be https, port 443, allowlisted public host | `_shared/byok-validation.ts:105-140`, `byok.ts:571` |
| Fallback model ids fixed (`gpt-5.4`); only `claude-*` overrides read | `_shared/models.ts:66-69`, `project-models.ts:26` |
| Embeddings: `text-embedding-3-small`, 1536 hard-coded | `_shared/embeddings.ts:10-11,402`; `vector(1536)` columns |
| GitHub only (`api.github.com`), no Enterprise Server / Gitea | `_shared/github*.ts` |
| Fix agents `codex` / `mcp` are stubs; `claude_code` is a server LLM call | `agent-adapters.ts:80-95`, `fix-worker/index.ts:296-326` |
| Email via Resend only | `_shared/email.ts:22,57` |
| npm registry cron, radar/site-watch probes, store connectors always reach out when on | `sdk-upgrade-plan.ts:206`, `radar/public-probes.ts` |
| Admin image falls back to the cloud Supabase URL | `apps/admin/src/lib/env.ts:16-18,155-165`, `Dockerfile.admin` |
| QA `local` provider is a stub | `qa-story-runner/index.ts:840-848` |

Already local-capable: Supabase self-host (Docker Compose: Auth, PostgREST,
Realtime, Storage, Edge Runtime), self-hosted Sentry DSN, self-hosted
Langfuse URL, OTLP endpoint, Supabase Storage / private MinIO, SDK and CLI
endpoints (`apiEndpoint`, `MUSHI_API_ENDPOINT`), CLI telemetry and update
check switches, `mushi ux` (fully local).

## Facts this plan relies on (read 2026-10-21)

- Supabase self-host via Docker Compose ships Edge Runtime, Storage, Auth,
  Realtime; no branching, PITR, or multi-project Studio.
  https://supabase.com/docs/guides/self-hosting/docker
- Ollama: OpenAI-compatible `/v1/chat/completions` with tools and
  `response_format`; since v0.14 also the Anthropic Messages API
  (`ANTHROPIC_BASE_URL=http://localhost:11434`).
  https://docs.ollama.com/api/openai-compatibility,
  https://docs.ollama.com/integrations/claude-code
- vLLM: structured outputs via `response_format` json_schema, on by default.
  https://docs.vllm.ai/en/latest/features/structured_outputs.html
- llama.cpp server silently ignores unsupported schema keywords → always
  Zod-validate and retry.
- qwen3-embedding (Ollama) takes a user-defined dimension (32–4096);
  zero-padding a shorter vector keeps cosine similarity unchanged, so the
  1536 columns stay.
- Claude Code offline: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `skipWebFetchPreflight: true`, marketplace auto-install off.
  https://code.claude.com/docs/en/data-usage. Codex: `codex exec --oss`
  with `oss_provider = "ollama"`, analytics off. Ollama `:cloud` model tags
  run remotely and must be refused.
- Docker `internal: true` networks still reach the gateway; a Squid
  `dstdomain` allowlist with `deny all` plus no other route is the
  enforceable pattern.

## Contracts

- `MUSHI_LOCAL_ONLY=1` (edge env) — every outbound request goes through
  `_shared/egress.ts`. Allowed: the Supabase URL host, loopback, RFC1918,
  `*.internal`/`*.local`, and `MUSHI_EGRESS_ALLOW` (comma list of hosts).
  Anything else throws `EgressBlockedError` before the socket opens and
  records `{host, caller, at}` in `egress_denials` (counts per host per
  day). Installed once in the shared bootstrap every function imports.
- LLM: `ANTHROPIC_BASE_URL` and BYOK `base_url` for `anthropic`;
  OpenAI-compatible base URLs accept http and private hosts when local-only
  (or `MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT=1`); `MUSHI_LLM_MODEL_FAST`,
  `MUSHI_LLM_MODEL_SMART`, `MUSHI_LLM_MODEL_REVIEW` override ids for any
  provider.
- Embeddings: `MUSHI_EMBEDDING_MODEL`, `MUSHI_EMBEDDING_BASE_URL`,
  `MUSHI_EMBEDDING_DIMENSIONS` (≤ 1536; padded to 1536); rows record
  `embedding_model`; a model change queues a re-embed.
- Git host: `GITHUB_API_URL` (GitHub Enterprise Server). Gitea/GitLab:
  backlog.
- Email: `SMTP_URL` (smtp(s)://user:pass@host:port) as an alternative to
  Resend.
- Local fix agent: `mushi agent serve` on the user's machine claims fixes
  dispatched with `agent: 'local'`, runs `claude -p` / `codex exec --oss` /
  `aider` in a git worktree with the offline env set, pushes the branch,
  opens the PR through the configured git host, reports back over the
  Mushi API.
- Self-test: `mushi local verify` — tries api.anthropic.com,
  api.openai.com, ollama.com, sentry.io, api.github.com, registry.npmjs.org
  from the edge runtime (`GET /v1/admin/egress/selftest`) and from the
  host; every attempt must fail; prints the denial log and the allowlist.
- Console: Settings → Security → "Data egress": local-only on/off, the
  allowlist, denials by host and day, and a per-integration "what leaves"
  table.

## Phases

- [ ] **Phase 0 — enforce and prove.** `egress.ts` + `egress_denials` +
  bootstrap install + selftest route + `mushi local verify` + console card.
- [ ] **Phase 1 — local models.** Anthropic base URL; private
  OpenAI-compatible endpoints under local-only; model id env overrides;
  probes follow the base URL; Zod validate + one retry on schema misses.
- [ ] **Phase 2 — local embeddings.** Configurable model/base/dims with
  padding; `embedding_model` column; re-embed queue.
- [ ] **Phase 3 — local fix agent.** `agent: 'local'` dispatch kind;
  `mushi agent serve` (claim, worktree, run, push, PR, report); offline env
  for Claude Code and Codex; refuses Ollama `:cloud` models.
- [ ] **Phase 4 — git host + email + gated probes.** `GITHUB_API_URL`;
  SMTP; npm cron, radar public probes, store connectors, web push off
  under local-only unless allowlisted.
- [ ] **Phase 5 — packaging.** `deploy/docker-compose.local.yml`: Supabase
  stack + Mushi functions + admin + optional Ollama, all on an internal
  network with a Squid allowlist sidecar as the only route out; admin
  image takes `VITE_*` at runtime; `mushi selfhost up --local`.
- [ ] **Phase 6 — quality eval.** Replay 50 recent reports through the
  local model for classification and through the local reviewer for 20
  reviewed PRs; publish agreement vs Opus 5.5 next to the setup docs.
- [ ] **Phase 7 — tell people.** Docs "Run Mushi entirely on your machines"
  with an honest list of what uses the network when you turn it on (model
  downloads, updates); landing Bucket B line "Your bug data can stay on
  your machines — and you can prove it: `mushi local verify`".

## Verification

- Unit: egress allowlist matcher (IPv4/IPv6 private ranges, DNS names,
  ports, userinfo tricks), denial recording, base URL validation matrix,
  embedding padding (cosine unchanged), agent offline env.
- Live: a compose stack on a machine with no default route except the
  Squid sidecar; `mushi local verify` all-fail; a report classified by a
  local model; a fix PR opened by `mushi agent serve` with Ollama.
