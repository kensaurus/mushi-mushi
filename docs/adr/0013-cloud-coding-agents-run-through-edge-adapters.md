# 0013. Cloud coding agents dispatch through edge adapters; `packages/agents` is archived

Status: Accepted            Date: 2026-09-12

## Context

`packages/agents` exports a `FixOrchestrator` that nothing constructs at
runtime (private package, no dependents, referenced only by its README and
registry seeds). Meanwhile the live fix path is the Deno `fix-worker`, and
"cloud" agents were half-wired: `cursor_cloud` is allowed by the
`autofix_agent` CHECK and promised by the MCP tool docs, but the dispatch route
silently nulled it and the worker skipped it; three divergent Cursor clients
existed (the npm plugin on the documented v0 body, `_shared/plugins.ts` on an
undocumented body, an unreachable adapter in `packages/agents`); nothing wrote
`fix_attempts.cursor_*` or `pr_url`, so `webhooks-github-indexer` dropped every
Cursor PR as `pr_not_a_mushi_fix`. Cursor's v1 API (top-level `autoCreatePR`,
`agentId` idempotency, PR URL at `run.git.branches[].prUrl`) has no webhooks
yet; v0 webhooks exist. GitHub's Agent Tasks REST API (public preview,
`X-GitHub-Api-Version: 2026-03-10`) accepts only user-to-server tokens and has
no webhook. Anthropic Managed Agents is in beta with Standard Webhooks and a
`session.budget_reached` event.

## Decision

Cloud agents are edge-side adapters behind one interface
(`_shared/agent-adapters.ts`: `dispatch` and `poll`), selected by
`autofix_agent` / `agent_override` exactly like the in-edge worker:
`cursor_cloud` on the v1 API with a deterministic `agentId` per dispatch,
completion by the legacy v0 webhook when enabled and by a pg_cron poller on an
offset minute otherwise; `github_cloud_agent` on Agent Tasks with a per-project
user token (vault reference) and polling; `anthropic_managed` is a typed stub
until the product leaves beta. Every adapter writes the `fix_attempts` row up
front and `pr_url` on completion so the GitHub indexer, the merge loop and the
notifications work unchanged. Unknown agent kinds are a 400, never a silent
downgrade. `packages/agents` is archived: kept in the tree as reference for
one release, excluded from lint and knip, not published, not wired.

## Rejected alternatives

- **A Node-side worker around `FixOrchestrator`** — a second runtime to
  deploy, monitor and secure, for orchestration the edge worker already does.
- **Delete `packages/agents` now** — it holds the only written-down design for
  sandbox providers and spec validation; delete after one release with the
  register as evidence.
- **Cursor v0 only** — v0 is "legacy" with no sunset date; v1 has idempotency
  and the run model. v0 stays as the push-callback option only.
- **Wait for Cursor v1 webhooks / GitHub Agent Tasks webhooks** — polling on
  an offset minute costs one function call per five minutes per project.

## Consequences

`mushi fix --agent cursor_cloud` works or fails loudly. GitHub cloud-agent
dispatch requires a user token and a paid Copilot plan; the console says so.
A PR opened by a cloud agent before its status callback is matched later by
branch name. Supersede this ADR when Cursor ships v1 webhooks or Managed
Agents leaves beta.
