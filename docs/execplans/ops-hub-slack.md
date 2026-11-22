# ExecPlan: Ops hub, with Mushi Mushi as the integrator for app notifications and the team's Slack

Owner request, 2026-11-17:
> "make full use of mushi as the integrator and the centralized console … proper configuration and
> the full implementation". Also: "rename to kensaurus no caps. add proper graphics and replies and
> helpful commands too please."

## Why
Today each app posts straight to a Slack Incoming Webhook (#payments, #releases, #alerts) and to
Discord. Incoming webhooks cannot thread, update their own messages, take button clicks or answer
commands, because they return no message `ts` (docs.slack.dev, "Sending messages using incoming
webhooks", read 2026-11-17). Nothing shows what happened across all the apps in one place, and
nothing shows which app is not reporting.

## What gets built
Mushi Mushi becomes the hub.
1. **Apps** send one event to Mushi Mushi.
2. **Mushi Mushi** stores it, shows it in a new console page and posts it to Slack with the team's own
   bot. The bot gives threaded follow-ups, buttons and `/kensaurus`-style commands.
3. **Commands** are answered from data Mushi Mushi already has: events, bug reports, CI and spend.

This is a product feature, not owner-only code. Any team can connect its own Slack bot and pick
the command name. The owner's bot is called `kensaurus`.

### 1. Data (one migration, additive)
- **`ops_events`.** Columns:
  - `id uuid pk`, `organization_id uuid`, `project_id uuid null`
  - `category text check (payments|releases|alerts)`
  - `severity text check (info|warn|urgent|resolved)`
  - `kind text`, a short machine name such as `payment.succeeded`, `deploy.failed` or `refund.failed`
  - `title text`, the plain headline without the app name
  - `body text`, `facts jsonb` (array of `{label,value}`), `url text`
  - `amount_minor bigint null`, `currency text null`
  - `thread_key text null`, `dedupe_key text null`
  - `occurred_at timestamptz`, `source text` (`app` | `github` | `sentry` | `uptime` | `mushi`)
  - `slack_channel text`, `slack_ts text`, `slack_thread_ts text`, `slack_error text`
  - `acked_by text`, `acked_at timestamptz`, `created_at`

  Indexes:
  - `unique (organization_id, project_id, dedupe_key) nulls not distinct where dedupe_key is not null`, so a retried webhook posts once and two apps never dedupe into each other (per app since 2026-11-18; it was per organization, which dropped every app's `sales.daily:<date>` but the first);
  - `(organization_id, occurred_at desc)`;
  - `(organization_id, thread_key)`;
  - `(project_id, category, occurred_at desc)`.
- **`ops_slack_settings`.** One row per organization. Columns:
  - `organization_id pk`, `enabled bool`, `team_id text`, `bot_user_id text`
  - `bot_token_secret_id uuid` (Vault), `signing_secret_id uuid` (Vault)
  - `channel_payments text`, `channel_releases text`, `channel_alerts text` (channel ids)
  - `command text default '/mushi-ops'`
  - `icon_base_url text null`, `updated_at`
- **`ops_mutes`.** Columns: `organization_id`, `project_id`, `until timestamptz`, `muted_by text`, `pk (organization_id, project_id)`.
- **RLS.** Org members read `ops_events` and `ops_mutes`. Only service role writes. Owners and admins
  change settings through the API. Settings never return secret values, only "set / not set".
- **Vault.** Use `vault_store_secret` and `vault_get_secret`, the same pattern as byok.

### 2. API (api edge function, new route file `api/routes/ops.ts`)
- **`POST /v1/ops/events`.** Takes a project API key with the NEW scope `ops:write`.
  - The key is server-side only. Refuse it from a browser `Origin`, like MCP keys.
  - Validate with zod. Title ≤ 150, body ≤ 600, ≤ 8 facts, url https only, amount optional.
  - Insert, honouring the dedupe key. Run the mute check.
  - Then deliver to Slack via `waitUntil`, so the caller gets 202 fast.
  - Rate-limit per project with the existing scoped rate limiter. Never fail open.
- **Org routes** (`jwtAuth`):
  - `GET /v1/admin/ops/events?org=&project=&category=&severity=&before=`: the feed, paginated.
  - `POST /v1/admin/ops/events/:id/ack`
  - `GET /v1/admin/ops/coverage?org=`: per app and category, the last event time and count over 7 days. It answers "which app is silent".
  - `GET` and `PUT /v1/admin/ops/slack-settings?org=`: owners and admins only for PUT. Secrets go into Vault; the response gives booleans.
  - `POST /v1/admin/ops/slack-settings/test?org=`: posts one test message per channel and returns each result.
  - `POST /v1/admin/projects/:id/ops-key`: mints an `ops:write` key, shown once. It reuses the existing key-minting helper and keeps the label `ops:<project-slug>`.
- **Slack endpoints** (public; verify the signature with the org's signing secret, found by `team_id`):
  - **`POST /v1/ops/slack/commands`.** Slash command with subcommands:
    - `help`
    - `status`: each app's last release, open alerts, open bug reports and today's CI failures
    - `sales [today|week|month]`: the sum of `payments` events by app and currency, refunds subtracted
    - `releases [n]`
    - `alerts`: open, not acknowledged
    - `bugs`: newest Mushi Mushi reports per app, with links to the console
    - `ci`: from the CI overview
    - `apps`
    - `mute <app> <2h|1d>` and `unmute <app>`

    Answer within 3 s with an ephemeral Block Kit message. Anything slower goes through `response_url`.
  - **`POST /v1/ops/slack/interactions`.** Buttons:
    - **Acknowledge**: set `acked_*`, add a ✅ reaction and a thread reply "Seen by @user".
    - **Mute this alert for 24 h** (the alert's ⋯ menu, or a lone `Mute 24h` button): an `ops_mutes` row scoped to that alert's category, kind and fingerprint (`scope`, 20261120090000), and a thread reply. Never the whole app, never payments or releases (2026-11-20). `mute <app>` writes the empty scope: the whole app.
    - **Open in Mushi Mushi**: a link.
    - `slack-interactions` forwards any `ops_*` action here, body and signature untouched (`_shared/slack-action-route.ts`).

    Use the existing `_shared/slack-verify.ts`. Reject timestamps older than 5 minutes. Read the raw body before parsing.

### 3. Slack delivery (`_shared/ops-slack.ts`)
- **Bot token.** Use `chat.postMessage` with the org's bot token from Vault. Store the returned `ts` on the event.
- **Layout** (one format for every kind, 2026-11-20; Block Kit only, never legacy attachments).
  - `text` (notification and fallback): `<emoji> <app>: <title>`, plus ` (<environment>)` for an alert whose sender stated it.
  - Context: the app's icon, then `app · Category · environment · time` (`<!date^…>`). The environment only when an `Environment` fact states it; never assumed.
  - Header (plain_text): `<emoji> <title>`, the title once. A sender's leading mark ("🚀 …") is not doubled.
  - Section: the body (mrkdwn, escaped).
  - Section fields: up to 4 facts (the amount first); the rest on one context line.
  - Actions, at most 3: an open alert gets Acknowledge, Open and a ⋯ menu (Open in Mushi Mushi, Mute this alert for 24 h); a release, a payment or a resolve gets Open and Open in Mushi Mushi. A menu with one item is a plain button (Slack needs two options).
  - Emoji: 💳 payment, ↩️ refund, ⚠️ warn, 🔴 urgent, 🚀 release, ✅ resolved.
- **Threads.** If an earlier event of the same app has the same `thread_key` and its root is from the last 24 h, post as a reply (`thread_ts`). An alert with no `thread_key` gets `fp:<kind>:<title>`. A release is always its own message.
  - A `resolved` event replies in the thread (no broadcast) and edits the parent with `chat.update`, however old: the mark becomes ✅ and a "✅ Resolved: <title> · <time>" line goes under the title.
  - Example thread keys:
    - `deploy:<repo>:<env>`: a failed deploy, then the next good one
    - `invoice:<id>`: payment failed, then recovered
    - `sentry:<issue>`
- **Rate limits.** About 1 message per second per channel (docs.slack.dev, chat.postMessage, read 2026-11-17). On HTTP 429, retry once after `Retry-After`, then record `slack_error`.
- **Fallback.** With no bot token, post to the category's incoming webhook URL if one is configured (a third Vault ref per category is allowed), else store only.
- **Never block.** A Slack failure never fails the ingest.
- **Muted apps.** Store the event and skip Slack until `until`.
- **Privacy.** No email beyond its domain, and no personal names. Reject any `facts`/`body` that matches an email or phone pattern with 422 `PII_REJECTED`.

### 4. Mushi Mushi's own sources, so apps don't need code for these
- **Production deploys.** Any app with a GitHub repo connected already has CI data (`ci_jobs`, GitHub deployments).
  - On a completed production deploy or deployment status, create a `releases` event, or an `alerts` event on failure.
  - Thread key: `deploy:<repo>:production`.
  - Hook in where the CI collector already records jobs; use deployments where `environment = production`.
  - Dedupe on the run id.
- **Sentry.** Where Mushi Mushi already receives or polls Sentry issues, post new production issues with level error or above and regressions to `alerts`. Thread key: `sentry:<issue>`. Dedupe on issue id plus the event's first seen time.
- **Uptime.** Where the synthetic monitor or Production Check already probes a site, post a down transition to `alerts` (urgent) and an up transition as `resolved` in the same thread. Thread key: `uptime:<url>`.
- Each source runs only for organizations with `ops_slack_settings.enabled`.

### 5. Console
- **New page `/ops` ("Ops")** in the main nav, near CI runners. Same design system: light, high contrast, worst first.
  - **Header strip.** Counts for today: payments (sum per currency), releases, open alerts.
  - **Coverage matrix.** One row per app, columns payments / releases / alerts / bugs: when it last reported, as a heat cell. Grey hatched "never" with a "How to connect" link. This is the "is everything connected" view.
  - **Feed.**
    - Filters: app, category, severity, unacknowledged.
    - Rows: icon, app, title, body, facts, time, and Slack status ✓ / ✕ with the error on hover.
    - Acknowledge button. Thread replies are nested under their parent.
- **Settings → "Slack bot"** card, owners only.
  - Inputs: bot token and signing secret (write-only), the three channel ids (with a "post a test" button each) and the command name.
  - Shows the Request URLs to paste into Slack, with copy buttons.
  - Status pill.
- **Projects → "Ops key"** row: mint the server key for that app, shown once, with a copy-ready snippet for a Supabase secret and a GitHub secret.

### 6. Docs and tests
- **Docs.** New page `apps/docs/content/integrations/ops-hub.mdx`, plus the `AGENTS.md` inventory row and the route manifest (`pnpm gen:route-manifest`).
- **Tests.**
  - Payload builder.
  - Thread and resolve logic.
  - PII guard.
  - Dedupe.
  - Signature verification with a fixture.
  - Command parsing and answers, with stubbed data.
  - `ops:write` scope enforcement, including browser-origin refusal.
  - Coverage query.
  - Console page smoke test, and a `CiPage`-style test for the feed.

## Owner configuration (done outside this PR, recorded here)
- Slack app A0CJ8CWBP5K: renamed to `kensaurus` (bot display name `kensaurus`), with the pixel T-Rex icon.
- Bot scopes: `chat:write`, `chat:write.public`, `commands`, `reactions:write`, `incoming-webhook`.
- Slash command `/kensaurus` → `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/ops/slack/commands`.
- Interactivity → `…/api/v1/ops/slack/interactions`.
- Channels: #payments C0CHY97KJLF, #releases C0CHY989423, #alerts C0CJBMBUT0E.
- Free plan: 2 of 10 apps used. 90-day visible history, so Mushi Mushi is the record and Slack is the alert.

## Rollout
1. Merge this PR. That applies the migration (additive, before the api deploy) and deploys api.
2. Save the bot token and signing secret in Settings, and run the tests.
3. Mint ops keys per app and set `MUSHI_OPS_KEY` and `MUSHI_API_URL` in each app's runtime.
4. Switch each app's sender to `POST /v1/ops/events`. Keep Discord. Keep the direct webhook only as a fallback when Mushi Mushi answers non-2xx.
5. Remove the per-repo release webhook steps once Mushi Mushi's own deploy source covers that repo.
