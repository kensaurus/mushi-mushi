---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/vue': minor
'@mushi-mushi/svelte': minor
'@mushi-mushi/angular': minor
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
---

# v0.6.0 — Wave A: hardening + agentic-fix orchestration

This release closes the highest-priority gaps between the V5 whitepaper and the
running code. It is the first of four releases on the [V5.3 roadmap](../MushiMushi_Whitepaper_V5.md#appendix-c-implementation-roadmap)
and the breaking-change surface is **zero** for SDK consumers.

## Highlights

- **Vision air-gap**: Stage-2 vision analysis now sees the screenshot only with
  trusted metadata; visible text in the image is captured separately and
  flagged so prompt-injection attempts (e.g. an attacker writing "ignore all
  previous instructions" inside their screenshot) cannot influence
  classification. (V5.3 §2.3.2)
- **Judge OpenAI fallback**: `judge-batch` now falls back to OpenAI
  (`gpt-4.1` by default) when Anthropic is unavailable, restoring the
  self-improvement loop during outages. Configure via
  `project_settings.judge_fallback_provider`. (V5.3 §2.7)
- **Blast-radius MV refresh**: `blast_radius_cache` is now refreshed every
  15 minutes via `pg_cron` with a `REFRESH MATERIALIZED VIEW CONCURRENTLY`
  guarded by an advisory lock. Per-project graph-edge pruning runs nightly.
  (V5.3 §2.4)
- **RAG codebase indexer**: GitHub App webhook + `mushi index <path>` CLI
  fallback for non-GitHub git hosts. Symbol-aware chunking (TS/TSX, JS/JSX,
  Python, Go, Rust). (V5.3 §2.3.4)
- **Fix dispatch end-to-end**: Admin can dispatch fixes from the report detail
  page; status streams over Hono `streamSSE` with Bearer auth and
  CVE-2026-29085-safe sanitization. (V5.3 §2.10, §2.16)
- **Sandbox provider abstraction**: `local-noop` (tests) and `e2b` (managed
  sandbox) implementations behind a `SandboxProvider` interface; per-event
  audit log in `fix_sandbox_events`. The orchestrator refuses `local-noop` in
  production. (V5.3 §2.10)
- **True MCP adapter**: `McpFixAgent` speaks JSON-RPC 2.0 with `tools/call`
  and supports SEP-1686 long-running Tasks. The misnamed `generic_mcp` agent
  is renamed to `rest_fix_worker`; the old export is kept as a deprecated
  alias for one more minor. (V5.3 §2.10)
- **BYOK schema**: `byok_anthropic_key_ref` / `byok_openai_key_ref` columns
  with audit log; resolver helper falls back to env when no BYOK is set.
  End-to-end wiring lands in v0.8.0. (V5.3 §2.18)

## Cross-cutting fixes

- Widget min description length raised from 5 to 20 chars (server zod schema
  matched). Empirically removes ~30% of unactionable reports.
- `recordPromptResult` now scopes by `(project_id, stage, version)` so two
  projects sharing a version label cannot corrupt each other's running
  averages. New unique index enforces this.
- Cloud URL: SDK default endpoint now points at the live Supabase Cloud
  function URL instead of the unbound `api.mushimushi.dev` placeholder.
  Self-hosted users MUST override `apiEndpoint` (no behaviour change).
- README updated to honestly reflect what's shipped vs. scaffolded.

## Migrations included

`20260418000000_vision_air_gap`, `20260418000100_judge_fallback`,
`20260418000200_blast_radius_mv_refresh`, `20260418000300_codebase_indexer`,
`20260418000400_fix_dispatch_jobs`, `20260418000500_sandbox_audit`,
`20260418000600_mcp_agent_enum`, `20260418000700_prompt_versions_unique`,
`20260418000800_byok_keys`.

## Breaking changes

None for SDK consumers. Operators with custom `autofix_agent = 'generic_mcp'`
should migrate to `'rest_fix_worker'` (deprecated alias still works through v0.7).
