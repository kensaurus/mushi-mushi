# Cursor Cloud Agent — Integration Guide

> **What it does:** When a bug report lands in Mushi, clicking "Send to
> Cursor" (or enabling auto-dispatch on critical severity) fires a Cursor
> Cloud Agent that clones your repo, authors the fix, and opens a signed
> draft PR — no human triage step required.

---

## Contents

1. [Quick start](#quick-start)
2. [How the pipeline works](#how-the-pipeline-works)
3. [Setup checklist](#setup-checklist)
4. [Configuration reference](#configuration-reference)
5. [Admin console UX](#admin-console-ux)
6. [Reading the Fix card](#reading-the-fix-card)
7. [GitHub webhook (required for PR sync)](#github-webhook-required-for-pr-sync)
8. [Auto-dispatch on critical severity](#auto-dispatch-on-critical-severity)
9. [Using the CLI and MCP](#using-the-cli-and-mcp)
10. [Troubleshooting](#troubleshooting)

---

## Quick start

1. **Get a Cursor API key** — cursor.com/dashboard/integrations → API Keys → Create.
2. **Add it in Mushi** — Admin → Integrations → Cursor Cloud → paste the key → Save.
3. **Confirm GitHub is wired** — Admin → Integrations → GitHub must have a repo URL and installation token.
4. **Wire the GitHub webhook** — see [GitHub webhook](#github-webhook-required-for-pr-sync) below.
5. **Send a report to Cursor** — Reports page → any row → diamond (◆) button → watch the Fix card.

---

## How the pipeline works

```
Reports page ──"Send to Cursor"──→ POST /v1/admin/fixes/dispatch
                                    { agentOverride: 'cursor_cloud' }
                                           │
                              fix_dispatch_jobs row inserted
                              (agent_override='cursor_cloud')
                                           │
                                    fix-worker (Deno edge fn)
                                           │
                               reads cursor_api_key_ref from
                               project_settings (Vault-resolved)
                                           │
                               POST api.cursor.com/v1/agents
                               { prompt, repos, autoCreatePR,
                                 skipReviewerRequest, envVars }
                                           │
                             Cursor API → { agent.id, run.id,
                                           agent.branchName }
                                           │
                          fix_attempts: status='running'
                          cursor_agent_id=<id>
                          pr_url='cursor.com/agents/<id>'   ← progress page
                          fix_dispatch_jobs: status='completed'
                                           │
                              [async — 5–20 min]
                                           │
                             Cursor commits fix, opens GitHub PR
                                           │
                          GitHub pull_request webhook fires
                              webhooks-github-indexer
                                           │
                          Extracts cursor_agent_id from PR body
                          fix_attempts: pr_url='github.com/…/pull/N'
                                        pr_number=N
                                        status='completed'
                                        summary='…PR #N…'
                                           │
                           Fix card: "View Cursor agent ↗"
                                → "View PR #N"
```

The fix-worker considers the dispatch complete once the Cursor API accepts
the request (HTTP 202). Cursor then runs fully asynchronously — Mushi learns
the PR was opened only when GitHub fires the webhook.

---

## Setup checklist

- [ ] Cursor API key saved in Integrations → Cursor Cloud
- [ ] Integration health shows **Connection OK** (green) for Cursor Cloud
- [ ] GitHub integration configured (repo URL + installation token)
- [ ] GitHub webhook pointing at Mushi (see below)
- [ ] `project_settings.autofix_enabled = true` (Settings → General → Auto-fix)

---

## Configuration reference

| Field | Where in console | Description |
|-------|-----------------|-------------|
| **API Key** (`cursor_api_key_ref`) | Integrations → Cursor Cloud → API Key | `crsr_…` key. Stored in Supabase Vault — Mushi never exposes the raw value. |
| **Model** (`cursor_default_model`) | Integrations → Cursor Cloud → Model | Optional. Blank = account default (`composer-2`). Valid slugs: `composer-2`, `claude-4-sonnet-thinking`, `claude-opus-4-7-thinking-xhigh`, `gpt-5.5-medium`. Unrecognised values are silently ignored and the account default is used. |
| **Auto-create PRs** (`cursor_auto_create_pr`) | Integrations → Cursor Cloud → Auto-create PRs | `true` (default): Cursor opens a draft PR as soon as the fix is committed. `false`: Cursor commits only — useful for manual branch inspection before a PR exists. |

Full knob descriptions (including `howItWorks`, defaults, and `whenToChange`)
are in [`configDocs.ts`](../apps/admin/src/lib/configDocs.ts) under IDs
`cursor-api-key`, `cursor-default-model`, `cursor-auto-create-pr`.

---

## Admin console UX

### Reports page — "Send to Cursor"

The diamond (◆) button appears on each report row when `cursor_api_key_ref`
is configured. Clicking it:

1. POSTs `{ reportId, projectId, agentOverride: 'cursor_cloud' }` to
   `/v1/admin/fixes/dispatch`.
2. Shows a toast: *"Cursor Cloud Agent is running. Opening agent page…"*
3. Immediately opens `cursor.com/agents/<id>` in a new tab so you can
   watch the agent work in real time.

### Fixes page — In-flight dispatches

While the `fix_dispatch_jobs` row is `queued` or `running`, a compact banner
appears at the top of the Fixes page with a pulsing purple "Cursor Cloud"
badge — visible even before the `fix_attempts` row exists.

### Fix card

Each `cursor_cloud` fix attempt renders:

| Element | Condition | What it shows |
|---------|-----------|---------------|
| **`via Cursor Cloud`** label | always | Agent name (not the raw `cursor_cloud` slug) |
| **Pulsing Cursor badge** | `status=running/queued` | Links to `cursor.com/agents/<id>`; ring pulses while agent is live |
| **Static Cursor badge** | after completion | Same link, no pulse |
| **"View Cursor agent ↗"** | `pr_url` points to `cursor.com` | Shown when GitHub PR not yet opened |
| **"View PR #N"** | `pr_url` points to `github.com` | Shown once the GitHub PR webhook fires |
| **Failure badge** | `status=failed` | Human-readable: "Cursor API error", "Sandbox timeout", etc. |

### PDCA pipeline graph

The 5-stage pipeline (P→D→D→C→A) renders cursor-aware statuses:

| Stage | State | Meaning |
|-------|-------|---------|
| Dispatch | active → done | Transitions once fix-worker sends the API request |
| Draft PR | **active** (pulsing) | `pr_url` is still the `cursor.com` agent page |
| Draft PR | done | GitHub PR opened; `pr_url` is a `github.com` URL |

The **Dispatch node** is clickable and links directly to the Cursor agent
page (`cursor.com/agents/<id>`) so you can open the run from the graph.

### PDCA receipt

The DO stage in the receipt adapts to the cursor agent lifecycle:

- *"Cursor agent running on `branch-name`"* — agent working, PR not yet open
- *"PR opened on `branch-name` (N files)"* — GitHub PR synced back

---

## Reading the Fix card

```
┌─────────────────────────────────────────────────────────────────────┐
│  [running]  via Cursor Cloud  [● Cursor bc-cdc2…]                  │
│                                                                     │
│  Cursor Cloud Agent running on cursor/mastery-ring-a275 — PR not   │
│  yet opened. Track at: cursor.com/agents/bc-cdc2cc24…              │
│                                                                     │
│  [PDCA pipeline graph]                                              │
│                                                                     │
│  [View Cursor agent ↗]  [Langfuse trace]  [Show details]           │
└─────────────────────────────────────────────────────────────────────┘
```

After the GitHub PR is opened (webhook fires):

```
┌─────────────────────────────────────────────────────────────────────┐
│  [completed]  via Cursor Cloud  [◆ Cursor bc-cdc2…]                │
│                                                                     │
│  Cursor Cloud Agent opened GitHub PR #19 — awaiting review & merge.│
│  Agent run: cursor.com/agents/bc-cdc2cc24…                         │
│                                                                     │
│  [PDCA pipeline graph]                                              │
│                                                                     │
│  [View PR #19]  [Langfuse trace]  [Show details]                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## GitHub webhook (required for PR sync)

Without the webhook, the Fix card stays on `running` indefinitely even after
Cursor opens the PR — Mushi has no way to learn about the PR without GitHub
pushing the event.

### Setup

1. In GitHub: repo Settings → Webhooks → Add webhook.
2. **Payload URL** — `https://<supabase-project-ref>.supabase.co/functions/v1/webhooks-github-indexer`
3. **Content type** — `application/json`
4. **Secret** — any random string; paste the same value in Mushi Integrations → GitHub → Webhook secret.
5. **Events** — select *Pull requests* (required) and *Check runs* (optional, for CI status sync).

### What the webhook handler does

`webhooks-github-indexer` receives the `pull_request` event and:

1. Matches the PR to a `fix_attempts` row via `pr_url` (standard LLM fixes) or via the `cursor_agent_id` extracted from the Cursor footer in the PR body (Cursor fixes).
2. Updates `fix_attempts`:
   - `pr_url` → real GitHub PR URL
   - `pr_number` → PR number
   - `status` → `'completed'`
   - `summary` → `"Cursor Cloud Agent opened GitHub PR #N — awaiting review & merge."`
3. Emits a `pr_state_changed` fix event.

---

## Auto-dispatch on critical severity

To have Mushi automatically send every critical-severity report to a Cursor
agent (no manual "Send to Cursor" click):

1. Set `autofix_agent = 'cursor_cloud'` in Settings → General → Auto-fix agent.
2. Ensure `autofix_enabled = true`.
3. When `classify-report` promotes a report to `critical`, the pipeline inserts
   a `fix_dispatch_jobs` row with `agent_override=null`; `fix-worker` reads
   `project_settings.autofix_agent` and dispatches to Cursor.

> **Caution:** On a busy codebase this can generate many parallel agent runs.
> Each run consumes Cursor API quota. Consider keeping `autofix_agent='claude_code'`
> (default LLM path) as the global default and using the per-report
> "Send to Cursor" button for the cases that need the extra agent depth.

---

## Using the CLI and MCP

### CLI

```bash
# Dispatch a report to a Cursor agent (wait for PR URL)
mushi fix <reportId> --agent cursor_cloud --wait

# Check fix status
mushi fix status <fixAttemptId>
```

### MCP (`dispatch_fix` tool)

```json
{
  "tool": "dispatch_fix",
  "arguments": {
    "report_id": "<uuid>",
    "project_id": "<uuid>",
    "agent": "cursor_cloud"
  }
}
```

The MCP server is registered via Admin → Settings → MCP install card.
Use `mcp:write` scope on your API key to allow dispatch.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|-------------|------------|
| Fix card `failed` — "Cursor API error 400: invalid_model" | `cursor_default_model` set to an unrecognised slug | Clear the Model field in Integrations → Cursor Cloud; leave blank for account default |
| Fix card stuck on `running` indefinitely | GitHub webhook not configured, or secret mismatch | Verify webhook URL and secret match in GitHub + Mushi Integrations → GitHub |
| "cursor_cloud requires a GitHub repo URL" | GitHub integration not configured | Add repo URL + installation token in Integrations → GitHub |
| Vault lookup failed on API key | Key was deleted from Supabase Vault | Re-enter the key in Integrations → Cursor Cloud |
| "Cursor API unreachable" | Network timeout from Deno edge function | Retry — the Cursor REST API is external and may have brief outages |
| Integration health shows `down` / `Invalid API key` | Key expired or revoked | Generate a new key at cursor.com/dashboard/integrations |
| In-flight dispatch banner stays after agent run | `fix_dispatch_jobs.status` stale | Should resolve automatically after `fix-worker` completes; refresh the page |
| PR link shows "View Cursor agent ↗" even after PR was opened | Webhook not receiving events | Check GitHub → repo Settings → Webhooks → Recent Deliveries for errors |

---

## Database schema

### `fix_attempts` — cursor-specific columns

| Column | Type | Description |
|--------|------|-------------|
| `agent` | `text` | `'cursor_cloud'` for this integration |
| `cursor_agent_id` | `text` | Cursor agent run identifier (`bc-…`) |
| `cursor_run_id` | `text` | Sub-run ID from the dispatch response |
| `cursor_artifacts` | `jsonb` | `[{ kind, path, mime }]` — screenshots/videos/logs from the run |
| `failure_category` | `text` | `cursor_api_error` when the Cursor API rejects the dispatch |
| `pr_url` | `text` | Transitions: `cursor.com/agents/<id>` → `github.com/…/pull/N` |

### `fix_dispatch_jobs` — cursor-specific columns

| Column | Type | Description |
|--------|------|-------------|
| `agent_override` | `text` | `'cursor_cloud'` when dispatched via "Send to Cursor" button |

---

*Last updated 2026-05-21 — see [`docs/execplans/PLANS.md` Plan 007](execplans/PLANS.md) for the full implementation history.*
