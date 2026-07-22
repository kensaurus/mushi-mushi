# Integrations

Source: https://kensaur.us/mushi-mushi/docs/admin/integrations

---
title: Integrations
---

# Integrations

**Route:** `/integrations/config`

> **Scenario:** You just set up Mushi and want new bugs to land in Linear, Sentry
> feedback to flow in, and fix PRs to open on your main GitHub repo — all from one
> page, in under 10 minutes.

The Integrations page wires Mushi to the tools your team already uses: Sentry and
Langfuse for context, GitHub for code, and Jira / Linear / PagerDuty for routing.

---

## Hero

The page header shows: **N/M connected** (how many platforms are configured and passing
their health probe), and the timestamp of the last probe event.

---

## Core platform integrations

These integrations feed data *into* Mushi or extend its internal capabilities.

### Sentry

| Field | Description |
|-------|-------------|
| **DSN** | Sentry project DSN — enables Sentry User Feedback events to forward into Mushi |
| **Auth token** | For issue-level metadata queries |
| **Organisation slug** | Your Sentry org |
| **Project slug** | Your Sentry project |

After saving, Mushi subscribes to Sentry's User Feedback webhook so new Sentry feedback
automatically becomes a Mushi report.

### Langfuse

| Field | Description |
|-------|-------------|
| **Public key** | Langfuse project public key |
| **Secret key** | Langfuse project secret key |
| **Base URL** | Override for self-hosted Langfuse |

When configured, every LLM call from Mushi's edge functions streams a trace to Langfuse.
Traces are visible in [Integration health](/admin/health) with a direct link.

### GitHub

| Field | Description |
|-------|-------------|
| **GitHub App installation ID** | The ID shown in your GitHub App settings |
| **Repository URL** | The repo Mushi opens fix PRs against |
| **Default branch** | The base branch for fix-worker PRs |

The **Codebase index** card shows the indexing status for the active project's repo —
`ok`, `stale`, `failed`, `off`, or `never`. The index powers the [Repo page](/admin/repo)
branch graph and the fix-worker's code context.

### Cursor Cloud

| Field | Description |
|-------|-------------|
| **API Key** | Your Cursor API key — stored encrypted in the Supabase Vault; never exposed in the UI |
| **Default model** | Agent model (`composer-2.5` or your account default) |
| **Auto-create PRs** | When enabled, Cursor opens a signed draft PR automatically after the fix run |
| **Max iterations** | Maximum agent loops per dispatch (default: 1) |

When configured, Mushi can dispatch a Cursor Cloud Agent to fix classified reports — the agent opens a signed draft PR and posts the link back to the [Fixes page](/admin/fixes). Activate via:

- **Marketplace** — install the _Cursor Cloud Agent_ plugin for event-driven dispatch (recommended for per-severity gating).
- **Settings → Autofix** — set `autofix_agent = cursor_cloud` to make Cursor the project-wide default.

The API Key is stored via Supabase Vault. The raw key is never written to any database column. For self-hosted deployments where Supabase Vault is not accessible from the Node orchestrator, set `MUSHI_CURSOR_API_KEY_OVERRIDE` in your Node orchestrator environment as an escape hatch.

Each platform card shows:
- **Connection status pill** — connected / disconnected / error
- **Latest probe latency**
- **7-day health sparkline**

Click **Edit** to reveal the form fields. Click **Test** to run a live probe and see
the result as a status toast.

---

## Routing destinations

These integrations receive Mushi events as outbound webhooks or API calls.

| Destination | What it receives |
|-------------|-----------------|
| **Jira** | Creates a Jira issue when a report is triaged |
| **Linear** | Creates a Linear issue; syncs fix status back |
| **GitHub Issues** | Opens a GitHub Issue for triaged reports |
| **PagerDuty** | Fires a PagerDuty incident for `critical` reports |

Each routing provider card shows its connection state and a **Pause / Resume** toggle.
When paused, events are dropped — not queued — so resume promptly.

**Connecting a routing provider:**
1. Click **Edit**.
2. Enter the required credentials (API key, project/team ID, etc.).
3. Click **Save**.
4. Click **Test** to fire a test event.

**Disconnecting:** click **Disconnect** → confirm in the dialog.

For richer event routing (filter by severity, round-robin, fanout to multiple
destinations), use the [Plugin marketplace](/admin/marketplace) instead. The routing
providers here are pre-built, opinionated connectors.

---

## Common tasks

### Connecting GitHub so fix-worker can open PRs
1. Create a [GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) and install it on your repo.
2. On the **GitHub** card, click **Edit**.
3. Enter the App installation ID, repo URL, and default branch.
4. Click **Save** → **Test** → confirm the probe returns green.
5. Open [Repo graph](/admin/repo) — the repo header should show your connected repo.

### Forwarding Sentry User Feedback into Mushi
1. On the **Sentry** card, click **Edit**.
2. Enter your DSN, auth token, org slug, and project slug.
3. Click **Save** → **Test**.
4. In Sentry, add a User Feedback webhook pointing to your Mushi API endpoint.
5. Submit a test Sentry feedback — it should appear in [Reports](/admin/reports) within 30 seconds.

### Routing critical reports to PagerDuty
1. In **Routing destinations**, find PagerDuty → click **Edit**.
2. Enter your PagerDuty API key and service ID.
3. Click **Save** → **Test** → confirm a test incident fires.
4. Go to [Reports](/admin/reports) → triage a `critical` report → confirm a PagerDuty incident opens automatically.

---

## API

```bash
GET  /v1/admin/integrations/platform
PUT  /v1/admin/integrations/platform/:kind   { ...credentials }
POST /v1/admin/health/integration/:kind      (live probe)
GET  /v1/admin/integrations                  (routing destinations)
POST /v1/admin/integrations                  { type, ...config }
DELETE /v1/admin/integrations/:type
```

---

## Common tasks

### Setting up Cursor Cloud auto-fix
1. Create a Cursor API key at [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations) → API Keys.
2. Connect **GitHub (code repo)** first — Cursor agents need your repo URL and token.
3. On the **Cursor Cloud** card, click **Edit**, paste the `crsr_…` key, then **Save** → **Test connection**.
4. Install the **Cursor Cloud Agent** plugin from [Marketplace](/admin/marketplace) (subscribe to `report.classified`) — or set `autofix_agent = cursor_cloud` in Settings if you want every fix dispatched via Cursor.
5. Triage a `critical` report → trigger dispatch → the [Fixes page](/admin/fixes) will show the Cursor agent badge and PR link once the run completes.

## Related pages

- [Repo graph](/admin/repo) — powered by the GitHub integration
- [Integration health](/admin/health) — LLM and cron health (not integration probes)
- [Plugin marketplace](/admin/marketplace) — advanced routing and custom webhooks
- [Fix orchestrator](/admin/fixes) — Cursor agent badge, artifact gallery, and live streaming view
