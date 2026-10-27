# 0034. Verifiably local: Mushi can run on your own machines, and proves nothing leaves

Status: Proposed Date: 2026-10-21

Related: [Plan 023](../execplans/local-only.md), ADR
[0016](0016-mushi-as-the-app-recipe-control-plane.md) (standalone-first),
ADR [0023](0023-ai-keys-can-be-shared-by-every-app-in-an-organization.md)/[0031](0031-universal-ai-keys-serve-every-app-their-owner-owns.md)
(key resolution), ADR [0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md)
(local runners), `_shared/egress.ts`, `_shared/byok-validation.ts`,
`_shared/embeddings.ts`, `packages/cli` (`local verify`, `agent serve`),
`deploy/docker-compose.local.yml`.

## Context

The owner wants "everything can be run locally if required" as a security
promise. An inventory on 2026-10-21 found that most integrations already
switch off when unset, but three paths still force traffic out (Anthropic
has no base URL; OpenAI-compatible endpoints must be public https on 443;
fixes and PRs assume github.com), and nothing proves the claim. Products
that only offered a telemetry switch were caught sending data under a
proxy capture (Chaser Systems, 2025-11-04). Local models are weaker than
Opus 5.5 for review, and some local servers ignore parts of a JSON schema.

## Decision

1. **Enforce in code and at the network.** `MUSHI_LOCAL_ONLY=1` routes every
   outbound request through an allowlist that fails closed and records
   denials; the local compose profile also gives the stack no route out
   except an allowlisting proxy.
2. **Prove it.** `mushi local verify` tries known cloud hosts from the edge
   runtime and the host and must see every attempt fail; the console shows
   denials by host and day.
3. **Every vendor path gets a local stand-in**: Anthropic base URL, private
   OpenAI-compatible endpoints (Ollama, vLLM, LM Studio), configurable
   embeddings padded to the existing 1536 columns, `GITHUB_API_URL`, SMTP,
   and a local fix agent (`mushi agent serve` running Claude Code or Codex
   against a local model in a worktree).
4. **Be honest about quality.** Publish measured agreement between the local
   model and Opus 5.5 on real reports and reviews. Local-only fixes stay
   human-reviewed.
5. **Positioning.** "Your bug data can stay on your machines, and you can
   prove it" is Bucket B (self-host, BYOK, standalone). It sits next to
   the diagnosis, not in place of it.

## Consequences

- A local-only deployment loses cloud agents (Cursor, Copilot), Firecrawl,
  Browserbase, public radar probes and store connectors unless the operator
  allowlists them, and says so in the console.
- Changing the embedding model requires a re-embed; vectors from two
  models are never compared.
- The egress guard wraps `fetch` in every function; a missed raw socket
  (none known) would bypass it, which is why the compose profile enforces
  at the network too.

## Rejected

- **A telemetry switch alone.** Not verifiable; the failure mode the market
  already punished.
- **Migrating `vector(1536)` to a new width.** Padding keeps cosine
  similarity and avoids a schema change.
- **Ollama `:cloud` models in local mode.** They run on ollama.com; refused.
