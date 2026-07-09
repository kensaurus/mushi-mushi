# Wave T — Production readiness sweep (2026-04-23)

Phase 5 of the Wave T plan. This doc captures (a) the provider-probe
PASS/FAIL matrix expected on a clean deploy, (b) the new wire-ups the
user explicitly asked us to recommend, and (c) the state of the
`publishConfig` / `engines.node >= 22` audit on the npm-shipped
packages.

> NOTE: The probe matrix below is written as the expected shape — the
> actual matrix is emitted by `GET /v1/admin/health/integrations/probe`
> at deploy time. Treat this doc as the source of truth for the
> interpretation, not the measurement.

## 1. Provider probe matrix

Every row targets a provider we depend on in production. The "owner"
column names the env-var that gates the probe (no key → `SKIP`, not
`FAIL`). A `FAIL` row blocks deploy; a `SKIP` row is informational.

| Provider     | Probe target                                          | Owner env                     | Expected | Criticality |
|--------------|-------------------------------------------------------|-------------------------------|----------|-------------|
| Anthropic    | `POST https://api.anthropic.com/v1/messages` (1 tok)  | `ANTHROPIC_API_KEY`           | PASS     | P0 — classify + judge primary path |
| OpenAI       | `GET  https://api.openai.com/v1/models`               | `OPENAI_API_KEY`              | PASS     | P0 — stage-1 + stage-2 fallback    |
| OpenRouter   | `GET  https://openrouter.ai/api/v1/models`            | `OPENROUTER_API_KEY`          | PASS     | P1 — cheap BYOK gateway            |
| GitHub       | `GET  https://api.github.com/rate_limit`              | `GITHUB_APP_ID/KEY`           | PASS     | P0 — fix-worker PR authoring       |
| Sentry       | `GET  https://sentry.io/api/0/`                       | `SENTRY_AUTH_TOKEN`           | PASS     | P0 — error triage + MCP            |
| Langfuse     | `GET  {LANGFUSE_BASE_URL}/api/public/health`          | `LANGFUSE_PUBLIC_KEY`         | PASS     | P1 — LLM observability             |
| Stripe       | `GET  https://api.stripe.com/v1/balance`              | `STRIPE_SECRET_KEY`           | PASS     | P1 — billing                       |
| Firecrawl    | `GET  https://api.firecrawl.dev/v1/health`            | `FIRECRAWL_API_KEY`           | PASS     | P2 — research                      |
| Linear       | `POST https://api.linear.app/graphql` (viewer query)  | `LINEAR_API_KEY`              | PASS     | P2 — plugin dispatch               |
| PagerDuty    | `GET  https://api.pagerduty.com/abilities`            | `PAGERDUTY_TOKEN`             | SKIP     | P3 — alerting, not wired yet       |
| Slack        | `POST via configured webhook`                         | per-project webhook URL       | PASS     | P1 — notifications                 |
| Jira         | `GET  /rest/api/3/myself`                             | `JIRA_API_TOKEN`              | SKIP     | P3 — not enabled today             |

If any `P0` row is FAIL on the pre-deploy matrix, do NOT ship —
pipeline will degrade to OpenAI-only (or worse). If a `P1` row is
FAIL, ship with a comms-out note but watch Sentry for the next 2
hours.

## 2. Recommended new wire-ups

The user explicitly asked for suggestions. Evaluated each against
current stack + maturity; ranked P1 / P2 / P3:

### P1 — worth doing next wave

- **Loops.so (or Resend)** — we already have a `reporter_notifications`
  table but no outbound SMTP transport. Loops has first-class
  React-Email templates + a generous free tier, sits cleanly behind a
  single edge function. Wave U work: add `packages/server/supabase/
  functions/reporter-notifications-send/index.ts` + one migration to
  bump `reporter_notifications.status` once the send succeeds.

- **Sentry Seer finish** — `sentry-seer-poll` is already wired for
  ingestion, but the fan-in that turns a Seer result into a Mushi
  report is only half-complete (see `SUMMARY.md` finding SEER-1).
  Closing the loop gives us a second high-quality ingest lane next to
  the browser SDK. Estimated: ~200 LOC in the poll function + one
  migration for a `report_source='sentry_seer'` enum value.

### P2 — do when scale demands it

- **Upstash Redis** — `scoped_rate_limits` currently uses Postgres
  advisory locks. Works fine up to ~500 rps; Upstash REST + short
  TTLs are cheaper and don't contend with OLTP under burst. Out of
  scope until we see Postgres CPU > 60 % sustained.

- **Vercel as alternate admin deploy target** — we ship admin SPA to
  S3 + CloudFront via `.github/workflows/deploy-admin.yml`. A Vercel
  mirror gives us a cut-over path for zero-downtime recovery if the
  CloudFront distribution ever has an origin issue. Cost: low;
  schedule: Wave V.

- **Datadog LLM Observability** — bigger enterprise footprint than
  Langfuse. If a customer asks for it (several have in sales calls),
  we can implement via the OpenTelemetry exporter already imported in
  `_shared/observability.ts`. Not proposed as a replacement for
  Langfuse — as a parallel exporter.

### P3 — park

- **ngrok / Cloudflare Tunnel** for local Supabase webhook dev is a
  developer-productivity win only. The dogfood env is on hosted
  Supabase so Stripe + GitHub webhooks already hit a real URL. Defer.

## 3. publishConfig / engines sweep

| Package                                 | `publishConfig.access` | `engines.node` | `files` | verdict |
|-----------------------------------------|-------------------------|----------------|---------|---------|
| `@mushi-mushi/core`                     | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/web`                      | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/react`                    | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/server`                   | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/agents`                   | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/verify`                   | `public`                | `>=22`         | ok      | PASS    |
| `@mushi-mushi/admin` (private)          | n/a                     | `>=22`         | n/a     | PASS    |

Run `pnpm check:publish-readiness` as the CI gate before `pnpm
release` in Phase 6 — the expected output is six `PASS` rows mirroring
the table above.

## 4. Known gaps not addressed in Wave T

The scope of Wave T is explicit about what is _not_ covered; including
here so reviewers can assess completeness of the release:

- 14-page PageHero retrofit (deferred to Wave U).
- Full IA collapse (24 → 11) behind `VITE_ADVANCED_IA_V2`; only the
  primitive + flag were landed in Wave T.
- New `GET /v1/admin/inbox` edge route (Wave T reuses
  `/v1/admin/dashboard`; standalone endpoint deferred).
- Judge-batch cache telemetry (Wave T fixed fast-filter only; judge
  writes to `classification_evaluations` which lacks cache columns).
