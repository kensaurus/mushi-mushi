# Quickstart: 0 → first fixed bug

Two paths: **developers** wire the SDK; **PMs/founders** read the console only.

## For developers (15 minutes)

### 1. Create a project + API key (console)

1. Open the Mushi admin console → **Projects** → create a project.
2. **Mint API key** — copy the full `mushi_…` secret immediately (shown once).
3. Open **Connect & Update** (`/connect`) — the unified hub for SDK, MCP, CLI, and upgrade PRs. Confirm the connection chip turns green after your first report.

### 2. Install in your app (wizard)

```bash
cd your-app-repo
npx create mushi-mushi
# or: npx mushi-mushi init
```

The wizard auto-detects your framework, writes env vars, and can send a **test report** to verify ingest.

**Console alternative:** **Connect & Update → Install SDK** shows a live snippet with trigger-mode preview (banner / FAB / attach / headless).

### 3. Verify from the terminal

```bash
mushi doctor
# ingest + dispatch checks run by default
mushi connect --wait   # optional: block until SDK heartbeat lands
```

### 4. Wire Cursor / Claude (MCP)

**Fastest (console):** **Connect & Update → Install MCP** → click **Add to Cursor** (deeplink mints a dedicated `mcp:read` or `mcp:write` key).

**CLI:**

```bash
mushi connect --wait
# writes ~/.mushirc + .env.local + .cursor/mcp.json
```

In your IDE agent, call **`diagnose_setup`** (or MCP `get_activation_status`) if reports don't appear — it returns the exact next fix.

**Hosted MCP (no local subprocess):** point Cursor at `https://<ref>.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs` with `X-Mushi-Api-Key` + `X-Mushi-Project-Id` headers. Full catalog: `?features=all`.

### 5. Keep SDK packages current (optional)

```bash
mushi upgrade              # local npm bump to latest @mushi-mushi/*
```

**With GitHub linked:** **Connect & Update → Create Upgrade PR** opens a reviewed draft PR bumping every `@mushi-mushi/*` dependency in your repo (semver-only; skips `workspace:` / `file:` specifiers).

### 6. First auto-fix (optional)

1. Console → **Settings → Integrations**: connect GitHub, index codebase, add Anthropic BYOK key, enable autofix.
2. Open a classified report → **Dispatch fix** → review the draft PR → merge when CI passes.

**From Cursor:** MCP `dispatch_fix` or slash command `/fix-with-mushi` (see [`packages/cursor-plugin/README.md`](../packages/cursor-plugin/README.md)).

---

## For PMs / non-developers

You don't need the SDK. After a developer wires ingest:

1. **Reports** — triage queue with AI severity + category.
2. **Feature board** — upvote community requests; mark shipped when released.
3. **Releases** — auto-drafted changelog credits reporters.
4. Reporter widget — users see **My reports**, get notified on status changes, and confirm fixes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Test report skipped during wizard | Re-run `npx mushi-mushi init` — cloud endpoint is auto-filled |
| `mushi doctor` fails ingest | Paste SDK snippet, start dev server, submit one report; or use **Connect & Update** test-report CTA |
| Banner never appears | `mushi doctor` or MCP `diagnose_setup` / `get_activation_status` |
| MCP tools missing in Cursor | Use global `~/.cursor/mcp.json` only; restart Cursor; check `pnpm check:catalog-sync` if tool names drift |
| Screenshot reports fail silently | SDK compresses screenshots; check console for payload warnings |
| Upgrade PR fails | Connect GitHub on **Connect & Update** first; repo must contain `@mushi-mushi/*` in `package.json` |

---

## See also

- [`README.md`](../README.md) — full product overview + architecture diagram
- [`packages/cli/README.md`](../packages/cli/README.md) — every CLI command
- [`packages/mcp/README.md`](../packages/mcp/README.md) — MCP tools, scopes, feature groups
- [`AGENTS.md`](../AGENTS.md) — pipeline agents, QA suite, skill pipelines
- [`apps/admin/README.md`](../apps/admin/README.md) — console IA, design system v2
