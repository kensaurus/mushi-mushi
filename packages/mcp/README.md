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

| Tool | What it does |
|---|---|
| `get_recent_reports` | Fetch the N most recent reports, with optional `status` / `category` / `severity` filters |
| `get_report_detail` | Full payload for a single report — description, console logs, network requests, screenshot URL, classification result, fix history |
| `search_reports` | Keyword + semantic search across reports for the configured project |

> Need a tool that isn't here? Open an issue at [github.com/kensaurus/mushi-mushi/issues](https://github.com/kensaurus/mushi-mushi/issues) and tag it `mcp`.

## Resources

| URI | Returns |
|---|---|
| `project://settings` | Project config (name, autofix settings, plugins enabled, ontology) |
| `project://stats` | Counts of new / classified / fixed reports + last 7-day trend |

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
