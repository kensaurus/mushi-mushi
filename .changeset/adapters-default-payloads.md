---
'@mushi-mushi/adapters': patch
---

The Honeycomb and New Relic adapters now read the payloads those tools send by default. Honeycomb's trigger webhook names the trigger `id` (not `trigger_id`). A New Relic workflow's default payload (`id`, `title`, `issueUrl`, `priority: "CRITICAL"`, `impactedEntities`, `alertConditionNames`, `alertPolicyNames`) used to produce a report titled only "New Relic incident" with no severity or link; it now carries the title, severity (CRITICAL / HIGH / MEDIUM / LOW), component, condition, policy and issue link. The older fields still work. Datadog, Honeycomb, New Relic and Grafana/Loki now have tests built on sample payloads.
