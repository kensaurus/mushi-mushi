# @mushi-mushi/plugin-cursor-cloud

> **Your AI wrote it. Mushi tells you why it broke.**

[![npm](https://img.shields.io/npm/v/@mushi-mushi/plugin-cursor-cloud)](https://www.npmjs.com/package/@mushi-mushi/plugin-cursor-cloud)
[![license](https://img.shields.io/npm/l/@mushi-mushi/plugin-cursor-cloud)](./LICENSE)
[![types](https://img.shields.io/npm/types/@mushi-mushi/plugin-cursor-cloud)](./src/index.ts)

Starts a [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent/api/endpoints)
on your repo when Mushi triages a critical bug or a fix is requested. The
agent investigates and opens a draft PR for you to review.

**Do you need this package?** No, if you use Mushi Cloud. Mushi starts
Cursor agents itself: add your Cursor API key on the **Integrations** page
(Cursor Cloud card) and send any report to Cursor, or install **Cursor Cloud
Agent** from the Marketplace page to start agents automatically. Either way
Mushi calls Cursor's API directly and never sends events to this package. It is
only for running the dispatch from your own server, for example next to a
self-hosted Mushi.

```bash
npm i @mushi-mushi/plugin-cursor-cloud @mushi-mushi/plugin-sdk
```

```ts
import { createCursorCloudPlugin } from '@mushi-mushi/plugin-cursor-cloud'

const handler = createCursorCloudPlugin({
  apiKey: process.env.CURSOR_API_KEY!,
  webhookSecret: process.env.MUSHI_PLUGIN_WEBHOOK_SECRET!,
  repoUrl: 'https://github.com/your-org/your-repo',
})
```

Docs: https://kensaur.us/mushi-mushi/docs/plugins/cursor-cloud

## Why this exists

A `report.classified` event firing with `severity: critical` should not wait
for a human to triage. This plugin watches that event (and `fix.requested`)
and asks Cursor's hosted agent to take a first pass — investigate, open a
draft PR, and stop. A human reviews the PR before it merges.

The flow:

```
Mushi report → classify-report → report.classified (severity=critical)
  → @mushi-mushi/plugin-cursor-cloud
  → POST https://api.cursor.com/v1/agents
  → Cursor cloud agent investigates → opens draft PR
  → one log line on your server
```

## Spend safety

This plugin spends real Cursor API credit. Four guards are built in:

1. **Severity gate** — defaults to `critical` only. Set
   `severityThreshold: 'low'` to widen, but think before doing so.
2. **Repo gate** — silently no-ops when no `repoUrl` is configured.
3. **Idempotent retries** — `withRetry` from `@mushi-mushi/plugin-sdk`
   honours `Retry-After` and treats 4xx (other than 429) as non-retryable
   so a bad config never burns money in a tight loop. On top of that every
   dispatch sends a deterministic `agentId` (`bc-<uuid>` derived from the
   event + report id), so a redelivered Mushi event gets Cursor's
   `409 agent_id_conflict` instead of a second agent.
4. **No double dispatch** — when Mushi's own fix-worker already handed the
   report to Cursor (`autofix_agent = 'cursor_cloud'`), the `fix.requested`
   payload carries `data.fix.externalAgentId` and this plugin logs and skips.

## Use

```ts
import { createCursorCloudPlugin } from '@mushi-mushi/plugin-cursor-cloud'

const handler = createCursorCloudPlugin({
  apiKey: process.env.CURSOR_API_KEY!,
  webhookSecret: process.env.MUSHI_PLUGIN_WEBHOOK_SECRET!,
  repoUrl: 'https://github.com/your-org/your-repo',
  severityThreshold: 'critical',
  // Optional — branch/ref the agent starts from (repos[].startingRef).
  startingRef: 'main',
  // Optional — default is composer-2.5 (sent as model.id).
  model: 'composer-2.5',
  // Optional — default is true (top-level autoCreatePR; Cursor opens drafts).
  autoCreatePR: true,
})

// `handler({ rawBody, headers })` returns `{ status, body }`. Mount it with
// expressMiddleware from '@mushi-mushi/plugin-sdk/express' or honoHandler
// from '@mushi-mushi/plugin-sdk/hono'.
export default handler
```

For `skill_pipeline.step.dispatched`, set `MUSHI_API_KEY` and
`MUSHI_API_URL` (your Mushi API base, e.g.
`https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`) so the plugin
can check the step back in. Without `MUSHI_API_KEY` the step stays `running`.

## Configuration

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `apiKey` | string | yes | — | Your Cursor API key (`crsr_…`). |
| `webhookSecret` | string | yes* | `MUSHI_PLUGIN_WEBHOOK_SECRET` | Standard Webhooks HMAC secret for inbound Mushi events. *Required for self-hosted installs. |
| `repoUrl` | string | recommended | — | Target repo URL (`https://github.com/org/repo`, sent as `repos[].url`). If omitted, the plugin silently no-ops. |
| `startingRef` | string | no | repo default branch | Branch/ref the agent starts from (`repos[].startingRef`). |
| `severityThreshold` | `'low' \| 'medium' \| 'high' \| 'critical'` | no | `'critical'` | Minimum severity that triggers a run. |
| `model` | string | no | `'composer-2.5'` | Cursor model id (`model.id`). |
| `autoCreatePR` | boolean | no | `true` | Whether Cursor should open a (draft) PR — top-level `autoCreatePR` in v1. |
| `apiBase` | string | no | `https://api.cursor.com` | Override for proxies / tests. |
| `fetchImpl` | `typeof fetch` | no | global `fetch` | Override for tests. |
| `workspaceId` | string | deprecated | — | Not used by the v1 API; accepted so old configs still type-check. |
| `maxIterations` | number | deprecated | — | v1 has no iteration cap; ignored. |

## Events handled

| Event | Action |
|---|---|
| `report.classified` | Dispatch a run when `data.classification.severity` ≥ `severityThreshold`. |
| `fix.requested` | Dispatch a run regardless of severity — unless `data.fix.externalAgentId` is set (Mushi's fix-worker already dispatched this fix to Cursor). |
| `qa_story.failed` | Dispatch a run when a QA story run fails all its assertions. Requires `repoUrl`. |
| `skill_pipeline.step.dispatched` | Run one skill-pipeline step and check the `agentId` back in via `/v1/admin/skills/pipelines/:run/steps/:idx/checkin`. |

Other events are ignored.

## v0 vs v1

Cursor serves two Cloud Agents APIs. This plugin (since 0.6.0) and Mushi's
fix-worker speak **v1** (`POST /v1/agents`):

| | v0 (legacy, still served) | v1 (current) |
|---|---|---|
| Request | `{ prompt:{text}, source:{repository,ref}, target:{autoCreatePr,branchName,skipReviewerRequest}, model, webhook:{url,secret} }` | `{ prompt:{text}, repos:[{url,startingRef}], autoCreatePR, agentId:'bc-<uuid>', name, model:{id}, skipReviewerRequest }` |
| Response | `{ id, status, target:{url,branchName,prUrl} }` | `{ agent:{id,status,url,latestRunId}, run:{id,status,git:{branches:[{repoUrl,branch,prUrl}]}} }` |
| Idempotency | none | `agentId` reuse ⇒ `409 agent_id_conflict` |
| Branch name | `target.branchName` | not settable — ask for it in the prompt |
| Completion | `webhook` (`X-Webhook-Signature: sha256=<hex>`) on FINISHED/ERROR | poll `GET /v1/agents/{id}/runs/{runId}` (webhooks "coming soon") |

Mushi's server keeps a v0 code path behind `CURSOR_USE_V0_WEBHOOK=1` purely
for the push webhook (its `cursor-webhook` edge function verifies the
signature); this npm plugin has no completion tracking of its own and uses
v1 only.

## Breaking change in v0.3.0 — `webhookSecret` required

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

The secret is the signing secret of the webhook plugin that sends this
server its events (the value set when that plugin is installed).

## Log line

Every dispatch writes one line to your server's log:

```
[cursor-cloud] dispatched {"agentId":"agent_…","reportId":"…","model":"composer-2.5"}
```

Mushi does not see these dispatches; check spend on your Cursor dashboard.

## Tests

```bash
pnpm --filter @mushi-mushi/plugin-cursor-cloud test
```

The test suite covers:

- Severity gate filters out anything below `severityThreshold` (no API call).
- `repoUrl` missing → silent no-op.
- `report.classified` with `severity: critical` → exactly one `POST /v1/agents` with the documented v1 body.
- `fix.requested` → exactly one Cursor API call regardless of severity, and none when `externalAgentId` is already set.
- `409 agent_id_conflict` on a redelivered event is treated as success.
- Bails on 401 (no money burned on bad keys).

## License

MIT — see [LICENSE](./LICENSE).


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 519 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
