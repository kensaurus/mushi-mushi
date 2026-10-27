# Bug report MCP server for Cursor & Claude Code

Source: https://kensaur.us/mushi-mushi/docs/sdks/mcp

---
title: Bug report MCP server for Cursor & Claude Code
description: Reference for @mushi-mushi/mcp, the Mushi MCP server for Cursor, Claude Code, VS Code and Windsurf — stdio and hosted HTTP transports, scopes and setup.
---

# `@mushi-mushi/mcp`

MCP server for Cursor, VS Code, Windsurf, Cline, Claude, Zed, and other MCP
clients — reports, plain-English reads, and fix briefs in the editor.
**[→ Connect](/connect)** for a one-click install. Full walkthrough:
[Quickstart → MCP](/quickstart/mcp).

Speaks **JSON-RPC 2.0** with `tools/call` semantics and supports the
**SEP-1686 Tasks** envelope so long-running fixes can stream progress back
into your IDE.

## Quick start

```bash
npx mushi-mushi setup --ide cursor   # or: claude, continue, zed
```

Restart the editor and ask "what's broken in prod?". For Cursor and Claude
Code, `setup` writes the hosted server entry
(`https://kensaur.us/mushi-mushi/hosted-mcp/`, URL only): the editor opens a
browser sign-in on first use and no API key is stored on disk. Pass
`--stdio` for a local server instead. Continue and Zed always get the stdio
entry.

## Two transports

- **stdio (local)** — `npx -y @mushi-mushi/mcp@0.29.2`. What
  `mushi setup --stdio` writes, and the only option for Claude Desktop,
  Continue, Cline and Zed. Your client launches the server as a subprocess
  and pipes JSON-RPC over stdio.
- **Streamable HTTP (hosted, 2026-05-09 release)** — single endpoint
  at `/functions/v1/mcp`, dual-era (MCP 2024-11-05 … 2025-11-25 with `initialize`, and the current 2026-07-28 revision with `server/discover`). POST returns
  `application/json` or `text/event-stream` per content negotiation,
  GET opens an SSE stream for server-pushed notifications, DELETE
  terminates the session. Use this when you want to skip the local
  subprocess (typical for OpenAI Agents SDK, ChatGPT Agent, hosted
  CrewAI, or any orchestrator that talks remote MCP).

For browser sign-in, use the URL-only entry `mushi setup` writes. To pass a
key yourself instead (for an orchestrator that cannot open a browser), send
it as a header. A static key header turns the client's sign-in off:

```jsonc
// .cursor/mcp.json — Streamable HTTP with an API key
{
  "mcpServers": {
    "mushi-mushi-hosted": {
      "url": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp",
      "headers": {
        "X-Mushi-Api-Key": "mushi_…",
        "X-Mushi-Project-Id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    }
  }
}
```

Auth on both transports is the same dual-mode (API key with
`mcp:read|write` OR JWT) used everywhere on `/v1/admin/*`.

## Spec traceability for `dispatch_fix`

The `dispatch_fix` tool now accepts `inventoryActionNodeId` so callers
that already know the inventory `Action` they want repaired can pin the
fix directly. The complementary `get_fix_context` tool surfaces the
linked Action (with `expected_outcome`) so an external orchestrator can
read the contract before drafting a fix.

```jsonc
// dispatch_fix tool inputSchema (excerpt)
{
  "type": "object",
  "required": ["reportId"],
  "properties": {
    "reportId": { "type": "string" },
    "projectId": { "type": "string" },
    "inventoryActionNodeId": { "type": "string" }
  }
}
```

See [`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp)
on npm for the full **129-tool** catalog and
[Connecting your orchestrator](/concepts/orchestrator-interop) for the
non-MCP surfaces (REST, A2A, AG-UI SSE).

Discoverable via the [A2A Agent Card](/concepts/architecture#a2a-agent-card).
