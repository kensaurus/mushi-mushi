# Cursor Cloud Agent

Source: https://kensaur.us/mushi-mushi/docs/plugins/cursor-cloud

---
title: Cursor Cloud Agent
description: Start a Cursor Cloud Agent automatically when a Mushi Mushi report qualifies. It investigates, drafts a fix and opens a draft PR that names the report.
---

# Cursor Cloud Agent plugin

Starts a [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent) run when a qualifying Mushi Mushi event fires. The agent investigates the issue in your repo and, when PR creation is on (the default), opens a **draft** PR titled `fix: … (MUSHI-)`. It is told never to merge; you review and merge.

The **Cursor Cloud Agent** plugin is a first-party plugin (slug: `cursor-cloud-agent`). For the events below, Mushi Mushi calls the Cursor API directly and does not post to the webhook URL in the install form.

You do not need the npm package
[`@mushi-mushi/plugin-cursor-cloud`](https://www.npmjs.com/package/@mushi-mushi/plugin-cursor-cloud)
for any of this. Mushi calls Cursor itself; the package is only for running
the same dispatch from your own server.

## Prerequisites

- A [Cursor](https://cursor.com) account with an API key (cursor.com/dashboard/integrations → API Keys).
- GitHub connected on the console's **Integrations** page, so Mushi Mushi knows your repo URL. Without it, no agent starts.
- Your Cursor account connected to GitHub with access to that repo. Cursor clones the repo and opens the PR through its own GitHub connection.

## Setup

1. On the **Integrations** page, open the **Cursor Cloud** card and paste
   your Cursor API key (`crsr_…`). Optionally set a default model (default
   `composer-2.5`) and whether Cursor opens PRs (default on). **Test
   connection** checks the key.
2. That is enough to send a report to Cursor by hand:
   `mushi fix  --agent cursor_cloud`, MCP `dispatch_fix` with
   `agent=cursor_cloud`, or a retry on the **Fixes** page with **Cursor Cloud
   agent** picked.
3. To start agents automatically, go to **Marketplace → Cursor Cloud Agent →
   Install**. The form asks for a webhook URL and signing secret like every
   listing, but for the events below Mushi Mushi calls Cursor directly with
   the key from step 1 and does not post to that URL (only the **Test**
   button and any other event you subscribe it to are posted there). Keep the subscribed events
   (`report.classified`, `qa_story.failed`, `fix.requested`) or narrow them.

Automatic runs on `report.classified` start only for **critical** reports;
the install form has no setting to change that.

## Behaviour

| Event | When the agent runs | What it does |
|-------|---------------------|--------------|
| `report.classified` | Right after triage, for critical reports only | Starts an agent with the report id; it opens a draft PR when PR creation is on |
| `fix.requested` | When the fix worker has already handed a report to Cursor (`mushi fix --agent cursor_cloud`, MCP `dispatch_fix`, a Fixes-page retry) | Nothing: the event names the agent that is already running, so the plugin never starts a second one |
| `qa_story.failed` | Every time a QA story run fails or errors | Starts an agent with a generic investigate-and-fix prompt. The prompt carries no story details. Every QA failure in a project reuses the same agent id, which Cursor rejects as a duplicate, so later failures don't start a new agent |
| `skill_pipeline.step.dispatched` | When a skill pipeline run in `cloud` mode reaches a step | Runs the step's context packet as the agent prompt, stores the agent id on the step, and asks the agent to report back with the `checkin_pipeline_step` MCP tool |

For `skill_pipeline.step.dispatched`, the agent starts even when the marketplace plugin is not installed. The key comes from the **Cursor Cloud** card on the Integrations page, and the repo from your GitHub connection. Without a key or a repo URL the step is marked failed.

## Fixes view integration

Agents started by `mushi fix --agent cursor_cloud`, MCP `dispatch_fix` or a Fixes-page retry with Cursor picked are fix attempts, so the [Fixes page](/admin/fixes) shows them:

- A **Cursor badge** with the agent id, linking to the run in Cursor.
- An **artifact gallery** with any screenshots, logs or files the agent produced.
- The **PR link** once the agent opens a PR.

Agents the Marketplace plugin starts on its own (`report.classified`,
`qa_story.failed`) are not recorded as fix attempts. You find them on the
**Marketplace → Deliveries** tab (the response column shows `agentId=…`) and
in your Cursor dashboard.

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

For a fix attempt: open **Fixes**, find the `cursor_cloud` row and expand it. The artifact gallery shows any files the agent produced, and the Cursor badge opens the run in Cursor.

## Troubleshooting

- **Plugin installed but nothing on the Deliveries tab**: no key on the Cursor Cloud card, no GitHub repo URL, or no report triaged as critical yet. In each of these cases the plugin stops before it logs a delivery.
- **Deliveries show an error**: the HTTP code is Cursor's answer. A `401` means the API key is wrong or expired.
- **Agent runs but no PR**: check that PR creation is on in the **Cursor Cloud** card on the Integrations page, and that your Cursor account can reach the repo on GitHub. An agent that changes nothing opens no PR.
- **A fix attempt stays open**: Mushi Mushi checks Cursor runs every 5 minutes and marks an attempt failed when it is still open after 24 hours. Check the run's status in Cursor.
- **Self-hosted Node orchestrator can't read the key from Vault**: set `MUSHI_CURSOR_API_KEY_OVERRIDE` in the orchestrator's environment. Mushi Cloud reads the key from Vault and does not need this.

## Related pages

- [Admin → Integrations → Cursor Cloud](/admin/integrations): the Cursor API key and default model
- [Admin → Fixes](/admin/fixes): Cursor fix attempts, badges and artifact galleries
- [Concepts → Fix orchestrator](/concepts/fix-orchestrator): how agents are chosen and dispatched
- [Concepts → Connecting your orchestrator](/concepts/orchestrator-interop): MCP, CLI, REST and A2A dispatch
