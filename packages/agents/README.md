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
| `FixOrchestrator` | Main pipeline controller — assembles context, dispatches to agent, handles PR creation |
| `GenericMCPAgent` | Adapter for MCP-compatible coding agents |
| `ClaudeCodeAgent` | Claude Code adapter (experimental) |
| `CodexAgent` | OpenAI Codex adapter (experimental) |
| `checkFileScope` | Validates that fixes only touch allowed files |
| `checkCircuitBreaker` | Prevents runaway fix attempts |
| `createPR` / `buildPRBody` | GitHub PR creation via Octokit |

## Usage

```ts
import { FixOrchestrator } from '@mushi-mushi/agents'

const orchestrator = new FixOrchestrator(supabaseClient, {
  githubToken: process.env.GITHUB_TOKEN,
  owner: 'your-org',
  repo: 'your-app',
})

await orchestrator.run(reportId)
```

## Agent Configuration

The orchestrator reads `autofix_agent` and `autofix_mcp_server_url` from the project's `project_settings` row in Supabase. For `generic_mcp`, the MCP server URL is required:

| Setting | Values | Default |
|---------|--------|---------|
| `autofix_agent` | `claude_code`, `codex`, `generic_mcp` | `claude_code` |
| `autofix_mcp_server_url` | URL of the MCP-compatible agent server | — |

## Security: Sandbox

`sandbox.ts` generates a JSON spec document describing intended container constraints (gVisor/Docker, no network, 10min timeout, 4GB RAM cap, scoped credentials). **This spec is not enforced at runtime.** The fix agent runs with whatever permissions the host process has.

If deploying fix agents in production, you must implement your own container isolation. The generated spec can be used as a reference for configuring Docker/gVisor/Firecracker constraints.

## Status

- **GenericMCPAgent** — production adapter; requires an external MCP-compatible agent server
- **ClaudeCodeAgent** — stub (returns `success: false`); pending Channels API access
- **CodexAgent** — stub (returns `success: false`); pending direct API integration

## License

[BSL 1.1](../server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
