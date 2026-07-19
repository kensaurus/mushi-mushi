# Webhook events

Source: https://kensaur.us/mushi-mushi/docs/plugins/events

---
title: Webhook events
---

# Webhook events

Every event ships with this envelope:

```ts
interface MushiEvent {
  event: TName
  project_id: string
  occurred_at: string  // ISO 8601 UTC
  data: TData
}
```

## Event reference

| Event                     | When                                                                         | `data` shape (subset)                                      |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `report.created`          | A new report row is inserted                                                 | `{ report_id, severity, title, url }`                      |
| `report.classified`       | `classify-report` finishes successfully                                      | `{ report_id, taxonomy_path, confidence }`                 |
| `report.status_changed`   | Status updated via API or admin                                              | `{ report_id, from, to, actor_id }`                        |
| `report.commented`        | A comment is added to a report                                               | `{ report_id, comment_id, body, visible_to_reporter }`     |
| `report.dedup_grouped`    | Report is grouped into a dedup cluster                                       | `{ report_id, group_id, peers }`                           |
| `fix.requested`           | A fix dispatch has been requested (pre-agent launch)                         | `{ report_id, fix_id }`                                    |
| `fix.proposed`            | Orchestrator opens a draft PR (standard agent or Cursor Cloud Agent)         | `{ report_id, attempt_id, pr_url }`                        |
| `fix.applied`             | Draft PR merged                                                              | `{ report_id, attempt_id, pr_url, sha }`                   |
| `fix.failed`              | Orchestrator gives up after retry budget                                     | `{ report_id, attempt_id, reason }`                        |
| `qa_story.passed`         | A QA story run completed successfully                                        | `{ story_id, title, duration_ms }`                         |
| `qa_story.failed`         | A QA story run failed all assertions                                         | `{ story_id, title, failure_reason }`                      |
| `judge.score_recorded`    | `judge-batch` records a score                                                | `{ report_id, score, prompt_version }`                     |
| `sla.breached`            | A report has exceeded its severity SLA target                                | `{ report_id, severity, target_seconds, elapsed_seconds }` |
| `skill_pipeline.step.dispatched` | A skill pipeline step is dispatched for execution (cloud mode)        | `{ runId, stepIndex, skillSlug, contextPacket, projectId }` |

## Subscribing to a subset

Pass `events: ['report.created', 'fix.applied']` when installing the
plugin and Mushi will only dispatch those. Empty array = subscribe to
everything (default for first-party plugins).

## Cursor Cloud Agent events

The **Cursor Cloud Agent** plugin (`cursor-cloud-agent`) listens to `report.classified`, `fix.requested`, `qa_story.failed`, and `skill_pipeline.step.dispatched`. When these fire, it dispatches a Cursor Cloud Agent run instead of a standard outbound webhook — no `webhookUrl` is required.

For `skill_pipeline.step.dispatched`, Mushi dispatches to the Cursor Cloud Agent **even when the `cursor-cloud-agent` marketplace plugin is not installed** — credentials are read from **Integrations → Cursor Cloud** (`project_settings.cursor_api_key_ref`). This fan-out is *in addition to* any other plugin (Discord, Teams, custom webhook) subscribed to the same event.

See [Admin → Marketplace](/admin/marketplace) for installation and configuration.
