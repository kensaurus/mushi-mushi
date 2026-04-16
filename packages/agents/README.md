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

## Status

The `GenericMCPAgent` is the primary production adapter. `ClaudeCodeAgent` and `CodexAgent` are experimental stubs pending direct API integration.

## License

[BSL 1.1](../server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
