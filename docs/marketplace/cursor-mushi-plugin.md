# Mushi Mushi — Cursor Marketplace Plugin

## Plugin overview

| Field | Value |
|-------|-------|
| **Name** | Mushi Mushi |
| **Package** | `@mushi-mushi/mcp` (npm) |
| **Plugin bundle** | `packages/cursor-plugin/` |
| **Transport** | Streamable HTTP (hosted) + stdio (local fallback) |
| **Scopes** | `mcp:read` (default) · `mcp:write` (opt-in for fix dispatch) |
| **Category** | Monitoring / Debugging |
| **License** | MIT |

## What it does

Mushi gives Cursor agents access to **user-felt bug reports** — the bugs real users notice. While Sentry monitors thrown exceptions, Mushi collects rage-click events, console errors, and network failures that real users actively report through your app's feedback SDK.

### Tools exposed

| Tool | Scope | Description |
|------|-------|-------------|
| `list_projects` | read | Discover accessible Mushi projects |
| `get_project_context` | read | SDK heartbeat, ingest status, autofix readiness |
| `get_recent_reports` | read | Survey the open triage queue |
| `get_report_evidence` | read | Screenshot, console logs, network excerpts, user comments |
| `triage_issue` | read | Full triage packet (evidence + similar bugs + blast radius + logs + recommended actions) |
| `get_pipeline_logs` | read | Recent fix-worker / pipeline / QA events |
| `get_fix_context` | read | Full context for an existing fix attempt |
| `search_reports` | read | Semantic search over bug reports |
| `dispatch_fix` | **write** | Open a draft GitHub PR for a fix |
| `close_report` | **write** | Mark a report fixed |
| *(+ 60 more)* | read/write | QA story runner, PDCA loop, skill pipelines, inventory, lessons |

### Commands included

- `/triage-mushi-report` — structured triage in one invocation
- `/test-mushi-mcp` — verify the server is reachable
- `/fix-with-mushi` — investigate → confirm → dispatch fix workflow

### Skills included

- `mushi-triage` — teaches agents the safe 8-step triage order

### Rules included

- `mushi-mcp` — least-privilege and write-tool safety guardrails

## Security review notes

### Authentication

- API keys are passed via `X-Mushi-Api-Key` header (never in URLs).
- API keys are project-scoped: a key can only access its bound project's data.
- `mcp:read` keys are read-only; `mcp:write` keys are required for mutating tools.
- The plugin rule file (`rules/mushi-mcp.mdc`) enforces that agents never call write tools without explicit user confirmation.

### Data access

- All triage/evidence tools are read-only (`readOnlyHint: true`).
- Screenshot URLs and console logs may contain PII — the skill instructs agents to summarize rather than reproduce verbatim.
- No cross-project data leakage: API key callers can only see their bound project via `list_projects` and `get_pipeline_logs`.

### No data mutations at install time

Installing the plugin does not write or modify any user data. All mutations require `mcp:write` scope and explicit user confirmation per the included rule file.

### Secret handling

- `MUSHI_API_KEY` is read from the user's shell environment, never from the repository.
- The plugin `mcp.json` uses `${MUSHI_API_KEY}` interpolation — no keys are hardcoded.
- The rule file explicitly prohibits agents from echoing or pasting API key values.

## Install instructions (for submission page)

### Option A — Cursor Marketplace (recommended)

1. Search "Mushi" in Cursor → Settings → Plugins.
2. Click Install.
3. Add to your shell profile: `export MUSHI_API_KEY=mushi_<your-key>`
4. Optionally: `export MUSHI_PROJECT_ID=<your-project-uuid>`
5. Restart Cursor.
6. Test: ask your agent "list my Mushi projects" or use the `/test-mushi-mcp` command.

### Option B — stdio via `mcp.json` (no plugin install)

```json
{
  "mcpServers": {
    "mushi": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp"],
      "env": {
        "MUSHI_API_KEY": "${MUSHI_API_KEY}",
        "MUSHI_PROJECT_ID": "${MUSHI_PROJECT_ID}"
      }
    }
  }
}
```

### Option C — hosted Streamable HTTP

```json
{
  "mcpServers": {
    "mushi": {
      "type": "http",
      "url": "https://<your-project>.supabase.co/functions/v1/mcp",
      "headers": {
        "X-Mushi-Api-Key": "${MUSHI_API_KEY}"
      }
    }
  }
}
```

## Testing evidence

The following checks run on every PR via CI:

| Check | Command |
|-------|---------|
| Type safety | `pnpm --filter @mushi-mushi/mcp typecheck` |
| Unit + integration tests | `pnpm --filter @mushi-mushi/mcp test` |
| Build | `pnpm --filter @mushi-mushi/mcp build` |
| Catalog drift | `pnpm check:catalog-sync` |
| Stdio smoke | `pnpm --filter @mushi-mushi/mcp test:smoke` |
| Plugin manifest | `node scripts/check-cursor-plugin.mjs` |

## Links

- [npm package](https://www.npmjs.com/package/@mushi-mushi/mcp)
- [GitHub repository](https://github.com/kensaurus/mushi-mushi)
- [Documentation](https://kensaur.us/mushi-mushi)
- [Changelog](../../packages/mcp/CHANGELOG.md)
