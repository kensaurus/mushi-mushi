# Operator-surface connectivity verification + H4 fix — Jun 23 2026

**Scope:** Glot-It → Mushi pipeline, verified across **all four operator-facing
surfaces** (Console, Slack, MCP, CLI), not just "a report reached the console".
**Trigger:** Challenge to the initial "pipeline is connected" assertion — was it
actually exercised end-to-end on every triage surface?

This is the honest answer: the report→classify→console path was solid, but the
**reporter-communication MCP tools failed for org-scoped keys** (H4). That defect
is now fixed, deployed, and verified live on the backend.

---

## Per-surface verification

| Surface | What was tested | Result |
|---------|-----------------|--------|
| **Console** (`localhost:6464`) | Report appears, classify-report triage (severity/category), status transitions, timeline | ✅ Connected |
| **Slack** | `report.created` + `report.triaged` Block Kit posts; interactive triage actions write back `slack_message_ts` | ✅ Connected (server-side `slack_message_ts` proof) |
| **Mushi MCP** | `get_recent_reports`, `get_report_detail`, `triage_issue`, `transition_status` (project-scoped) | ✅ Connected |
| **Mushi MCP** | `get_report_timeline`, `reply_to_reporter`, `get_two_way_comms_health` (**org-scoped key**) | ❌→✅ **H4 — fixed** |
| **Mushi CLI** | `reports list`, `reports triage` | ✅ Connected |

---

## H4 — org-scoped MCP keys rejected on reporter-comms tools

### Severity: High (operator workflow broken for the default MCP key type)

### Symptom

Calling `get_report_timeline`, `reply_to_reporter`, or `get_two_way_comms_health`
through the MCP with an **org-scoped** key returned:

```
[ORG_KEY_NOT_ALLOWED] Org-scoped keys cannot be used for SDK ingest. Use a project-scoped key.
```

Org-scoped keys are the *intended* key type for MCP/admin use across multiple
projects — so every multi-project operator hit this on the three reporter-comms
tools.

### Root cause

Those three MCP tools called `/v1/sync/*` endpoints, which are guarded by
`apiKeyAuth` (SDK ingest middleware). `apiKeyAuth` explicitly rejects org-scoped
keys:

```typescript
// packages/server/supabase/functions/_shared/auth.ts
if (keyRow.is_org_scoped) {
  return c.json(
    { error: { code: 'ORG_KEY_NOT_ALLOWED', message: 'Org-scoped keys cannot be used for SDK ingest. Use a project-scoped key.' } },
    403,
  )
}
```

Reporter replies / timeline / health are **admin operations**, not SDK ingest —
they belong behind `adminOrApiKey()` (which accepts org-scoped keys), like the
already-correct `GET /v1/admin/reports/:id/timeline`.

### Fix (4 layers, no behavior drift)

1. **Shared logic** — new `_shared/reporter-comms.ts` (`postReporterReply`,
   `computeTwoWayHealth`) so the SDK/CLI sync routes and the admin/MCP routes use
   one implementation and can't drift.
2. **Sync routes** — `api/routes/sync.ts` `POST /v1/sync/reports/:id/reply` and
   `GET /v1/sync/two-way-health` now call the shared helpers (unchanged behavior,
   still `apiKeyAuth` for the SDK/CLI path).
3. **Admin twins** — `api/routes/reports.ts` adds
   `POST /v1/admin/reports/:id/reply` (`adminOrApiKey({ scope: 'mcp:write' })`)
   and `GET /v1/admin/two-way-health` (`adminOrApiKey()`, single-project scope
   enforced via `?project_id=`).
4. **MCP repoint** — both transports point the three tools at the admin routes:
   - `packages/mcp/src/server.ts` (local stdio) — adds `project_id` to the
     `inputSchema` for reply/health and passes `X-Mushi-Project-Id` via
     `projectScopeHeaders`.
   - `packages/server/supabase/functions/mcp/hosted-tool-manifest.json` (hosted
     HTTP MCP) — `path` updated to `/v1/admin/...`.

### Live verification (org-scoped key, deployed `api` function)

| Endpoint | Method | Result | Evidence |
|----------|--------|--------|----------|
| `/v1/admin/reports/:id/timeline` | GET | **200** | timeline returned |
| `/v1/admin/two-way-health?project_id=…` | GET | **200** | health snapshot returned |
| `/v1/admin/reports/:id/reply` | POST | **201** | comment created (test row cleaned up) |
| `/v1/admin/two-way-health` (no `project_id`) | GET | **400** | scope guard works |

Backend fix is **fully live**. The **hosted HTTP MCP** is deployed with the
updated manifest, so HTTP-transport clients get the fix immediately.

### Remaining action (environmental, not code)

