# @mushi-mushi/agents

Agentic fix pipeline for Mushi Mushi — orchestrates coding agents to auto-generate fix PRs from classified bug reports.

## How It Works

1. **Orchestrator** picks up a report flagged for auto-fix
2. **Inventory anchor** is recovered from the `reports_against` graph edge (or accepted as a `inventoryActionNodeId` override) and threaded into the `FixContext`
3. **Scope checker** limits which files the agent can touch
4. **Agent adapter** generates a code fix (Claude Code, Codex, or generic MCP) — its prompt now carries the inventory Action's `expected_outcome` contract verbatim
5. **`validateResult` + `validateAgainstSpec`** validate the fix against scope, quality rules, AND the spec contract before opening a PR
6. **GitHub integration** creates a PR with the fix
7. **Post-PR synthetic probe** is queued against the originating Action; results land in `synthetic_runs` within minutes of merge

## Components

| Module | Purpose |
|--------|---------|
| `FixOrchestrator` | Single-repo pipeline — assembles context, dispatches to agent, handles PR creation |
| `MultiRepoFixOrchestrator` | Coordinates a fix across multiple repos in `project_repos` (FE+BE+infra), spawns one `FixOrchestrator` per repo, rolls up status, cross-links PRs |
| `loadInventoryAnchor` | Walks the `reports_against` graph edge to recover the originating inventory `Action` for a report (action node id, label, page, story, `expected_outcome`) |
| `renderSpecContext` | Formats the inventory anchor + `expected_outcome` into the Markdown block injected into the LLM review prompt |
| `validateAgainstSpec` | Deterministic pre-PR gate — hard error if the diff removes a `json_path` field the contract asserts on; soft warnings if no changed file references the contract's table / page route. Warnings are persisted to `fix_attempts.spec_validation_warnings` |
| `McpFixAgent` | True MCP adapter using `tools/call` + SEP-1686 Tasks |
| `RestFixWorkerAgent` | Plain REST adapter for self-hosted fix workers |
| `GenericMCPAgent` | Legacy MCP adapter (kept for back-compat; new integrations should use `McpFixAgent`) |
| `ClaudeCodeAgent` | Claude Code CLI adapter — opt-in via `MUSHI_ENABLE_CLAUDE_CODE_AGENT=1` |
| `CodexAgent` | OpenAI Codex adapter (experimental) |
| `checkFileScope` | Validates that fixes only touch allowed files |
| `checkCircuitBreaker` | Prevents runaway fix attempts |
| `createPR` / `buildPRBody` | GitHub PR creation via Octokit |
| `resolveSandboxProvider` / `registerSandboxProvider` / `unregisterSandboxProvider` / `KNOWN_SANDBOX_PROVIDERS` | Managed sandbox abstraction (V5.3 §2.10) — first-party `local-noop` / `e2b` / `modal` / `cloudflare`, plus an open contract that lets third-party providers (Daytona, Sealos, internal corp) register at runtime |
| `LocalNoopSandboxProvider` / `createE2BProvider` / `createModalProvider` / `createCloudflareProvider` | First-party adapter factories |
| `SandboxAuditWriter` | Persists per-step sandbox audit events |
| `FIX_CONTEXT_JSON_SCHEMA` / `FIX_RESULT_JSON_SCHEMA` / `SANDBOX_PROVIDER_JSON_SCHEMA` / `EXPECTED_OUTCOME_JSON_SCHEMA` / `AGENT_JSON_SCHEMAS` | Hand-authored draft-07 JSON Schemas for the public agent contracts. Served by the api function at `/v1/schemas/*` so non-TS orchestrators (Python LangGraph, Go agents, A2A skill cards) can consume the contract without typing-by-hand |

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

First-party providers:

| Name | Module | What it does |
|------|--------|-------------|
| `local-noop` | `LocalNoopSandboxProvider` | Default, no isolation. **The orchestrator refuses to run this in production unless `MUSHI_ALLOW_LOCAL_SANDBOX=1`** |
| `e2b` | `createE2BProvider` | Managed microVMs via the E2B REST API; deny-by-default egress |
| `modal` | `createModalProvider` | Modal Sandboxes REST adapter (`POST /v1/sandboxes/...`); per-sandbox `allowed_hosts` egress allowlist |
| `cloudflare` | `createCloudflareProvider` | Cloudflare Workers Sandbox SDK adapter (`POST /sandbox`, `POST /sandbox/:id/process`); egress enforced by Cloudflare outbound rules |

### Third-party providers (2026-05-09 audit)

`SandboxProvider['name']` is now an open `KnownSandboxProvider | (string & {})` union — register your own provider once at boot and `resolveSandboxProvider` will pick it up:

