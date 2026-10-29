# Connect

Source: https://kensaur.us/mushi-mushi/docs/admin/connect

---
title: Connect
description: The Connect page wires GitHub, the SDK, MCP, the CLI and your editor to a Mushi Mushi project, and shows when your installed SDK is out of date.
---

# Connect

**Route:** `/connect` (sidebar: **Connect**)

> **Scenario:** Your repo is on GitHub, the SDK is installed, but your editor still
> can't ask Mushi Mushi what broke, and you're a couple of versions behind on
> `@mushi-mushi/web`. This page wires GitHub, the SDK, MCP, the CLI and upgrade PRs
> in one place.

A row of status pills at the top (**App checked in**, **SDK version**, **Editor**)
says what is already connected. Below them, the page opens with a client picker:
pick your AI client, then a lane (MCP / CLI / Skills). Connecting GitHub enables the
**Create Upgrade PR** flow; the SDK and MCP sections work without it.

---

## Client picker (3 lanes)

| Lane | What it does |
|------|--------------|
| **MCP** | One-click install for Cursor, VS Code, Claude Code, Windsurf and other clients (`ClientConnectButton` mints a scoped key, then opens a deeplink or gives you config JSON) |
| **CLI** | Three commands to copy: `npm install -g @mushi-mushi/cli@latest`, `mushi login`, then `mushi setup --ide ` |
| **Skills** | Copy skill setup for the selected client |

If your only key is an SDK key, a note under the picker offers **Add an MCP key**
(`mcp:read`), which your editor needs to read this app's reports.

---

## Sections

| # | Section | What it does |
|---|---------|--------------|
| 1 | Client picker | MCP / CLI / Skills lanes (above) |
| 2 | **GitHub** | Link the repo so upgrade PRs, autofix and CI secret sync can use its token. **Manage** opens Integrations. |
| 3 | **SDK health** | Problems that stop bug reports from arriving, each with a fix (see [SDK health](/admin/sdk-health)) |
| 4 | **Bug capture SDK** | Framework tabs and a copy-ready install snippet; **Make a key and fill it in** fills in the key |
| 5 | **Native app CI secrets** | Diagnose, and one-click sync of `NEXT_PUBLIC_MUSHI_*` into GitHub Actions |
| 6 | **Update center** | Per-package freshness and **Create Upgrade PR** |

---

## Native app CI secrets

Capacitor, Expo, and React Native apps bake `NEXT_PUBLIC_MUSHI_*` at **compile
time**. A missing secret silently disables `initMushi()` and the lime banner
never appears in the store build.

The **Native app CI secrets** card calls `GET /v1/admin/projects/:id/sdk-diagnostics`
and shows a fused verdict:

| Status | Meaning |
|--------|---------|
| `ci-secret-missing` | Required var absent from GitHub Actions secrets/variables |
| `native-never-seen` | Web heartbeats exist but no `capacitor://` / native UA |
| `banner-disabled` | The SDK banner is turned off in the SDK config |
| `healthy` | All CI secrets present and the SDK has reported from the expected origins |
| `unknown` | Not enough to tell yet |

**One-click sync:** `POST /v1/admin/projects/:id/sync-ci-secrets` mints a
scoped ingest key and writes each required var via sealed-box encryption.

The Mushi GitHub App requests `Contents` + `Pull requests` only — not Actions
secrets. Auto-write works when a fine-grained PAT with **Actions secrets: Read
and write** is stored in project settings. Otherwise the card expands guided
`gh secret set` commands and a CI `env:` YAML block.

See also: [Self-hosting](/self-hosting) · [`AGENTS.md` native CI section](https://github.com/kensaurus/mushi-mushi/blob/master/AGENTS.md#native-ci-secrets-diagnostic--auto-write-jun-2026)

---

## SDK upgrade PR

When a package is outdated or deprecated:

1. Click **Create Upgrade PR** on the Update center row.
2. Backend enqueues `sdk_upgrade_jobs` → `sdk-upgrade-worker` bumps
   `@mushi-mushi/*` in `package.json` files only (never `workspace:` / `file:`).
3. Draft PR opens on GitHub, auto-readied, status streams via SSE.

The bump edits `package.json` only. Add the
[lockfile helper workflow](/admin/sdk-upgrade-lockfile) to your repo and the PR
opens after your own package manager has refreshed the lockfile, so
`npm ci` / `pnpm install --frozen-lockfile` pass.

CLI equivalent: see [SDK reference → CLI](/sdks/cli) (`mushi upgrade` for local bumps).

---

## Quick path (5 minutes)

### Connect GitHub
Install the Mushi GitHub App on your primary repo (or paste a fine-grained PAT
with Contents + PR + Actions secrets if you need CI auto-write).

### Install SDK
Copy the framework snippet → paste into your app → deploy or run locally.

### Wire MCP
In the client picker's **MCP** lane, click **Add to Cursor** (or your client's
button), restart the IDE, then run `mushi doctor`.

### Wire CLI (SDK + env + MCP)
`mushi connect` saves credentials, writes the SDK env vars to `.env.local` and wires
Cursor MCP. The Set up page's CLI strip and the project success panel give you this
command with your project ID filled in:

```bash
MUSHI_API_KEY=mushi_xxx mushi connect \
  --project-id <uuid> \
  --endpoint https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api \
  --write-env --wire-ide --wait
```

Run `mushi login` first if you need to paste an API key interactively. SDK-only: `mushi init --project-id `.

### Verify
Click **Send test report** on the app's row in [Manage apps](/admin/projects), or
submit a report from your app.

---

## Related pages

- [Set up](/admin/onboarding): guided wizard (same outcome, more hand-holding)
- [CLI ↔ console loop](/quickstart/cli-console-loop): end-to-end setup narrative
- [Manage apps](/admin/projects): API keys and assistant config
- [Editor agents (MCP)](/admin/mcp): full tool catalogue
- [SDK health](/admin/sdk-health): version and heartbeat diagnostics
