# Installing the Mushi Mushi MCP server

Instructions for an AI agent (Cline, Claude Code, Cursor, Windsurf or any MCP
client) that is installing the Mushi Mushi MCP server for its user.

Mushi Mushi gives the agent the user's bug reports, each with a plain-English
diagnosis and a ready fix prompt. There are two ways to connect. Ask the user
which one they want if it is not clear.

| Option | Use when | Credential |
| --- | --- | --- |
| A. Hosted server (recommended) | The client supports remote MCP servers over Streamable HTTP | Browser sign-in (OAuth), or an API key header |
| B. Local stdio package | The client only runs local commands, or no browser can open | An API key in `env` |

## Before you start

The user needs a Mushi Mushi project. If they have none, tell them to run
`npx mushi-mushi` in their app's folder (it signs them in through the browser
and creates a free project), or to sign up at
https://kensaur.us/mushi-mushi/admin/signup.

Never invent a key. If you need one, ask the user to mint it: console →
**Manage apps** → **Generate API key** → preset **MCP read-only** (scope
`mcp:read`) or **MCP read + write** (`mcp:write`, needed to reply to reporters
or start fixes). Keys start with `mushi_`. The SDK key that sits in their app
(`report:write`) cannot read reports, so it does not work here.

## A. Hosted server

URL: `https://kensaur.us/mushi-mushi/hosted-mcp/`

Add `?features=vibe` to the URL to load only the 12 tools a builder needs
(triage, diagnosis, fix context, setup, docs). Without it the server lists its
default groups (triage, fixes, inventory, setup, docs); `?features=all` lists
every tool.

With sign-in (no key): add the server with the URL only and no headers. On the
first call the client opens the Mushi Mushi consent page; the user signs in,
picks projects and clicks **Approve**. Do not set an `Authorization` header,
or the client skips the sign-in.

```json
{
  "mcpServers": {
    "mushi": {
      "type": "streamableHttp",
      "url": "https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe"
    }
  }
}
```

Claude Code: `claude mcp add --transport http mushi https://kensaur.us/mushi-mushi/hosted-mcp/`,
then `claude mcp login mushi`.

With a key (headless agents, CI, or a client without OAuth):

```json
{
  "mcpServers": {
    "mushi": {
      "type": "streamableHttp",
      "url": "https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe",
      "headers": {
        "X-Mushi-Api-Key": "mushi_...",
        "X-Mushi-Project-Id": "YOUR_PROJECT_ID"
      }
    }
  }
}
```

The `type` value differs by client: Cline uses `streamableHttp`, Claude Code
and VS Code use `http`, Windsurf uses `serverUrl` in place of `url`.

## B. Local stdio package

For Cline, add this to `cline_mcp_settings.json` (Cline → MCP Servers →
Configure). The same block works in Claude Desktop and Cursor.

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@0.31.4"],
      "env": {
        "MUSHI_API_KEY": "mushi_...",
        "MUSHI_PROJECT_ID": "YOUR_PROJECT_ID",
        "MUSHI_FEATURES": "vibe"
      }
    }
  }
}
```

- `MUSHI_API_KEY` (required): the `mcp:read` or `mcp:write` key.
- `MUSHI_PROJECT_ID` (optional for a single-project account key): the project ID.
- `MUSHI_FEATURES` (optional): `vibe` for the 12 builder tools, `vibe,fixes`
  to also start fixes, `all` for every tool.
- `MUSHI_API_ENDPOINT`: only when the user self-hosts, for example
  `https://<ref>.supabase.co/functions/v1/api`. Leave it out on Mushi Mushi Cloud.

Node.js 20.19 or later is required.

## Verify

1. Restart or reload the MCP servers.
2. Call the `diagnose_setup` tool with no arguments. It reports whether the
   key works, which scopes it has, and whether the project has received a
   report. Fix anything it lists.
3. Call `get_recent_reports`. An empty list is fine for a new project.
4. Tell the user it is connected and suggest: *"Get the latest Mushi Mushi
   report and fix it."*

No reports yet? With an `mcp:write` key, `file_report` files a test report
that Mushi Mushi diagnoses like a real one.

## Links

- Docs: https://kensaur.us/mushi-mushi/docs/quickstart/mcp
- Every tool: https://kensaur.us/mushi-mushi/docs/sdks/mcp-tools
- Package: https://www.npmjs.com/package/@mushi-mushi/mcp
- Source: https://github.com/kensaurus/mushi-mushi/tree/master/packages/mcp
