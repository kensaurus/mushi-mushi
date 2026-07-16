# @mushi-mushi/plugin-cursor-cloud

> **Your AI wrote it. Mushi tells you why it broke.**

Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.


[![npm](https://img.shields.io/npm/v/@mushi-mushi/plugin-cursor-cloud)](https://www.npmjs.com/package/@mushi-mushi/plugin-cursor-cloud)
[![license](https://img.shields.io/npm/l/@mushi-mushi/plugin-cursor-cloud)](./LICENSE)
[![types](https://img.shields.io/npm/types/@mushi-mushi/plugin-cursor-cloud)](./src/index.ts)

> Mushi Mushi plugin: dispatch a [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent/api/v0) when a critical bug is classified or a fix is requested. The agent investigates, opens a draft PR, and reports back through the Cursor REST API.

This is the **opt-in marketplace** path. Teams install it in the Mushi admin
console, configure their Cursor API key + workspace ID + repo URL, and pick a
severity threshold. For the **project-wide default** Cursor agent path (no
plugin install needed), see `@mushi-mushi/agents`'s `cursor-cloud` adapter.

## Why this exists

A `report.classified` event firing with `severity: critical` should not wait
for a human to triage. This plugin watches that event (and `fix.requested`)
and asks Cursor's hosted agent to take a first pass — investigate, open a
draft PR, and stop. A human reviews the PR before it merges.

The flow:

```
Mushi report → classify-report → report.classified (severity=critical)
  → @mushi-mushi/plugin-cursor-cloud
  → POST https://api.cursor.com/v0/agents
  → Cursor cloud agent investigates → opens draft PR
  → audit log to Mushi console
```

## Spend safety

This plugin spends real Cursor API credit. Three hard guards are baked in:

1. **Severity gate** — defaults to `critical` only. Set
   `severityThreshold: 'low'` to widen, but think before doing so.
2. **Repo gate** — silently no-ops when no `repoUrl` is configured.
3. **Idempotent retries** — `withRetry` from `@mushi-mushi/plugin-sdk`
   honours `Retry-After` and treats 4xx (other than 429) as non-retryable
   so a bad config never burns money in a tight loop.

## Install

```bash
pnpm add @mushi-mushi/plugin-cursor-cloud @mushi-mushi/plugin-sdk
```

## Use

```ts
import { createCursorCloudPlugin } from '@mushi-mushi/plugin-cursor-cloud'

const handler = createCursorCloudPlugin({
  apiKey: process.env.CURSOR_API_KEY!,
  workspaceId: process.env.CURSOR_WORKSPACE_ID!,
  webhookSecret: process.env.MUSHI_PLUGIN_WEBHOOK_SECRET!,
  repoUrl: 'https://github.com/your-org/your-repo',
  severityThreshold: 'critical',
  // Optional — default is composer-2.5.
  model: 'composer-2.5',
  // Optional — default is true (auto-open draft PR).
  autoCreatePR: true,
  // Optional — default is 1 (single iteration before reporting back).
  maxIterations: 1,
})

// Wire to your serverless platform — Mushi calls handler with a Standard
// Webhooks-signed POST body.
export default handler
```

## Configuration

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | string | yes | — | Your Cursor API key (`cur_…`). |
| `workspaceId` | string | yes | — | Your Cursor workspace ID (`ws_…`). |
| `webhookSecret` | string | yes* | `MUSHI_PLUGIN_WEBHOOK_SECRET` | Standard Webhooks HMAC secret for inbound Mushi events. *Required for self-hosted installs. |
| `repoUrl` | string | recommended | — | Target repo URL. If omitted, the plugin silently no-ops. |
| `severityThreshold` | `'low' \| 'medium' \| 'high' \| 'critical'` | no | `'critical'` | Minimum severity that triggers a run. |
| `model` | string | no | `'composer-2.5'` | Cursor model slug. |
| `autoCreatePR` | boolean | no | `true` | Whether the agent should open a draft PR. |
| `maxIterations` | number | no | `1` | Max agent iterations per run. |
| `fetchImpl` | `typeof fetch` | no | global `fetch` | Override for tests. |

## Events handled

| Event | Action |
|---|---|
| `report.classified` | Dispatch a run when `data.classification.severity` ≥ `severityThreshold`. |
| `fix.requested` | Always dispatch a run (the user explicitly asked for a fix). |
| `qa_story.failed` | Dispatch a run when a QA story run fails all its assertions. Requires `repoUrl`. |

Other events are ignored.

## ⚠️ Breaking change in v0.3.0 — `webhookSecret` required

Previous versions derived the HMAC secret from `workspaceId` internally,
which was trivially forgeable. From v0.3.0 onward you **must** supply
`webhookSecret` (or `MUSHI_PLUGIN_WEBHOOK_SECRET`):

```diff
 const handler = createCursorCloudPlugin({
   apiKey: process.env.CURSOR_API_KEY!,
   workspaceId: process.env.CURSOR_WORKSPACE_ID!,
+  webhookSecret: process.env.MUSHI_PLUGIN_WEBHOOK_SECRET!,
   repoUrl: 'https://github.com/your-org/your-repo',
 })
```

The secret is the same Standard Webhooks HMAC key Mushi signs outbound
events with. Find it in Admin → Integrations → Cursor Cloud → Webhook secret.

## Audit log

Every dispatch writes a structured audit line:

```
[cursor-cloud] dispatched {"agentId":"agent_…","reportId":"…","model":"composer-2.5"}
```

Subscribe to the Mushi `plugin.dispatched` audit stream to track spend.

## Tests

```bash
pnpm --filter @mushi-mushi/plugin-cursor-cloud test
```

The test suite covers:

- Severity gate filters out anything below `severityThreshold` (no API call).
- `repoUrl` missing → silent no-op.
- `report.classified` with `severity: critical` → exactly one Cursor API call.
- `fix.requested` → exactly one Cursor API call regardless of severity.
- Retries on 503; bails on 401 (no money burned on bad keys).

## License

MIT — see [LICENSE](./LICENSE).


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 51 edge functions · 323 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
