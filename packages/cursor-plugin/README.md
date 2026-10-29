# Mushi Mushi plugin for Cursor

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

For people who build with Cursor and get bug reports from real users. This
plugin connects Cursor to your Mushi Mushi project, so the agent can read a
report, see why it broke in plain English, and start a fix without you
leaving the editor.

It bundles the Mushi Mushi MCP server, three commands, a triage skill and
safety rules. The tools come from
[`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp).

[![npm](https://img.shields.io/npm/v/@mushi-mushi/mcp)](https://www.npmjs.com/package/@mushi-mushi/mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./.cursor-plugin/plugin.json)

## Install

You need a Mushi Mushi account (the free plan works) and a project with the
SDK sending reports.

**Fastest:** run this in your app folder, then restart Cursor:

```bash
npx mushi-mushi setup --ide cursor
```

It adds the hosted `mushi` server to `.cursor/mcp.json`. No key is written to
the file: Cursor opens a browser sign-in the first time the agent calls Mushi,
and the sign-in page shows what access Cursor asked for and which projects it
can reach.

**One click:** in the Mushi console, open **MCP** (or the **Connect** page) and
click **Add to Cursor**. Cursor's "Install MCP server?" dialog opens; confirm
it. There is a VS Code button on the same page.

**Manual:** merge [`mcp.json`](./mcp.json) into your global
`~/.cursor/mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`), then
restart Cursor. One global entry is enough; there is no need to copy it into
every repo.

- Keep the hosted URL `https://kensaur.us/mushi-mushi/hosted-mcp/`. It signs
  you in with OAuth. A Supabase `/functions/v1/mcp` URL only works with an
  API-key header: its host cannot serve the sign-in metadata, so sign-in there
  fails with HTTP 404.
- Do not add a fixed `Authorization` header to the hosted entry. A static
  header turns off the browser sign-in.
- Use forward slashes in Windows paths inside JSON (`C:/Users/...`).

### Local server instead (`mushi-stdio`)

For a self-hosted Mushi Mushi, or a machine with no browser, use the
`mushi-stdio` entry in `mcp.json`. It runs `npx -y @mushi-mushi/mcp` on your
machine and needs a key:

```bash
export MUSHI_API_KEY=mushi_<key with the mcp:read scope>
export MUSHI_PROJECT_ID=<your project uuid>        # optional for a single-project key
export MUSHI_API_ENDPOINT=<your .../functions/v1/api URL>   # self-hosted only
```

Mint the key on the console's **Projects** page (API keys). Use `mcp:write`
only if the agent should start fixes or change report status.

## What the agent can do

Some of the tools the plugin uses (the server has many more; see the
[tool list](https://kensaur.us/mushi-mushi/docs/sdks/mcp-tools)):

| Tool | What it does |
|------|-------------|
| `list_projects` | The Mushi projects your sign-in or key can reach |
| `get_project_context` | Project health: SDK heartbeat, intake, auto-fix readiness |
| `get_recent_reports` | The open bug queue |
| `get_report_evidence` | Screenshot, console logs, network requests, the user's comment |
| `triage_issue` | One triage packet: evidence, similar bugs, fix context, blast radius, next steps |
| `get_pipeline_logs` | Recent fix-worker, pipeline and QA-runner events, filtered by level |
| `get_fix_context` | Everything a fix needs for one report |
| `dispatch_fix` | Start a fix agent on a triaged report; it opens a draft GitHub PR. Needs write access, a connected GitHub repo and an AI key on the project |

The plugin also adds:

- **`/triage-mushi-report`**: triage one report in a fixed order.
- **`/test-mushi-mcp`**: check the server is reachable and the tools answer.
- **`/fix-with-mushi`**: investigate, confirm with you, then dispatch a fix.
- **`mushi-triage` skill**: the safe order to triage in.
- **`mushi-mcp` rules**: least-privilege and safety rules for the write tools.

## Keys and scopes

| Scope | What it allows |
|-------|----------------|
| `report:write` | Sending reports only (`/v1/reports`). This is the key your app ships in its bundle. Never give it to an editor. |
| `mcp:read` | Every read tool: reports, evidence, context, logs |
| `mcp:write` | Tools that change things, such as `dispatch_fix`, `transition_status`, `merge_fix` and `reply_to_reporter` |

Your app's SDK key (`NEXT_PUBLIC_MUSHI_API_KEY` or similar) is public by
design and carries only `report:write`, which every admin route rejects. Keep
any `mcp:*` key out of client code: put it in your global `~/.cursor/mcp.json`
or your shell profile.

## Mushi Mushi and Sentry

Sentry is built around what the code threw, with a User Feedback widget and
replay alongside. Mushi starts from what the user reported, ingests Sentry's
errors too, explains each one in plain English, and hands your agent a fix
prompt to start from. One queue, with or without Sentry.

## Links

- [Cursor setup guide](https://kensaur.us/mushi-mushi/docs/integrations/cursor)
- [MCP server reference](https://kensaur.us/mushi-mushi/docs/sdks/mcp)
- [MCP quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/mcp)

## Development

```bash
# From the monorepo root
pnpm --filter @mushi-mushi/mcp build
pnpm --filter @mushi-mushi/mcp test
pnpm check:catalog-sync
node scripts/check-cursor-plugin.mjs
```

See [`../mcp/README.md`](../mcp/README.md) for the MCP server itself.
