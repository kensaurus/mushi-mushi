# MCP multi-project setup (operator)

A single global `MUSHI_PROJECT_ID` in `~/.cursor/mcp.json` cannot serve four linked host repos. Use one of these patterns.

## Option A — Per-repo workspace override (recommended)

Each host repo ships `.cursor/mcp.json` with that project's ID and a `{slug}-mcp-dev` key:

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "<yen-yen-mcp-dev-key>",
        "MUSHI_PROJECT_ID": "6e7e0c3a-a777-4f1e-a699-6515993cf3bd",
        "MUSHI_API_ENDPOINT": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api"
      }
    }
  }
}
```

Copy from `.cursor/mcp.json.example` in each repo; fill keys from Console → Projects → API Keys (never commit secrets).

## Option B — Account mode (org-scoped key)

Remove `MUSHI_PROJECT_ID` and pass `project_id` on every MCP tool call (`get_report_detail`, `triage_issue`, `dispatch_fix`, …). Requires `@mushi-mushi/mcp` patch with project propagation (Jun 2026).

## Key scopes

| Operation | Scope |
|-----------|-------|
| Read reports, triage | `mcp:read` |
| dispatch_fix, merge_fix | `mcp:write` |
| SDK ingest | `report:write` only — **never** ship in MCP config |

## Switching projects in Cursor

When working in mushi-mushi on yen-yen pipeline tasks, point MCP env at yen-yen's project ID or open the yen-yen workspace so its `.cursor/mcp.json` wins.
