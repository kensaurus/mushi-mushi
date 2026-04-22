# @mushi-mushi/mcp

[Model Context Protocol](https://spec.modelcontextprotocol.io/) server that exposes Mushi Mushi reports, fixes, and project state to coding agents (Claude Code, Cursor, Codex, Continue, Cline, Zed, Windsurf, and any other MCP-compatible client).

> **What this is, and what it isn't**
>
> - **This package** is the MCP **server** — runs locally next to your editor, talks to the Mushi Mushi API, and presents bug reports as MCP tools/resources to your coding agent.
> - **`@mushi-mushi/agents`** ships the MCP **client adapter** — used by the autofix orchestrator when your project's `autofix_agent = 'mcp'`. See `packages/agents/src/adapters/mcp.ts`.
> - The `generic_mcp` adapter shipped before V5.3 was a misnomer (it spoke plain REST). It is now `RestFixWorkerAgent`; the old export is kept as a deprecated alias for one more minor.

## Quick start

### 1. With Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mushi-mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "key_xxx",
        "MUSHI_PROJECT_ID": "proj_xxx",
        "MUSHI_API_ENDPOINT": "https://api.mushimushi.dev"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a hammer icon in the chat input — click it to see the Mushi Mushi tools.

### 2. With Cursor

In Cursor settings, open **MCP** → **Add new MCP server** and paste:

```bash
npx -y @mushi-mushi/mcp@latest
```

Set the same three env vars (`MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, optional `MUSHI_API_ENDPOINT`).

### 3. From the command line

```bash
MUSHI_API_KEY=key_xxx MUSHI_PROJECT_ID=proj_xxx npx -y @mushi-mushi/mcp@latest
```

The server speaks stdio MCP transport by default — your client launches it as a subprocess.

## Tools

### Read

| Tool | What it does |
|---|---|
| `get_recent_reports` | Fetch the N most recent reports, with optional `status` / `category` / `severity` filters |
| `get_report_detail` | Full payload for a single report — description, console logs, network requests, screenshot URL, classification result, fix history |
| `search_reports` | Semantic + keyword search (server-side pgvector; falls back to keyword match when embeddings aren't available) |
| `get_similar_bugs` | Embedding-nearest neighbours for a component, page, or description |
| `get_fix_context` | One-shot brief for a coding agent: report + repro + root-cause + ontology tags |
| `get_fix_timeline` | Ordered timeline of a fix attempt (dispatched → started → branch → commit → PR → CI → completed/failed) |
| `get_blast_radius` | Graph traversal showing other components a bug group touches |
| `get_knowledge_graph` | Traverse the knowledge graph from a seed component or page |

### Write / agentic

| Tool | What it does |
|---|---|
| `submit_fix_result` | Record a fix outcome (branch, PR, files, lines) from an external agent |
| `dispatch_fix` | Kick off the agentic fix orchestrator for a report — returns a `fix_attempt` id |
| `trigger_judge` | Run the Sonnet-as-Judge over a batch of classified reports |
| `transition_status` | Move a report between workflow states (enforces the same rules as the UI) |
| `run_nl_query` | Natural-language → read-only SQL against your project data (60/hour rate-limited) |

> Need a tool that isn't here? Open an issue at [github.com/kensaurus/mushi-mushi/issues](https://github.com/kensaurus/mushi-mushi/issues) and tag it `mcp`.

## Resources

| URI | Returns |
|---|---|
| `project://stats` | Counts of new / classified / fixed reports + last 7-day trend |
| `project://settings` | Project config — autofix agent, plugins enabled, ontology, LLM budgets |
| `project://dashboard` | PDCA health snapshot — stage counts, bottleneck, recent activity (the same payload the admin console polls every 15 s) |

## Prompts

Named templates the MCP client surfaces in its slash-menu. Each one bakes in the house voice ("lead with the fix, skip the preamble") so agents produce consistent outputs across editors.

| Prompt | When to use |
|---|---|
| `summarize_report_for_fix` | Before asking the agent to write the patch — produces a one-line root cause, smallest file set, repro steps, and blast-radius warnings |
| `explain_judge_result` | After the judge scores a fix — turns the raw scores into ship / iterate / dismiss guidance |
| `triage_next_steps` | "What should I focus on right now?" — five-item markdown list drawn from the dashboard + recent classified queue |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MUSHI_API_KEY` | yes | — | Project API key. Get one from the admin console → Settings → API keys. |
| `MUSHI_PROJECT_ID` | yes | — | Found in the admin console URL or Settings page. |
| `MUSHI_API_ENDPOINT` | no | `https://api.mushimushi.dev` | Override only if you self-host. |

## Security

- The server runs locally; your API key never leaves your machine except in calls to your configured `MUSHI_API_ENDPOINT`.
- Use a **scoped** API key with read-only or read-write scope — never paste a service-role key.
- The server logs to stderr; redirect to a file if you need an audit trail.

## See also

- [V5.3 whitepaper §2.10](../../MushiMushi_Whitepaper_V5.md) — the agentic fix architecture this server feeds into.
- [`@mushi-mushi/agents`](../agents/README.md) — orchestrator that consumes MCP-exposed fix workers.

## License

MIT