The **local stdio MCP** (`user-mushi`) must be **reloaded** to pick up the rebuilt
`packages/mcp/dist/index.js` — the running process still executes the old dist
(observed: an org-key call with `project_id` still returned `ORG_KEY_NOT_ALLOWED`,
because the in-memory process calls the old `/v1/sync/...` path). Toggle the MCP
server off/on in Cursor (or restart Cursor) to load the new build. No further
code changes required.

---

## H5 — duplicate `mushi` MCP server entries across all open workspaces

### Severity: Medium (cascading `ORG_KEY_NOT_ALLOWED`; hides the H4 fix)

### Symptom

After fixing H4 and toggling the MCP off/on, `get_report_timeline` still
returned `[ORG_KEY_NOT_ALLOWED]`. Backend curl confirmed 200; local dist
confirmed correct paths. Root cause: Cursor loaded a **workspace-level**
`mushi` entry from one of the other open workspaces (yen-yen / glot.it /
the-wanting-mind / help-her-take-photo) that was pinned to `@0.17.0` (the
old sync paths), shadowing the global entry with the fixed local dist.

### Root cause

`mushi project create` (via `project-bootstrap.ts`) writes
`mcpServers.mushi` (bare key, `legacy: true`) into `.cursor/mcp.json` in
every repo where it is run — **without checking whether a global
`~/.cursor/mcp.json` already has a `mushi` entry**. When the user has all
5 repos open as Cursor workspaces simultaneously, Cursor sees 5 competing
`mushi` servers and routes `user-mushi` to a workspace-level `@0.17.0`
entry rather than the global dev dist.

All 4 host-app workspace files were pinned to `@0.17.0`:

```
yen-yen/.cursor/mcp.json           npx -y @mushi-mushi/mcp@0.17.0
glot.it/.cursor/mcp.json           npx -y @mushi-mushi/mcp@0.17.0
the-wanting-mind/.cursor/mcp.json  npx -y @mushi-mushi/mcp@0.17.0
help-her-take-photo/.cursor/mcp.json  npx -y @mushi-mushi/mcp@0.17.0
```

### Fix

Two-part:

1. **Immediate (workspace files)** — all 4 host-app workspace `.cursor/mcp.json`
   cleared to `{ "mcpServers": {} }` with a comment explaining the global
   entry covers all projects. Each file retains a `project_id` hint so the
   user knows what to pass on tool calls.

2. **Upstream guard** — `packages/cli/src/project-bootstrap.ts` now reads
   `~/.cursor/mcp.json` before writing. If a global `mushi` entry exists,
   the workspace write is **skipped** and the caller receives
   `mcpSkippedGlobalConflict: true`. `commands/project.ts` surfaces this as
   a printed message: `"Skipped .cursor/mcp.json — global entry already
   exists. Pass project_id=<uuid> on tool calls."` This prevents the
   duplicate from ever being written again by `mushi project create` for
   users who already configured an org-scoped global key.

### Files touched (H5)

| File | Change |
|------|--------|
| `yen-yen/.cursor/mcp.json` | Cleared to empty `mcpServers` + comment |
| `glot.it/.cursor/mcp.json` | Cleared to empty `mcpServers` + comment |
| `the-wanting-mind/.cursor/mcp.json` | Cleared to empty `mcpServers` + comment |
| `help-her-take-photo/.cursor/mcp.json` | Cleared to empty `mcpServers` + comment |
| `packages/cli/src/project-bootstrap.ts` | `globalCursorMcpHasMushi()` guard; new `mcpSkippedGlobalConflict` return field |
| `packages/cli/src/commands/project.ts` | Print skip message with `project_id` hint |

### Post-fix verification

Requires a Cursor restart (not just toggle) to unload the stale `@0.17.0`
workspace process and load only the global entry.

---

## Minor follow-up (non-blocking)

`computeTwoWayHealth().unread_admin_replies` actually counts **all** unread
`reporter_notifications` (no per-comment read flag exists), not strictly admin
replies. Behavior is carried verbatim from the original sync route; the field
name overstates its meaning. Consider renaming to `unread_reporter_notifications`
in a future pass. Not a connectivity defect.

---

## Files touched (H4)

| File | Change |
|------|--------|
| `packages/server/supabase/functions/_shared/reporter-comms.ts` | **New** — shared reply + two-way-health logic |
| `packages/server/supabase/functions/api/routes/sync.ts` | Use shared helpers (no behavior change) |
| `packages/server/supabase/functions/api/routes/reports.ts` | **New** admin twins: reply + two-way-health |
| `packages/mcp/src/server.ts` | Repoint 3 tools → admin routes; add `project_id` to schemas |
| `packages/server/supabase/functions/mcp/hosted-tool-manifest.json` | Repoint 3 tool paths → `/v1/admin/...` |
