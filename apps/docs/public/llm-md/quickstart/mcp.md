# MCP server for bug fixing in Cursor & Claude Code

Source: https://kensaur.us/mushi-mushi/docs/quickstart/mcp

---
title: MCP server for bug fixing in Cursor & Claude Code
description: Set up the Mushi Mushi MCP server with npx mushi-mushi setup. Read bug reports, get fix context, and dispatch fixes from Cursor, Claude Code or any MCP client.
---

# MCP server

- MCP is how your AI editor (Cursor, Claude Code, VS Code) talks to Mushi.
- Add the server in one click, sign in once in your browser. No key to paste.
- Then ask your editor about bugs: it gets the report, the diagnosis and a fix brief.

## Connect in three steps

### Add the Mushi server

One click: pick your editor on the [Connect page](https://kensaur.us/mushi-mushi/docs/connect).
No signup needed for the read-only demo. Or run one command:

```bash
# Claude Code
claude mcp add --transport http mushi "https://kensaur.us/mushi-mushi/hosted-mcp/"

# Cursor (writes .cursor/mcp.json)
npx mushi-mushi setup --ide cursor
```

### Sign in

The first time your editor calls Mushi, your browser opens. Sign in, pick which
projects it may see, and click **Approve**. In Claude Code, run `claude mcp login mushi`
(or `/mcp`) to start it.

**You'll see:** Mushi listed as connected in your editor's MCP settings.

### Ask your editor

Try *"list mushi tools"*, then *"Get the latest Mushi report and fix it."*

**You'll see:** the Mushi tools in the list, then a fix brief: the cause, the files to change and how to check it.

The rest of this page is detail: how sign-in works, manual config files,
the hosted transport for headless agents, and the tool list.

## How sign-in works (OAuth, no keys to copy)

The hosted MCP endpoint speaks the standard MCP OAuth flow (authorization
code + PKCE), so clients that support MCP login connect with **zero manual
credentials**:

```bash
# Claude Code
claude mcp add --transport http mushi "https://kensaur.us/mushi-mushi/hosted-mcp/"
claude mcp login mushi   # or run /mcp inside a session and pick "mushi"
```

Your browser opens the console consent page. Sign in, choose what the
connection reaches, and click **Approve**:

| Choice | What the client gets | Revoke it from |
| --- | --- | --- |
| **All my projects** (default with several projects) | An account key that reaches every project you can reach, now and later | **Editor agents → Account keys** |
| **Only the projects I pick** | An account key limited to the ticked projects | **Editor agents → Account keys** |
| **One project** | A project key (label `mcp-oauth`); needs owner or admin | **Manage apps** (the app's key list) |

- An account key does in each project only what your role there allows. The
  agent calls `list_projects` and passes `projectId` to project tools.
- To keep one connection on a single project, add `?project=<project-id>` to the
  server URL, for example `https://kensaur.us/mushi-mushi/hosted-mcp/?project=<project-id>`.
- A pinned connection, or one limited to picked projects, leaves out the
  organization-wide tools (portfolio, connectors, spend, accounts register).
- Cursor and VS Code follow the same flow when you add the hosted URL as a
  remote MCP server. Do **not** set an `Authorization` header if you want the
  login flow: a static header tells the client that OAuth isn't needed.

Use the `kensaur.us/mushi-mushi/hosted-mcp/` URL for the login flow. Clients
look for the OAuth metadata at the root of the server's host
(`/.well-known/oauth-protected-resource/…`), and only that host serves it; on
the `supabase.co` URL the lookup fails with an HTTP 404. With an API key
header (below), either URL works.

Self-hosted on your own `.supabase.co`? Point Claude Code at the
function's own metadata document with its `authServerMetadataUrl` override
(`npx mushi-mushi setup --ide claude` writes this for you):

```json
{
  "mcpServers": {
    "mushi": {
      "type": "http",
      "url": "https://<ref>.supabase.co/functions/v1/mcp",
      "oauth": {
        "authServerMetadataUrl": "https://<ref>.supabase.co/functions/v1/mcp/.well-known/oauth-authorization-server"
      }
    }
  }
}
```

## One-liner setup (recommended)

```bash
npx mushi-mushi setup --ide cursor
# or: npx mushi-mushi setup --ide claude
```

For Cursor and Claude Code this writes the **hosted MCP URL with OAuth login**
by default. No API key lands in your repo, the entry is safe to commit and
share with your team, and each teammate signs in from the IDE on first use.
Pass `--stdio` (or `--ci` in headless environments) for the previous local
subprocess entry with a key.

It reads CLI config at **`~/.config/mushi/config.json`**, or **`%APPDATA%\mushi\config.json`** on Windows ([full order](/sdks/cli#config-file); written by `mushi login`; legacy `~/.mushirc` auto-migrates on first load), detects the IDE config path, and writes the `mcpServers` block for you. Restart the IDE and ask the agent: **"list mushi tools"**.

## Claude Code plugin

One command installs the hosted MCP hookup plus a `mushi-debugger` subagent
(report triage → fix context → implement → close the loop):

```
/plugin marketplace add kensaurus/mushi-mushi
/plugin install mushi-debugger@mushi-mushi
```

Then: `/mcp` → pick `mushi` → sign in via the browser. Ask Claude to
"use mushi-debugger to fix the top report".

## Smithery (hosted MCP)

Install from the [Smithery registry](https://smithery.ai/servers/kensaurus/mushi-mushi) with
Streamable HTTP at `https://kensaur.us/mushi-mushi/hosted-mcp/`. The server card at
`https://kensaur.us/mushi-mushi/hosted-mcp/.well-known/mcp/server-card.json`
lists every tool for directory scanners.

  Run `npx mushi-mushi project create` on a brand-new machine to sign up,
  mint a project, and write `.env.local` + `.cursor/mcp.json` in one flow.

## Manual setup: Cursor

Add to `.cursor/mcp.json` in your repo root:

```json filename=".cursor/mcp.json"
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@0.30.0"],
      "env": {
        "MUSHI_API_ENDPOINT": "https://<your-ref>.supabase.co/functions/v1/api",
        "MUSHI_PROJECT_ID": "YOUR_PROJECT_ID",
        "MUSHI_API_KEY": "mushi_..."
      }
    }
  }
}
```

  
    Mint a key on **Manage apps → Generate API key** (preset **MCP read-only** or
    **MCP read + write**), or use **Connect → Add to Cursor**. The card that shows
    a new key once also offers a ready-made `.cursor/mcp.json` snippet.
  

## Manual setup: Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@0.30.0"],
      "env": {
        "MUSHI_API_ENDPOINT": "https://<your-ref>.supabase.co/functions/v1/api",
        "MUSHI_PROJECT_ID": "YOUR_PROJECT_ID",
        "MUSHI_API_KEY": "mushi_..."
      }
    }
  }
}
```

## Hosted Streamable HTTP transport (no subprocess)

Skip the local subprocess: use the hosted MCP endpoint when you're
running OpenAI Agents SDK, ChatGPT Agent, CrewAI, or any remote orchestrator.
Headless orchestrators can't drive the browser OAuth flow, so this is the
one place a static API key header is the right tool:

```json filename=".cursor/mcp.json"
{
  "mcpServers": {
    "mushi-hosted": {
      "url": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp",
      "headers": {
        "X-Mushi-Api-Key": "mushi_…",
        "X-Mushi-Project-Id": "YOUR_PROJECT_ID"
      }
    }
  }
}
```

## Available tools

| Tool                    | Purpose                                      |
|-------------------------|----------------------------------------------|
| `get_recent_reports`    | Filter by status, severity, component        |
| `get_report_detail`     | Full detail incl. screenshot + classification |
| `get_fix_context`       | One-shot fix brief: root cause, blast radius, repro and a paste-ready `fixPrompt` |
| `search_reports`        | Semantic + keyword search across reports     |
| `dispatch_fix`          | Start the Mushi fix agent for a report (needs GitHub connected and Automatic fixes on) |
| `triage_next_steps`     | "What should I fix next?": a prioritised list of next actions |
| `get_similar_bugs`      | Ask "have we seen this before?" (similar reports) |
| `run_nl_query`          | Natural-language → SQL questions about your data |

  The MCP server speaks JSON-RPC 2.0 with `tools/call` semantics, and the
  agent surface is also discoverable via the
  [A2A Agent Card](/concepts/architecture#a2a-agent-card) at
  `/.well-known/agent-card.json` on the API.

## Cursor rules hook (optional)

After setup, run:

```bash
npx mushi-mushi setup --ide cursor --with-rules
```

This writes a `.cursorrules` file that tells Cursor to call `get_fix_context`
before writing a fix and `submit_fix_result` after, closing the loop from
inside the editor. Download the template:
[cursor.cursorrules](/integrations/cursor.cursorrules)

## Smithery registry

Hosted Streamable HTTP endpoint: `https://kensaur.us/mushi-mushi/hosted-mcp/`

Install from the [Smithery server page](https://smithery.ai/servers/kensaurus/mushi-mushi).
Tool metadata is also published at `https://kensaur.us/mushi-mushi/hosted-mcp/.well-known/mcp/server-card.json` for directory scanners.

## Troubleshooting
