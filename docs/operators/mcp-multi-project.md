# MCP multi-project setup (operator)

One org-scoped MCP key can reach every project you own. **Do not** duplicate bare `mushi` entries across host-repo `.cursor/mcp.json` files — that causes Cursor connection storms and routes tools to stale npm builds.

See also: [`reporter-comms-and-mcp-setup.md`](./reporter-comms-and-mcp-setup.md) for org-scoped key + reporter reply tools.

---

## Recommended — one global entry (account mode)

**Best for:** Kenji-style multi-repo workflows (glot.it + yen-yen + the-wanting-mind + mushi-mushi all open in Cursor).

### 1. Global config only

Put **one** `mushi` server in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "<org-scoped-mcp-write-key>",
        "MUSHI_API_ENDPOINT": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api",
        "MUSHI_FEATURES": "triage,fixes,inventory,setup,docs"
      }
    }
  }
}
```

- **Omit `MUSHI_PROJECT_ID`** — pass `project_id` on each tool call.
- Mint the key in Console → Settings → API Keys (org-scoped, `mcp:read` or `mcp:write`).
- For local MCP development, point `command`/`args` at `packages/mcp/dist/index.js` instead of `npx`.

### 2. Empty workspace files

Each host repo should ship an **empty** `.cursor/mcp.json`:

```json
{
  "_comment": "Mushi MCP is in ~/.cursor/mcp.json. glot.it project_id=542b34e0-019e-41fe-b900-7b637717bb86",
  "mcpServers": {}
}
```

`mushi project create` **skips** writing workspace MCP config when a global `mushi` entry already exists (since Jun 24 2026).

### 3. Pass `project_id` per call

| Project | `project_id` |
|---------|----------------|
| glot.it | `542b34e0-019e-41fe-b900-7b637717bb86` |
| yen-yen | `6e7e0c3a-a777-4f1e-a699-6515993cf3bd` |
| the-wanting-mind | `2ac49170-e89a-4d82-a982-bcbda1d3244d` |
| help-her-take-photo | `e4523271-f609-465f-8b27-00199b39f050` |

Example MCP tool args:

```json
{
  "reportId": "301f46e7-6748-4848-8463-4c1f044714e4",
  "project_id": "542b34e0-019e-41fe-b900-7b637717bb86"
}
```

Tools that accept `project_id`: `get_recent_reports`, `get_report_detail`, `triage_issue`, `dispatch_fix`, `get_report_timeline`, `reply_to_reporter`, `get_two_way_comms_health`, and most triage/fix tools.

### 4. Discover projects

Call `list_projects` or `get_account_overview` when you need IDs:

```
list_projects → returns every project accessible to this key
```

---

## Alternative — per-project server names (`mushi setup --all-projects`)

**Best for:** Teams that want pinned `MUSHI_PROJECT_ID` per server without passing `project_id` on every call.

```bash
mushi setup --ide cursor --all-projects
```

Writes **distinct** server names (`mushi-glot-it`, `mushi-yen-yen`, …) — not the bare key `mushi`. Safe alongside a global entry.

---

## Alternative — per-repo override with distinct names (`mushi connect`)

`mushi connect --wire-ide` writes `mushi-<id-prefix>` (non-legacy name). Does **not** conflict with global `mushi`.

```bash
MUSHI_API_KEY=mushi_xxx mushi connect \
  --project-id 542b34e0-019e-41fe-b900-7b637717bb86 \
  --endpoint https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api
```

---

## Deprecated pattern — do not use

**Do not** put identical `"mushi"` entries in every repo's `.cursor/mcp.json`:

```json
// ❌ Causes duplicate Cursor connections and shadows global config
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": { "MUSHI_PROJECT_ID": "<per-repo uuid>", … }
    }
  }
}
```

When multiple workspaces are open, Cursor may route `user-mushi` to a workspace entry pinned to an old npm version that still calls `/v1/sync/*` → `ORG_KEY_NOT_ALLOWED` for org-scoped keys.

---

## Key scopes

| Operation | Scope | Route family |
|-----------|-------|----------------|
| Read reports, timeline, two-way health | `mcp:read` | `/v1/admin/*` |
| `reply_to_reporter`, `dispatch_fix`, `transition_status` | `mcp:write` | `/v1/admin/*` |
| SDK ingest (widget reports) | `report:write` only | `/v1/reports`, `/v1/sync/*` — **never** in MCP config |

Org-scoped keys work on **admin** routes. They are **rejected** on sync ingest routes (`ORG_KEY_NOT_ALLOWED`).

---

## Switching projects in Cursor

| Situation | What to do |
|-----------|------------|
| Global org key, working on glot.it | Pass `project_id=542b34e0-…` on tool calls |
| Single-project pin in global config | Set `MUSHI_PROJECT_ID` in `~/.cursor/mcp.json` |
| Open only one host workspace | That workspace's `mushi-<slug>` entry wins if you used `mushi connect` |
| MCP tools return wrong project's data | Check which `mushi` server Cursor activated; remove duplicates |

After any MCP config change: **fully restart Cursor** (not just toggle).
