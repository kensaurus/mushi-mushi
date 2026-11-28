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
> the Mushi Mushi SDK. This page wires GitHub, the SDK, MCP, the CLI and upgrade PRs
> in one place.

## Steps

The page is three steps, in the order a new app needs them, and only the step
to do now is open ([ADR 0069](https://github.com/kensaurus/mushi-mushi/blob/master/docs/adr/0069-builder-console-is-the-fix-loop.md)).
A done step is one line with a ✓ and **Change**; a later step is one line you
can still open. Links into the page open their step: `#connect-sdk`,
`#connect-studio` and `#connect-github`.

| # | Step | What it does |
|---|------|--------------|
| 1 | **Report button** | The install snippet: the **Script tag** leads, the framework the app's repo uses sits beside it, and every other framework is in **Other frameworks**. **Make a key and fill it in** fills in the key; **Where does your app run?** says where it goes on Lovable, Bolt, Vercel, Netlify or EAS. **Customize the report button** opens the widget settings. Done once the app checks in. |
| 2 | **Editor** | Cursor, Claude Code and VS Code lead; **Other editors** lists the rest. The MCP one-click comes first, **Use the CLI or skills instead** opens the other two ways, and **Set it up by hand** shows the MCP endpoint. Done once your editor calls Mushi Mushi. |
| 3 | **GitHub** | Link the repo so upgrade PRs, autofix and CI secret sync can use its token. |

If your only key is an SDK key, a note under the editor step offers **Add an MCP
key** (`mcp:read`), which your editor needs to read this app's reports.

### Once the app checks in

The **Update center** (per-package freshness and **Create Upgrade PR**) and
**SDK health** (problems that stop bug reports from arriving, each with a fix;
see [SDK health](/admin/sdk-health)) show below the steps. While the SDK is
current and nothing is wrong they are one line, with **Details** for the rest.
Until the app checks in, links to `#connect-sdk-health` open the report button step.

Native apps (Capacitor, Expo, React Native) also get **Native app CI secrets**.

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

The Mushi Mushi GitHub App can read Actions secrets but not write them. Auto-write
works when a fine-grained token with **Secrets: Read and write** is stored in
the project's settings. Otherwise the card shows the `gh secret set` commands
to run and the `env:` block to add to your CI workflow.

See also: [Self-hosting](/self-hosting) · [`AGENTS.md` native CI section](https://github.com/kensaurus/mushi-mushi/blob/master/AGENTS.md#native-ci-secrets-diagnostic--auto-write-jun-2026)

---

## SDK upgrade PR

When a package is outdated or deprecated:

1. Click **Create Upgrade PR** in the Update center (shown once the app checks in).
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

### Add the report button
Copy the snippet → paste into your app → deploy or run locally.

### Wire MCP
In the editor step, click **Add to Cursor** (or your editor's button), restart
the IDE, then run `mushi doctor`.

### Connect GitHub
Press **Connect GitHub**, sign in to GitHub and pick your repository. The list
shows only repositories you can open, with the one named like your app first.
If the Mushi Mushi GitHub App is not on your account yet, GitHub asks you to install
it first.

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
