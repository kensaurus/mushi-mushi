# @mushi-mushi/agents

Agentic fix pipeline for Mushi Mushi — orchestrates coding agents to auto-generate fix PRs from classified bug reports.

## How It Works

1. **Orchestrator** picks up a report flagged for auto-fix
2. **Scope checker** limits which files the agent can touch
3. **Agent adapter** generates a code fix (Claude Code, Codex, or generic MCP)
4. **Review** validates the fix against scope and quality rules
5. **GitHub integration** creates a PR with the fix

## Components

| Module | Purpose |
|--------|---------|
| `FixOrchestrator` | Single-repo pipeline — assembles context, dispatches to agent, handles PR creation |
| `MultiRepoFixOrchestrator` | Coordinates a fix across multiple repos in `project_repos` (FE+BE+infra), spawns one `FixOrchestrator` per repo, rolls up status, cross-links PRs |
| `McpFixAgent` | True MCP adapter using `tools/call` + SEP-1686 Tasks |
| `RestFixWorkerAgent` | Plain REST adapter for self-hosted fix workers |
| `GenericMCPAgent` | Legacy MCP adapter (kept for back-compat; new integrations should use `McpFixAgent`) |
| `ClaudeCodeAgent` | Claude Code adapter (experimental) |
| `CodexAgent` | OpenAI Codex adapter (experimental) |
| `checkFileScope` | Validates that fixes only touch allowed files |
| `checkCircuitBreaker` | Prevents runaway fix attempts |
| `createPR` / `buildPRBody` | GitHub PR creation via Octokit |
| `resolveSandboxProvider` / `LocalNoopSandboxProvider` / `createE2BProvider` / `createModalProvider` / `createCloudflareProvider` | Managed sandbox abstraction (V5.3 §2.10) — `local-noop`, `e2b`, `modal`, and `cloudflare` adapters |
| `SandboxAuditWriter` | Persists per-step sandbox audit events |

## Usage — single repo

```ts
import { FixOrchestrator } from '@mushi-mushi/agents'

const orchestrator = new FixOrchestrator(supabaseClient, {
  githubToken: process.env.GITHUB_TOKEN,
  owner: 'your-org',
  repo: 'your-app',
})

await orchestrator.run(reportId)
```

## Usage — multi-repo

When a single bug spans multiple repos (FE + BE, monorepo + infra, etc.), register
each repo in `project_repos` with `path_globs` and a `role` (`primary`,
`frontend`, `backend`, `infra`, …), then drive the higher-level orchestrator:

```ts
import { MultiRepoFixOrchestrator } from '@mushi-mushi/agents'

const multi = new MultiRepoFixOrchestrator(supabaseClient, {
  githubToken: process.env.GITHUB_TOKEN,
})

const plan = await multi.plan(reportId)
const result = await multi.execute(plan.coordinationId)
await multi.linkPRs(plan.coordinationId)
```

Status rolls up to `succeeded` / `partial_success` / `failed` based on each
child `fix_attempts` row stamped with `coordination_id` + `repo_id`. See
`docs/content/concepts/multi-repo-fixes.mdx` for the full flow diagram.

## Agent Configuration

The orchestrator reads `autofix_agent` and `autofix_mcp_server_url` from the project's `project_settings` row in Supabase. For `generic_mcp`, the MCP server URL is required:

| Setting | Values | Default |
|---------|--------|---------|
| `autofix_agent` | `claude_code`, `codex`, `generic_mcp` | `claude_code` |
| `autofix_mcp_server_url` | URL of the MCP-compatible agent server | — |

## Security: Sandbox

`sandbox.ts` generates a JSON spec document describing intended container constraints (gVisor/Docker, no network, 10min timeout, 4GB RAM cap, scoped credentials). **This spec is not enforced at runtime.** The fix agent runs with whatever permissions the host process has.

If deploying fix agents in production, you must implement your own container isolation. The generated spec can be used as a reference for configuring Docker/gVisor/Firecracker constraints.

## Sandbox Provider

Beyond the JSON spec, the package now ships a runtime provider abstraction:

```ts
import { resolveSandboxProvider, buildSandboxConfig } from '@mushi-mushi/agents'

const provider = resolveSandboxProvider({
  name: process.env.MUSHI_SANDBOX_PROVIDER ?? 'local-noop',
  e2b: { apiKey: process.env.E2B_API_KEY },
  modal: { token: process.env.MODAL_TOKEN, endpoint: process.env.MODAL_ENDPOINT },
  cloudflare: { token: process.env.CLOUDFLARE_SANDBOX_TOKEN, workerUrl: process.env.CLOUDFLARE_SANDBOX_WORKER_URL },
})
const sandbox = await provider.create(buildSandboxConfig({ reportId }))
```

Available providers:

| Name | Module | What it does |
|------|--------|-------------|
| `local-noop` | `LocalNoopSandboxProvider` | Default, no isolation. **The orchestrator refuses to run this in production unless `MUSHI_ALLOW_LOCAL_SANDBOX=1`** |
| `e2b` | `createE2BProvider` | Managed microVMs via the E2B REST API; deny-by-default egress |
| `modal` | `createModalProvider` | Modal Sandboxes REST adapter (`POST /v1/sandboxes/...`); per-sandbox `allowed_hosts` egress allowlist |
| `cloudflare` | `createCloudflareProvider` | Cloudflare Workers Sandbox SDK adapter (`POST /sandbox`, `POST /sandbox/:id/process`); egress enforced by Cloudflare outbound rules |

All exec/file events flow through `SandboxAuditWriter` into the `sandbox_runs`
table for SOC 2 evidence. `MUSHI_GIT_TOKEN=...` is redacted from stdout/stderr
before audit persistence.

## Status

- **McpFixAgent** — production adapter; speaks MCP `tools/call` + SEP-1686 Tasks
- **RestFixWorkerAgent** — production adapter for self-hosted REST workers
- **GenericMCPAgent** — legacy adapter; new integrations should pick `McpFixAgent`
- **ClaudeCodeAgent** — stub (returns `success: false`); pending Channels API access
- **CodexAgent** — stub (returns `success: false`); pending direct API integration
- **MultiRepoFixOrchestrator** — production; backed by `project_repos` + `fix_coordinations` migrations

## License

[BSL 1.1](../server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