```ts
import { registerSandboxProvider, type SandboxProvider } from '@mushi-mushi/agents'

const daytonaProvider: SandboxProvider = {
  name: 'daytona-corp',
  createSandbox: async (config, onAudit) => { /* … */ },
}

registerSandboxProvider('daytona-corp', () => daytonaProvider)
// now `project_settings.sandbox_provider = 'daytona-corp'` resolves to your adapter
```

The registry refuses to overwrite first-party providers (`KNOWN_SANDBOX_PROVIDERS = ['e2b', 'modal', 'cloudflare', 'local-noop']`). All exec/file events flow through `SandboxAuditWriter` into the `sandbox_runs` table for SOC 2 evidence. `MUSHI_GIT_TOKEN=...` is redacted from stdout/stderr before audit persistence.

## Spec traceability — `inventoryAction` + `expected_outcome`

The orchestrator now threads the originating inventory `Action` through every fix:

```ts
const context: FixContext = {
  reportId,
  projectId,
  // … report, reproductionSteps, relevantCode, sentryAnalysis, graphContext as before
  inventoryAction: {
    actionNodeId: '00000000-0000-0000-0000-000000000001',
    actionLabel: 'signup-form: submit',
    actionDescription: 'Submit the signup form and create a new user',
    pagePath: '/signup',
    storyId: 'signup',
    storyTitle: 'New user signup',
    expectedOutcome: {
      summary: 'POST /signup returns 200 and creates a user row',
      response: { status_in: [200, 201], json_path: [{ path: '$.user.id', op: 'exists' }] },
      database: { table: 'users', expect: 'row_exists' },
      ui: { route_change_to: '/dashboard', visible_text: 'Welcome' },
    },
  },
  config: { /* … */ },
}
```

Three things happen automatically when `inventoryAction` is set:

1. **`renderSpecContext(context)`** injects a Markdown block into the LLM review prompt that lists the action description, page, story, and every `expected_outcome` assertion verbatim — with an explicit instruction to preserve the contract.
2. **`validateAgainstSpec(context, result)`** runs after the agent's `validateResult` as a deterministic pre-PR gate. It hard-fails the dispatch if the diff *removes* a `json_path` field the contract asserts on; soft warnings (no changed file references the contract's required DB table, no changed file mentions the action's page route) are persisted to `fix_attempts.spec_validation_warnings JSONB` so reviewers can sanity-check before merging.
3. **A targeted post-PR synthetic probe** is queued against `actionNodeId` immediately after the PR opens. The synthetic-monitor cron drains the queue with priority on its next tick — so a fix that immediately makes the action `regressed` shows up in the admin UI within minutes of merge, not on the next 15-min sweep.

`inventoryAction` is `undefined` for legacy reports without an inventory linkage; downstream code falls back to the bug-report-only path it had before.

## JSON Schemas for non-TS orchestrators

The package exports hand-authored draft-07 schemas for every public contract:

```ts
import { AGENT_JSON_SCHEMAS } from '@mushi-mushi/agents'
// {
//   'fix-context.json':       FIX_CONTEXT_JSON_SCHEMA,
//   'fix-result.json':        FIX_RESULT_JSON_SCHEMA,
//   'sandbox-provider.json':  SANDBOX_PROVIDER_JSON_SCHEMA,
//   'expected-outcome.json':  EXPECTED_OUTCOME_JSON_SCHEMA,
// }
```

The api function serves them under `/v1/schemas/*` (see [`packages/server/supabase/functions/api/routes/schemas.ts`](../server/supabase/functions/api/routes/schemas.ts)). A round-trip test in `schemas.test.ts` keeps the JSON Schemas in sync with the TS interfaces.

## Status

- **McpFixAgent** — production adapter; speaks MCP `tools/call` + SEP-1686 Tasks
- **RestFixWorkerAgent** — production adapter for self-hosted REST workers
- **GenericMCPAgent** — legacy adapter; new integrations should pick `McpFixAgent`
- **ClaudeCodeAgent** — working; shells out to the local `claude` CLI behind `MUSHI_ENABLE_CLAUDE_CODE_AGENT=1`. Override the binary path with `MUSHI_CLAUDE_CODE_BIN`. Disabled by default — if the flag is off, `generateFix` returns a deterministic "not configured" result.
- **CodexAgent** — stub (returns `success: false`); pending direct API integration
- **MultiRepoFixOrchestrator** — production; backed by `project_repos` + `fix_coordinations` migrations

## License

[AGPLv3](../server/LICENSE) — copyleft. Part of the open-core server (self-host and fork freely; modified SaaS publishes changes or takes a [commercial license](../../COMMERCIAL-LICENSE.md)).
