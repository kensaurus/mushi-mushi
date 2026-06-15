# Quickstart: 0 → first fixed bug

Two paths: **developers** wire the SDK; **PMs/founders** read the console only.

## For developers (15 minutes)

### 1. Create a project + API key (console)

1. Open the Mushi admin console → **Projects** → create a project.
2. **Mint API key** — copy the full `mushi_…` secret immediately (shown once).
3. Go to **Onboarding → SDK** tab — confirm the connection chip turns green after your first report.

### 2. Install in your app (wizard)

```bash
cd your-app-repo
npx create mushi-mushi
# or: npx mushi-mushi init
```

The wizard auto-detects your framework, writes env vars, and can send a **test report** to verify ingest.

### 3. Verify from the terminal

```bash
mushi doctor
# ingest + dispatch checks run by default
mushi connect --wait   # optional: block until SDK heartbeat lands
```

### 4. Wire Cursor / Claude (MCP)

```bash
mushi connect --write-env --wire-ide
```

In your IDE agent, call **`diagnose_connection`** if reports don't appear — it returns the exact next fix.

### 5. First auto-fix (optional)

1. Console → **Settings → Integrations**: connect GitHub, index codebase, add Anthropic BYOK key, enable autofix.
2. Open a classified report → **Dispatch fix** → review the draft PR → merge when CI passes.

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
| `mushi doctor` fails ingest | Paste SDK snippet, start dev server, submit one report |
| Banner never appears | `mushi doctor` or MCP `diagnose_connection` |
| Screenshot reports fail silently | SDK now compresses screenshots; check console for payload warnings |
