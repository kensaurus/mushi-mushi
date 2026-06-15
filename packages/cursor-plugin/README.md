# Mushi Mushi — Cursor Plugin

> Bug triage, evidence, and fix dispatch — powered by real user reports, right inside Cursor.

[![npm](https://img.shields.io/npm/v/@mushi-mushi/mcp)](https://www.npmjs.com/package/@mushi-mushi/mcp)
[![license](https://img.shields.io/github/license/mushi-mushi/mushi-mushi)](../../LICENSE)

## What this plugin does

The Mushi Cursor Plugin connects your IDE to your Mushi project, giving Cursor agents access to:

| Tool | What it does |
|------|-------------|
| `list_projects` | Discover the Mushi projects accessible to your API key |
| `get_project_context` | Project health: SDK heartbeat, ingest status, autofix readiness |
| `get_recent_reports` | Survey the open bug triage queue |
| `get_report_evidence` | Screenshot, console logs, network requests, user comments |
| `triage_issue` | Full triage packet: evidence + similar bugs + fix context + blast radius + recommended actions |
| `get_pipeline_logs` | Recent fix-worker / pipeline / QA-runner events filtered by level |
| `dispatch_fix` | Open a draft GitHub PR for an automated fix (mcp:write scope required) |
| `get_fix_context` | Full fix context bundle for an existing attempt |

The plugin also includes:
- **`/triage-mushi-report`** command — structured triage in one invocation
- **`/test-mushi-mcp`** command — verify the server is reachable and all tools are live
- **`/fix-with-mushi`** command — full investigate → confirm → dispatch workflow
- **`mushi-triage` skill** — teaches agents the safe triage order
- **`mushi-mcp` rules** — least-privilege and safety guardrails for write tools

## Installation (Cursor Marketplace)

Once published to the Cursor Marketplace, install via:

```
Cursor → Settings → Plugins → Search "Mushi" → Install
```

Set your API key in Cursor → Settings → Environment Variables:

```
MUSHI_API_KEY=mushi_<your-mcp-read-key>
```

Optionally set a default project:

```
MUSHI_PROJECT_ID=<your-project-uuid>
```

## Manual installation

1. Clone or download this directory.
2. Copy `mcp.json` into your project's `.cursor/` folder (or merge into `.cursor/mcp.json`).
3. Update the `url` in the `mushi` server entry with your Supabase edge function URL.
4. Set `MUSHI_API_KEY` in your shell profile.
5. Restart Cursor.

### stdio fallback (no hosted endpoint)

If you don't have a hosted Supabase endpoint, use the `mushi-stdio` server in `mcp.json`. This runs `npx @mushi-mushi/mcp` locally:

```bash
export MUSHI_API_KEY=mushi_<your-mcp-read-key>
export MUSHI_PROJECT_ID=<your-project-uuid>
# Cursor will pick up these env vars from your shell
```

## Security model

| Scope | What it unlocks |
|-------|----------------|
| `mcp:read` | All triage, evidence, context, and log tools (read-only) |
| `mcp:write` | `dispatch_fix`, `close_report`, `set_report_status`, `reply_to_reporter`, and other mutating tools |

**Recommended**: mint a `mcp:read` key for daily triage; escalate to `mcp:write` only when you need to dispatch fixes.

Mint API keys at: **Mushi admin → Settings → Projects → API Keys**.

## Mushi vs Sentry MCP

| | Sentry MCP | Mushi MCP |
|--|-----------|-----------|
| Signal source | Thrown exceptions | User-felt bugs (rage-click, console errors, network failures flagged by real users) |
| Evidence | Stack traces, breadcrumbs | Screenshots, console logs, network excerpts, user comments, replay pointers |
| Fix dispatch | — | `dispatch_fix` → draft PR → human review |
| QA coverage | — | QA story runner, PDCA improvement loop |
| Triage tool | `sentry_get_issue` | `triage_issue` (evidence + similar bugs + blast radius + logs + recommended actions) |

Both are complementary. Use Sentry for exception noise; use Mushi for "the user says it's broken" signal.

## Development

```bash
# From monorepo root
pnpm --filter @mushi-mushi/mcp build
pnpm --filter @mushi-mushi/mcp test
pnpm check:catalog-sync
```

See `../../packages/mcp/README.md` for full MCP server documentation.
