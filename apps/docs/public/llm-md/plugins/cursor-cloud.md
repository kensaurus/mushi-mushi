# Cursor Cloud Agent

Source: https://kensaur.us/mushi-mushi/docs/plugins/cursor-cloud

---
title: Cursor Cloud Agent
description: Dispatch a Cursor Cloud Agent automatically when a Mushi report qualifies — it investigates, drafts a fix and opens a PR that links back to Mushi.
---

# Cursor Cloud Agent plugin

Automatically dispatches a [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent) run when a qualifying Mushi event fires. The agent investigates the issue in your codebase, drafts a fix, and opens a signed PR — posting the link back into the Mushi Fixes view without any human in the loop.

The **Cursor Cloud Agent** plugin is a first-party Mushi plugin (slug: `cursor-cloud-agent`). Unlike standard webhook plugins, Mushi calls the Cursor REST API directly — it never posts to the webhook URL in the install form.

You do not need the npm package
[`@mushi-mushi/plugin-cursor-cloud`](https://www.npmjs.com/package/@mushi-mushi/plugin-cursor-cloud)
for any of this. Mushi calls Cursor itself; the package is only for running
the same dispatch from your own server.

## Prerequisites

- A [Cursor](https://cursor.com) account with an API key (cursor.com/dashboard/integrations → API Keys).
- GitHub connected on the console's **Integrations** page — the agent needs your repo URL to open PRs.

## Setup

1. On the **Integrations** page, open the **Cursor Cloud** card and paste
   your Cursor API key (`crsr_…`). Optionally set a default model (default
   `composer-2.5`) and whether Cursor opens PRs (default on). **Test
   connection** checks the key.
2. That is enough to send a report to Cursor by hand (**Send to Cursor** on a
   report, or `mushi fix  --agent cursor_cloud`).
3. To start agents automatically, go to **Marketplace → Cursor Cloud Agent →
   Install**. The form asks for a webhook URL and signing secret like every
   listing, but Mushi does not call that URL for this plugin; it calls
   Cursor directly with the key from step 1. Keep the subscribed events
   (`report.classified`, `qa_story.failed`, `fix.requested`) or narrow them.

Automatic runs on `report.classified` start only for **critical** reports;
the install form has no setting to change that.

## Behaviour

| Event | When the agent runs | What it does |
|-------|---------------------|--------------|
| `report.classified` | Immediately after classification | Investigates the report in your codebase; opens a draft PR if `autoCreatePR` is enabled |
| `fix.requested` | When a fix is explicitly requested via the Fixes page, MCP, or CLI | Dispatches the agent for the specific report |
| `qa_story.failed` | When a scheduled QA story fails all assertions | Attempts to heal the failing story by opening a PR |
| `skill_pipeline.step.dispatched` | When a skill pipeline run in `cloud` mode advances to a step | Runs the step's pre-composed context packet as a Cursor Cloud agent prompt, stores the `agentId` on the step row, and checks the step in via the API |

For `skill_pipeline.step.dispatched`, the agent dispatches even when the marketplace plugin is not installed — credentials are read from the **Cursor Cloud** card on the Integrations page, and the repository from your GitHub connection. Without a GitHub repo URL the step is marked failed.

## Fixes view integration

Once the agent run terminates, the [Fixes page](/admin/fixes) shows:

- A **◆ Cursor badge** with the agent run ID — click to open the run transcript in Cursor's web interface.
- An **Artifact gallery** with any screenshots, logs, or files the agent produced.
- The **PR link** if `autoCreatePR` was enabled and the agent opened a PR.

## Common tasks

### Which reports start an agent

On `report.classified`, the plugin starts an agent only for critical
reports. To stop automatic runs for triaged reports entirely, remove
`report.classified` from the plugin's subscribed events.

### Triggering manually

You can also dispatch a Cursor Cloud Agent run outside of the Marketplace plugin:

```bash
# CLI
mushi fix <reportId> --agent cursor_cloud --wait

# MCP tool
dispatch_fix reportId=<reportId> agent=cursor_cloud
```

See [`mushi fix`](/sdks/cli) and [`@mushi-mushi/mcp`](/sdks/mcp) for details.

### Reviewing what the agent did

Navigate to **Admin → Fixes** → find the `cursor_cloud` row → expand the fix detail. The artifact gallery shows any files the agent produced. Click the ◆ badge to open the full run transcript in Cursor.

## Troubleshooting

- **Plugin installed but no dispatches** — check **Marketplace → Cursor Cloud Agent → Deliveries**. A `401` means the API key is expired or incorrect. A `403` means your plan doesn't have the `plugins` entitlement.
- **Agent runs but no PR** — verify **Auto-create PRs** is enabled in the plugin configuration, and that your GitHub integration is correctly configured with `contents:write` and `pull-requests:write` scopes.
- **Run completes with empty `prUrl`** — Cursor returns a `prUrl` only after the agent has created a branch and opened the PR. If `autoCreatePR` was disabled or the agent didn't make any changes, `prUrl` will be `null`.
- **`fix_dispatch_jobs` stuck in `running`** — the Cursor run may have timed out. Check the Cursor web interface for the agent run status. If the Node orchestrator was unreachable during delegation, the job may need manual status correction via Admin → Fixes → kebab menu → Cancel.
- **API key not resolving from Vault** — if the Node orchestrator can't reach the Supabase Vault for `vault://` refs, set `MUSHI_CURSOR_API_KEY_OVERRIDE` as an environment variable in the orchestrator process as a fallback. This is intended for self-hosted deployments only — managed cloud uses the Vault automatically.

## Related pages

- [Admin → Integrations → Cursor Cloud](/admin/integrations) — configure the Cursor API key and default model
- [Admin → Fixes](/admin/fixes) — view Cursor agent runs, badges, and artifact galleries
- [Concepts → Fix orchestrator](/concepts/fix-orchestrator) — how the orchestrator selects and dispatches agents
- [Concepts → Connecting your orchestrator](/concepts/orchestrator-interop) — MCP, CLI, REST, and A2A dispatch surfaces
