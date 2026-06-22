# Mushi for operators & platform teams

> **This is Bucket C.** Running Mushi for a team, wiring it into an existing
> monitoring stack, or evaluating it as a platform? This is your section. The
> README leads with the wedge — a solo builder understanding and fixing one bug,
> standalone, no Sentry required (see [`/VISION.md`](../../VISION.md)). The
> operator-grade depth lives here so the front door stays uncluttered. None of it
> was removed from the product — only re-shelved.

## Contents

- [Inventory, gates & spec traceability](./inventory-and-gates.md) — the v2
  "Team graduation" layer: declarative `inventory.yaml`, five pre-release gates,
  the synthetic monitor, and end-to-end spec traceability.
- [Operator-grade plumbing](#operator-grade-plumbing) — the open standards
  (W3C traceparent, OTLP, Standard Webhooks, A2A, MCP) that let your existing
  tools talk through one console.
- [Where Mushi fits with Sentry / Datadog / Firebase](#where-mushi-fits) — the
  enrichment / synthesis story, for teams that already run a monitoring stack.
- [Multi-platform console](#multi-platform-console) — filtering and device/build
  panels across iOS, Android, Web, and React Native.
- Self-host at scale: [`SELF_HOSTED.md`](../../SELF_HOSTED.md) and the Helm chart
  at [`deploy/helm/`](../../deploy/helm/README.md).

## Operator-grade plumbing

Mushi is the _intermediary_. We deliberately avoid replicating Sentry / Datadog /
Firebase — instead we ship the boring-but-essential standards that let those
tools talk to each other through one console, with one audit trail, and one
consistent agent-facing API.

| Standard | Where it shows up | Why you care |
| -------- | ----------------- | ------------ |
| **W3C `traceparent`** | SDK → `api` → `fix-worker` → outbound webhooks → MCP. Every hop emits and propagates the spec-compliant header. | Your existing Datadog / Honeycomb / Tempo trace can follow a user-felt bug from the widget tap all the way through the draft PR — no proprietary "Mushi-Trace-Id". |
| **OTLP/HTTP+JSON exporter (BYOK)** | Edge functions ship spans straight to your collector when `OTLP_EXPORTER_URL` is set. | Zero markup, zero lock-in. Mushi never charges per span — you point it at your own collector and pay your APM vendor directly. |
| **Standard Webhooks** ([standardwebhooks.com](https://www.standardwebhooks.com/)) | Every outbound delivery includes `webhook-id` / `webhook-timestamp` / `webhook-signature: v1,<hmac>`. | Receivers can use any off-the-shelf Standard Webhooks library to verify signatures. |
| **Idempotency-Key** | Every mutating `/v1/admin/*` endpoint accepts `Idempotency-Key`. Replays return the cached response keyed by `(user_id, key)`. | Safe retries from flaky CI / mobile networks; tenant-scoped. |
| **OAuth 2.0 RFC 7591 Dynamic Client Registration** | `POST /v1/admin/auth/register` issues a scoped API key for an orchestrator to self-onboard, audit-logged as `api_key.created`. | LangGraph / CrewAI / OpenAI Agents SDK can register themselves without a human in the loop. |
| **Last-Event-Id SSE replay** | `GET /v1/a2a/tasks/:id:subscribe` and AG-UI streams honor `Last-Event-ID` to replay missed events. | A flaky orchestrator network never silently drops a task transition. |
| **A2A v1.0.0 PushNotificationConfig** | `POST /v1/a2a/tasks` accepts `configuration.pushNotificationConfig = { url, token? }`. A Postgres trigger fans out signed POSTs on every state change to `a2a-push-notify`. | Pull (SSE) _and_ push are both supported. |
| **Integration Health Probe** | `pg_cron` calls every BYOK integration every 15 minutes; `GET /v1/admin/integrations/health` and the admin page surface status chips. | You catch a rotated Anthropic key or a broken Slack bot token before users do. |
| **Closed-loop plugin dispatch** | `fix-worker` fires `fix.proposed` on draft PR; the GitHub merge webhook fires `fix.applied` exactly once per merge (idempotent via `is(merged_at, null)`). | The Sentry issue auto-resolves the moment Mushi merges its fix; Jira / Linear / Bugsnag / Rollbar / Crashlytics transition through the same event stream. |
| **Regression auto-triage** | When the status reconciler flips an action `verified` → `regressed`, it pages the operator (Slack/Discord), opens a triage report, and fans `report.created` to plugins. | A regressed action funnels back through the same PDCA loop as a real user report. |
| **Webhook delivery exhaustion alerts** | After 5 retries (30s + 2m + 10m + 1h + 6h backoff) `plugin-dispatch-retry` pages the operator with the dead webhook + last error, deduped per `(project, plugin)`. | A plugin with a rotated token announces itself in chat instead of silently dropping notifications. |
| **OpenTelemetry GenAI semconv** | OTLP spans for `classify-report` carry `gen_ai.*` attributes plus a custom `gen_ai.usage.cost_usd`. | Your APM graphs cost-per-report and tokens-per-model with no Mushi-specific dashboard. |
| **MCP Streamable HTTP** (2025-03-26) | `/functions/v1/mcp`. Both stdio (local IDE) and HTTP (remote orchestrator) transports advertise the same tool catalog. | One MCP server, two transports, every modern AI client supported. |
| **Agent Card + OpenAPI 3.1 + JSON Schemas** | `/.well-known/agent-card`, `/openapi.json`, `/v1/schemas/*`. | Your orchestrator discovers Mushi the way it discovers anything else. |

> **BYOK throughout.** Mushi never holds your Anthropic / OpenAI / Sentry / Slack
> / Jira keys for billing leverage. Bring your own; rotate them in your own
> dashboard. The Integration Health Probe tells us (and you) the moment something
> rotated out from under us.

## Where Mushi fits

If you already run Sentry, Datadog, or Firebase, Mushi adds the one signal they
miss — **user-felt friction** — and ingests the others so a single classified bug
row can carry everything at once: the stack trace from Crashlytics, the latency
spike from Datadog, the funnel drop from Firebase, AND the user's screenshot and
note. This is the **enrichment / upgrade path**, not the front door.

| Signal | Typical tools | What they miss |
| ------ | ------------- | -------------- |
| Code-thrown errors | Sentry, Crashlytics, Bugsnag, Rollbar | Bugs that don't throw — dead buttons, janky scroll, 12-second screens |
| System telemetry | Datadog, New Relic, Honeycomb, Grafana | The user's perspective on what that latency spike felt like |
| Product analytics | Firebase Analytics, PostHog, Amplitude | _Why_ a funnel step was abandoned, in the user's own words |
| **User-felt friction** | **nothing → Mushi** | — |

### Compared to each tool you already have

| | Sentry / Crashlytics | Datadog / New Relic | Firebase / Amplitude | **Mushi Mushi** |
| --- | :-- | :-- | :-- | :-- |
| **Signal origin** | Code throws | Infrastructure metrics | User event streams | User-felt friction, captured in the moment |
| **What lands in your queue** | Stack trace | Alert threshold breach | Funnel drop-off | User note + screenshot + device context |
| **Repeat signal** | Same error = separate issue | Spike repeats → new alert | Conversion drops again | Same broken button collapses to one row |
| **Closing the loop** | Assign a ticket | Write a runbook | A/B test the conversion | Optional draft PR you merge, edit, or close |
| **From your IDE** | Paste issue ID into Cursor | — | — | Cursor reads the report and proposes the diff |
| **Where it runs** | Their cloud | Their cloud | Google cloud | Yours, ours, or both |

Mushi is wired to send signals **back** to the tools you run — 13 outbound
plugins (Sentry, Slack, Jira, Linear, PagerDuty, Discord, Microsoft Teams, GitHub
Issues, Bugsnag, Rollbar, Crashlytics, Zapier, Cursor Cloud) — and to **receive**
alerts from 11 inbound sources (Sentry, Datadog, Bugsnag, Rollbar, Crashlytics,
New Relic, Honeycomb, Grafana Loki, AWS CloudWatch, Opsgenie, Firebase Analytics)
via [`@mushi-mushi/adapters`](../../packages/adapters).

## Multi-platform console

- **Filtering** — the Reports list (`/reports`) has **Platform** (iOS, Android,
  Web, macOS, Windows) and **SDK** (`@mushi-mushi/react`, `…/react-native`, etc.)
  dropdowns; selecting a value appends `?platform=ios` / `?sdk_package=…` for
  shareability.
- **Device & Build panel** — each report detail shows `platform`, `sdk_package`,
  `sdk_version`, and `app_version`.
- **Platform Health · 24h tile** — report volume, error counts, and SDK versions
  per platform, sourced from the `qa_platform_rollup_24h` materialized view
  (refreshed hourly). Click a row to drill into `/reports?platform=<platform>`.

## Advanced SDK launcher modes

The SDK ships several ways to surface the reporter — header banner (recommended),
floating stamp (FAB), edge tab, attach-to-your-button, and headless/manual. The
full configuration (including the rich banner layout and the headless
`MushiTrigger` / `MushiAttach` primitives) is documented in
[`packages/web`](../../packages/web) and previewable live in the admin console
under **Connect & Update → SDK Install → Launcher**.
