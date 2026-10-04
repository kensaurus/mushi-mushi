# Mushi Mushi · Configuration reference

> Auto-generated from [`apps/admin/src/lib/configDocs.ts`](../apps/admin/src/lib/configDocs.ts).
> Do not edit by hand — run `pnpm gen:config-docs` instead.

_113 configuration knobs across 19 sections · last regenerated 2026-10-04._

Every knob in the admin console has an in-app `i` icon next to it that opens a longer-form explanation. The same content is mirrored here so you can search, link, and review configuration choices outside the app.

## Contents

- [Settings → General](#settings-general) (10)
- [Settings → BYOK (LLM keys)](#settings-byok-llm-keys-) (3)
- [Settings → Firecrawl (web research)](#settings-firecrawl-web-research-) (3)
- [Settings → Dev tools](#settings-dev-tools) (1)
- [Projects](#projects) (8)
- [Integrations](#integrations) (28)
- [Storage (BYO)](#storage-byo-) (9)
- [Compliance](#compliance) (7)
- [SSO](#sso) (4)
- [Prompt Lab](#prompt-lab) (4)
- [Marketplace plugins](#marketplace-plugins) (3)
- [Anti-gaming](#anti-gaming) (3)
- [Notifications](#notifications) (2)
- [Intelligence](#intelligence) (1)
- [Billing](#billing) (6)
- [Onboarding](#onboarding) (2)
- [MCP install](#mcp-install) (1)
- [SDK install card](#sdk-install-card) (13)
- [Settings → Page-aware assistant](#settings-page-aware-assistant) (5)

## Settings → General

<a id="settings-general"></a>

### Slack Channel ID

<a id="settings-general-slack-channel-id"></a>

`settings.general.slack_channel_id`

**Summary** — Optional Slack channel ID (e.g. C01234ABCDE) for direct @mention routing alongside the webhook.

**How it works** — The classify-report and fast-filter edge functions read this channel ID and pass it to chat.postMessage (bot token path) so notifications land in your chosen channel. The Slack bot must be invited to the channel first (/invite @mushi in Slack). Pairs with the bot token (SLACK_BOT_TOKEN env secret) — set both for threaded replies when you dispatch a fix from Slack.

**Default** — `unset`

**Where it lives** — table `project_settings.slack_channel_id` · endpoint `PATCH /v1/admin/settings` · read by `classify-report edge function`, `fast-filter edge function`, `slack-interactions edge function`

**When to change** — Set to your Slack channel ID (e.g. C0B82A322RW — found in channel Details) whenever you want new report notifications delivered there. Use "Send test" in General Settings to verify.

### Slack Webhook URL

<a id="settings-general-slack-webhook-url"></a>

`settings.general.slack_webhook_url`

**Summary** — Posts new high-severity reports and weekly digests to this Slack webhook.

**How it works** — When a report is classified at high severity or above (or via the weekly summary cron), Mushi sends a formatted Slack message to this URL. Leave blank to disable Slack delivery without affecting in-app notifications.

**Default** — `unset (Slack disabled)`

**Where it lives** — table `project_settings.slack_webhook_url` · endpoint `PATCH /v1/admin/settings` · read by `classify-report edge function`, `judge-batch edge function`, `slack-interactions edge function`

**When to change** — Set this on day 1 if your team reviews bugs from Slack. Rotate it whenever the channel owner changes — webhooks don't expire, so a stale URL keeps posting until you replace it.

### Sentry DSN

<a id="settings-general-sentry-dsn"></a>

`settings.general.sentry_dsn`

**Summary** — Your app’s Sentry DSN, saved so Mushi knows this project reports crashes to Sentry.

**How it works** — Validated on save (a sentry.io host, or a self-hosted host the operator allows). Mushi does not send events to this DSN: it only reads it as a sign that Sentry is connected, on the Settings page, the portfolio view and the app recipe. Issue import, enrichment and resolve-on-merge use the org slug and auth token on the Sentry card instead.

**Default** — `unset`

**Where it lives** — table `project_settings.sentry_dsn` · endpoint `PATCH /v1/admin/settings` · read by `api edge function (GET /v1/admin/settings, portfolio and app recipe: "Sentry connected")`, `_shared/recipe-phase2.ts (crash-reporting check)`

**When to change** — Set it when your app sends crashes to Sentry, so the portfolio and app recipe show Sentry as connected. Leave it empty if you don’t use Sentry; inbound Sentry webhooks need the webhook secret, not this.

### Sentry Webhook Secret

<a id="settings-general-sentry-webhook-secret"></a>

`settings.general.sentry_webhook_secret`

**Summary** — Client Secret of the Sentry internal integration that sends issue, alert and user-feedback webhooks to Mushi.

**How it works** — Stored in Vault. The Sentry webhook handler verifies the `Sentry-Hook-Signature` HMAC against this secret, requires a `Sentry-Hook-Timestamp` within 5 minutes, and rejects a `Request-ID` or body it already accepted. Mismatch → 401, the delivery is dropped. Copy it from Sentry → Settings → Developer Settings → your internal integration → Client Secret.

**Default** — `unset (inbound disabled)`

**Where it lives** — table `project_settings.sentry_webhook_secret (Vault)` · endpoint `PATCH /v1/admin/settings` · read by `POST /v1/webhooks/sentry (api route)`, `POST /v1/webhooks/sentry/seer (api route)`

**When to change** — Set this once when wiring inbound Sentry user feedback. Rotate it together with the Sentry-side value — never one without the other or every payload starts failing signature verification.

### Consume Sentry User Feedback

<a id="settings-general-sentry-consume-user-feedback"></a>

`settings.general.sentry_consume_user_feedback`

**Summary** — When enabled, Sentry user-feedback submissions are mirrored into the Mushi report queue.

**How it works** — Drives the inbound webhook handler. With the toggle on, every Sentry user-feedback event creates a fresh report (deduplicated by Sentry event id). With it off, payloads are acknowledged but ignored — useful when you want webhook signing wired without yet doubling your queue volume.

**Default** — `true`

**Where it lives** — table `project_settings.sentry_consume_user_feedback` · endpoint `PATCH /v1/admin/settings` · read by `POST /v1/webhooks/sentry (api route)`

**When to change** — Turn off temporarily when piloting Sentry on a noisy public app — re-enable once you're happy with the volume and your routing rules are in place.

### Classification model

<a id="settings-general-stage2-model"></a>

`settings.general.stage2_model`

**Summary** — Which LLM writes the plain-English read on each report after noise is filtered out.

**How it works** — Stage 2 is the deep classifier — it labels severity, category, intent, dedup hints, and reproduction steps. The choice trades cost vs depth: Sonnet 5.5 is the recommended default; Opus is slow but catches subtle cases; Haiku is cheap but rougher. The selected model is read on every report, so changes apply immediately to new traffic.

**Default** — `claude-sonnet-5-5`

**Where it lives** — table `project_settings.stage2_model` · endpoint `PATCH /v1/admin/settings` · read by `classify-report edge function`

**When to change** — Stay on Sonnet 5.5 unless cost is biting (drop to Haiku) or you're finding misses on subtle pattern reports (try Opus on a small slice via Prompt Lab first).

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Noise filter confidence

<a id="settings-general-stage1-confidence-threshold"></a>

`settings.general.stage1_confidence_threshold`

**Summary** — How confident Mushi must be that a report is spam or test noise before dropping it.

**How it works** — Every inbound report runs through Stage 1 (Haiku 4.5). If the model says "this is spam/test/noise" with confidence ≥ this threshold, the report is dropped before Stage 2 spends tokens on it. Higher = more strict (more reports survive to Stage 2, fewer false drops); lower = more aggressive culling (cheaper, slightly more false drops).

**Default** — `0.85` · range `0.50 – 0.99`

**Where it lives** — table `project_settings.stage1_confidence_threshold` · endpoint `PATCH /v1/admin/settings` · read by `fast-filter edge function`

**When to change** — Raise to 0.90+ if you suspect Stage 1 is dropping real reports (check Anti-Gaming for "fast-filter rejected" with low confidence margins). Lower to ~0.70 if a public-facing form is flooding the queue with obvious noise.

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Dedup Similarity Threshold

<a id="settings-general-dedup-threshold"></a>

`settings.general.dedup_threshold`

**Summary** — Cosine similarity above which two reports are merged as duplicates instead of stored separately.

**How it works** — After a report is embedded, a pgvector lookup finds the nearest existing report by embedding distance. If similarity ≥ the threshold, the new report is attached to the existing cluster (its `dup_of` points at the canonical id and the cluster's occurrence count ticks up). Below it, the report stays separate. Today the grouping step (fast-filter → `suggestGrouping`) always uses the built-in 0.82: the value saved here is stored but not read yet.

**Default** — `0.82` · range `0.50 – 0.99`

**Where it lives** — table `project_settings.dedup_threshold` · endpoint `PATCH /v1/admin/settings`

**When to change** — Changing it has no effect yet (see above). Once grouping reads it: raise to 0.88+ if you're seeing false merges (different bugs being lumped together), lower to ~0.75 if the same regression keeps appearing as separate reports.

### Fix Branch Template

<a id="settings-general-fix-branch-template"></a>

`settings.general.fix_branch_template`

**Summary** — Branch name pattern when Mushi opens a draft fix PR on GitHub.

**How it works** — When auto-fix opens a PR, it names the branch from this pattern. Every name must look like `<type>/MUSHI-<reportId>-<words>`: a type (`bugfix/`, `feature/`, `hotfix/`, `refactor/`, `chore/`, `docs/`, `test/` or `ci/`), then `MUSHI-{reportId}-`, then lowercase words. After that you can use `{category}` (the report category), `{date}` (`YYYY-MM-DD`, UTC) and `{shortId}` (the first 8 characters of the report id). Leave it empty to use `bugfix/MUSHI-<reportId>-<summary words>`.

**Default** — `bugfix/MUSHI-{reportId}-{category}`

**Where it lives** — table `project_settings.fix_branch_template` · endpoint `PATCH /v1/admin/settings` · read by `fix-worker edge function`

**When to change** — Change the type or the words after `MUSHI-{reportId}-` to match your team’s convention (e.g. `hotfix/MUSHI-{reportId}-{date}`). The `MUSHI-{reportId}-` part is required: it keeps each branch unique and links the PR back to its report.

### Supabase project ref

<a id="settings-general-supabase-project-ref"></a>

`settings.general.supabase_project_ref`

**Summary** — Links this Mushi project to your app’s Supabase project so diagnoses can read its schema, advisors, edge functions and logs.

**How it works** — The ref is the 20-character id in `https://<ref>.supabase.co`. Mushi reads that one project with the Supabase access token you add under Settings → AI keys → Supabase, in read-only mode and with SELECT queries only. The token is checked against this ref, so save the ref first. Clearing the ref unlinks the project; the token stays in Vault until you remove it.

**Default** — `Not linked`

**Where it lives** — table `project_settings.supabase_project_ref` · endpoint `PATCH /v1/admin/settings` · read by `backend-drift-scanner`, `api (recipe, backend, db-advisors, fullstack-audit)`, `integration-health-probe`

**When to change** — Set it once when your app runs on Supabase. Create a scoped access token for this one project only, with Database, Edge Functions, Advisors and Logs set to Read, and give it an expiry. Change the ref only if the app moves to another Supabase project.

## Settings → BYOK (LLM keys)

<a id="settings-byok-llm-keys-"></a>

### Anthropic (Claude) API Key

<a id="settings-byok-anthropic-key"></a>

`settings.byok.anthropic_key`

**Summary** — Your Anthropic key — used to read bugs in plain English and draft fixes. Stored encrypted; only a vault reference is saved in settings.

**How it works** — When set, bug reading and fix drafting bill your Anthropic account instead of platform credits. The key is stored encrypted in Supabase Vault — rotation is instant. When unset, Mushi falls back to the platform default (if your plan includes one). Powers fast-filter, classify-report, and fix-worker.

**Default** — `unset (uses platform default)`

**Where it lives** — table `project_settings.byok_anthropic_key_ref (Vault)` · endpoint `PUT /v1/admin/byok/anthropic` · read by `fast-filter`, `classify-report`, `fix-worker edge functions`

**When to change** — Set on day 1 if your plan is BYOK-only. Rotate when an engineer with key access leaves, or when Anthropic's usage console shows unfamiliar traffic.

**Learn more** — [Self-hosting & BYOK setup](https://kensaur.us/mushi-mushi/docs/self-hosting)

### OpenAI / OpenRouter API Key

<a id="settings-byok-openai-key"></a>

`settings.byok.openai_key`

**Summary** — Your OpenAI-compatible key — backup when Anthropic is down, and for judge scoring. Works with OpenRouter and other gateways via Base URL.

**How it works** — Used as automatic failover when Anthropic returns 5xx, and as the judge fallback in the autofix loop. Pair with the Base URL preset chips below to route the same key through any OpenAI-compatible gateway without code changes.

**Default** — `unset (failover disabled)`

**Where it lives** — table `project_settings.byok_openai_key_ref (Vault)` · endpoint `PUT /v1/admin/byok/openai` · read by `fast-filter`, `classify-report`, `judge-batch edge function`

**When to change** — Add this once Anthropic outages start showing up in your error budget — the failover silently kicks in only when this is configured.

### OpenAI Base URL

<a id="settings-byok-openai-base-url"></a>

`settings.byok.openai_base_url`

**Summary** — Override the OpenAI endpoint to route the same key through OpenRouter, Together, Fireworks, or any compatible gateway.

**How it works** — The OpenAI client honours this URL for every request. Leave blank to hit `api.openai.com`. The preset chips below populate common gateways so you don't have to remember the exact path.

**Default** — `empty (api.openai.com)`

**Where it lives** — table `project_settings.byok_openai_base_url` · endpoint `PUT /v1/admin/byok/openai` · read by `classify-report edge function`

**When to change** — Switch to OpenRouter when you want to A/B different models (Llama, Mixtral, Gemini) under one key. Switch back to blank when troubleshooting — eliminates the gateway as a variable.

## Settings → Firecrawl (web research)

<a id="settings-firecrawl-web-research-"></a>

### Firecrawl API Key

<a id="settings-firecrawl-api-key"></a>

`settings.firecrawl.api_key`

**Summary** — Your Firecrawl key — lets Mushi look up docs and release notes while reviewing a bug or drafting a fix.

**How it works** — When set, Research can crawl URLs during review; auto-fix pulls web snippets when local context is thin; a weekly cron checks dependency release notes. Stored encrypted in Vault. Leave unset to skip web research entirely.

**Default** — `unset (web research disabled)`

**Where it lives** — table `project_settings.byok_firecrawl_key_ref (Vault)` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `api edge function (POST /v1/admin/research/search, via _shared/firecrawl.ts)`, `fix-worker edge function`, `library-modernizer edge function`

**When to change** — Add this once you start seeing autofix attempts hit a wall on "library X changed its API". Skip it for offline-first projects or fully air-gapped deployments.

### Firecrawl Allowed Domains

<a id="settings-firecrawl-allowed-domains"></a>

`settings.firecrawl.allowed_domains`

**Summary** — Domain allowlist that bounds which hosts Firecrawl can scrape on your behalf.

**How it works** — One host per line (up to 50). Searches add a `site:` filter for every entry. Page scrapes (the release-notes check) only fetch a URL whose host is an entry or a subdomain of one. An empty list leaves searches unrestricted, but in production it blocks every scrape.

**Default** — `empty (searches unrestricted; scrapes blocked in production)`

**Where it lives** — table `project_settings.firecrawl_allowed_domains` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `_shared/firecrawl.ts (api Research search, fix-worker, library-modernizer)`, `fix-worker edge function`, `library-modernizer edge function`

**When to change** — Lock this down to your stack's docs (`react.dev`, `nextjs.org`, `developer.mozilla.org`, etc.) when compliance demands provenance for any external content the LLM sees. Leave empty for open exploration during early adoption.

### Firecrawl Max Pages per Call

<a id="settings-firecrawl-max-pages-per-call"></a>

`settings.firecrawl.max_pages_per_call`

**Summary** — Hard cap on results a single Firecrawl search can return — prevents one bad request from draining your quota.

**How it works** — Every search through `firecrawlSearch` asks Firecrawl for at most this many results, whatever the calling code requests. The server clamps the value to 1–50 (the database enforces the same range); the console input stops at 20. Caps stack: this is the per-call ceiling, on top of any per-day quota set by Firecrawl.

**Default** — `5` · range `1 – 50 (console input: 1 – 20)`

**Where it lives** — table `project_settings.firecrawl_max_pages_per_call` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `_shared/firecrawl.ts firecrawlSearch (api Research search, fix-worker)`, `fix-worker edge function`

**When to change** — Raise to 10–15 when fix-augmentation is consistently hitting the cap and the judge isn't getting enough context. Lower to 2–3 once your Firecrawl bill becomes the noisy line item.

## Settings → Dev tools

<a id="settings-dev-tools"></a>

### Debug Mode

<a id="settings-devtools-debug-mode"></a>

`settings.devtools.debug_mode`

**Summary** — Local-only toggle that prints every API call, auth event, and timing to the browser console.

**How it works** — Persists to `localStorage` under `mushi:debug` and reloads the page so the logger picks up the new mode at boot. Touches no backend state — purely a developer aid for diagnosing admin-side issues.

**Default** — `off`

**When to change** — Flip on when chasing an admin UI bug, then flip back off — the console output is verbose enough that it slows page interactions noticeably.

## Projects

<a id="projects"></a>

### Project name

<a id="projects-create-project"></a>

`projects.create_project`

**Summary** — Names a new project — the bucket every report, key, and integration is scoped to.

**How it works** — Project names appear in the switcher, on every report, and in webhook payloads — keep them recognisable to humans. Slugs are auto-derived from the name (lowercased, hyphenated) and used in URLs / API keys, so very short or generic names produce ambiguous slugs across orgs. After you click Create, the success panel shows the Project UUID to paste into the CLI (`MUSHI_PROJECT_ID`).

**Default** — `unset (you must pick a name)`

**Where it lives** — table `projects.name` · endpoint `POST /v1/admin/projects` · read by `api edge function (GET /v1/admin/projects)`, `console ProjectSwitcher`

**When to change** — Set when adding a new app, environment, or customer. Rename later via the API if your team rebrands — slugs persist, names don't affect routing.

### Project ID (UUID)

<a id="projects-project-id-copy"></a>

`projects.project_id_copy`

**Summary** — The UUID your SDK and CLI use as MUSHI_PROJECT_ID — copy from the chip or the post-create success panel.

**How it works** — Every report send and MCP call scopes to this id. The CLI wizard accepts UUID or proj_* slug form; the console always displays the UUID. Click the chip on Projects to copy — paste into `mushi init`, `mushi connect`, or `.env.local`.

**Default** — `auto-generated on create`

**When to change** — Rarely — create a new project instead of reusing IDs across unrelated apps.

### CLI setup mode

<a id="onboarding-cli-setup"></a>

`onboarding.cli_setup`

**Summary** — Deep link opened by `npx mushi-mushi` when you need to create a project first.

**How it works** — URL flag `?setup=cli` on Setup → Steps shows CLI-oriented copy and keeps the success panel visible until you copy the Project ID and CLI commands. Pair with `mushi login` or paste credentials back into the wizard.

**Default** — `/onboarding?tab=steps&setup=cli`

**When to change** — Follow this path whenever the terminal asks for a Project ID you do not have yet.

### API key scope preset

<a id="projects-api-key-scope"></a>

`projects.api_key_scope`

**Summary** — Chooses what a new API key can do — send bugs from your app, read reports in your editor, or both read and write.

**How it works** — Each preset maps to scopes stored on the key — edge functions check scope before serving the call, so a leaked SDK key can't mutate state. SDK send-only = report submission. MCP read = browse reports in Cursor. MCP read + write = dispatch fixes from the editor.

**Default** — `SDK send-only (report:write only)`

**Where it lives** — table `project_api_keys.scopes (text[])` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `POST /v1/reports (api route)`, `mcp server (@mushi-mushi/mcp)`

**When to change** — Pick `SDK send-only` for keys you ship inside a browser bundle. Pick `MCP read-only` for safely letting an agent browse reports. Only pick `MCP read + write` for trusted local clients with an audit trail.

### Key scope: report submission

<a id="projects-key-scope-report-write"></a>

`projects.key_scope.report_write`

**Summary** — Lets the API key send new bug reports from your app.

**How it works** — Required for the SDK to submit user-reported bugs. Without this scope, `POST /v1/reports` returns 403. Safe to ship in browser bundles — the Edge Function rate-limits per IP and validates payload shape before storing anything.

**Default** — `enabled by default for new keys`

**Where it lives** — table `project_api_keys.scopes (text[])` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `POST /v1/reports (api route)`

**When to change** — Always grant this for keys used by the SDK. Drop it for back-office keys that only need to read state (admin dashboards, MCP read-only).

### Key scope: mcp:read

<a id="projects-key-scope-mcp-read"></a>

`projects.key_scope.mcp_read`

**Summary** — Lets the MCP server expose read-only resources (reports, projects, prompts) to LLM clients.

**How it works** — The MCP server bundled at `packages/mcp` reads this scope to decide which tools / resources to register. Without it, only the public health-probe tools work.

**Default** — `disabled by default — opt-in via the mint dialog`

**Where it lives** — table `project_api_keys.scopes (text[])` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `mcp server (@mushi-mushi/mcp)`

**When to change** — Grant on keys you paste into Claude Desktop / Cursor / Cline so the LLM can read your reports inbox. Pair with `mcp:write` only if you want the LLM to mutate state.

### Key scope: mcp:write

<a id="projects-key-scope-mcp-write"></a>

`projects.key_scope.mcp_write`

**Summary** — Allows MCP tool calls to mutate state — transition report status, dispatch fixes, merge PRs, post replies.

**How it works** — Mutating MCP tools (`dispatch_fix`, `transition_status`, `merge_fix`, `reopen_report`, etc.) gate on this scope. Add it sparingly — anything an LLM can call from a paste-able key, an attacker with the same key can call too.

**Default** — `disabled by default`

**Where it lives** — table `project_api_keys.scopes (text[])` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `mcp server (@mushi-mushi/mcp)`

**When to change** — Only when you've scoped the key to a single trusted client (e.g. one developer's Cursor) and have an audit trail in place. Revoke + re-mint on personnel changes.

### Active Project

<a id="projects-active-project"></a>

`projects.active_project`

**Summary** — Picks which project's data the entire admin operates on for this session.

**How it works** — Every admin API call carries the active project id in the `X-Mushi-Project-Id` header. Switching here re-issues all queries — there's no manual "reload everything" step. The choice is kept in this browser (localStorage `mushi:active_project_id`, or `?project=` in the URL), not on the server, so each browser keeps its own default.

**Default** — `first project the user has access to`

**When to change** — Switch when reviewing bugs across multiple apps. For SSO orgs, ask the workspace owner to scope your invite so the picker only shows projects you should see.

## Integrations

<a id="integrations"></a>

### Sentry org slug

<a id="integrations-sentry-org-slug"></a>

`integrations.sentry.org_slug`

**Summary** — Identifies your Sentry organization in API calls — the bit after `sentry.io/organizations/`.

**How it works** — Used to scope every Sentry API call (issues, events, Seer root-cause). Wrong slug → 404 on every request and the integration goes red.

**Default** — `unset`

**Where it lives** — table `project_settings.sentry_org_slug` · endpoint `PUT /v1/admin/integrations/platform/sentry` · read by `sentry-seer-poll edge function`, `integration-health-probe edge function`

**When to change** — Set once at install. Update only if Sentry renames your org (rare).

### Sentry project slug

<a id="integrations-sentry-project-slug"></a>

`integrations.sentry.project_slug`

**Summary** — The specific Sentry project Mushi correlates against for stack traces and breadcrumbs.

**How it works** — Scopes the event search when enriching a report. Leave blank to search across all projects under the org (slower; recommended only for tiny orgs).

**Default** — `unset (org-wide search)`

**Where it lives** — table `project_settings.sentry_project_slug` · endpoint `PUT /v1/admin/integrations/platform/sentry` · read by `sentry-seer-poll edge function`, `api edge function (POST /v1/admin/projects/:id/sentry/import)`

**When to change** — Set this whenever you have more than one Sentry project — the speed-up on enrichment is significant.

### Sentry auth token

<a id="integrations-sentry-auth-token"></a>

`integrations.sentry.auth_token`

**Summary** — Sentry token granting `project:read` + `event:read` (import, enrichment) and `event:write` (resolve the issue when a Mushi fix merges).

**How it works** — Stored as a vault reference (`vault://id`) — never in plaintext. Used to import existing issues, fetch the matching event payload for a report, and resolve linked Sentry issues when their fix PR merges.

**Default** — `unset (enrichment disabled)`

**Where it lives** — table `project_settings.sentry_auth_token_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/sentry` · read by `sentry-seer-poll edge function`, `integration-health-probe edge function`, `POST /v1/admin/projects/:id/sentry/import (api route)`, `finalizeFixMerge (_shared/fix-merge.ts)`

**When to change** — Rotate quarterly, or whenever the issuing user leaves the org.

### Langfuse host

<a id="integrations-langfuse-host"></a>

`integrations.langfuse.host`

**Summary** — Base URL of your Langfuse instance — cloud or self-hosted.

**How it works** — Saved per project and checked by the integration health probe, which calls this host with the key pair. Mushi’s own LLM traces (Stage 1, Stage 2, fix-worker, judge) do not use it: they go to the deployment’s `LANGFUSE_*` environment settings.

**Default** — `unset (falls back to the deployment’s LANGFUSE_BASE_URL on the card)`

**Where it lives** — table `project_settings.langfuse_host` · endpoint `PUT /v1/admin/integrations/platform/langfuse` · read by `integration-health-probe edge function (credential probe)`, `api edge function (GET /v1/admin/integrations/platform)`

**When to change** — Set it when you want the Integrations page to check your own Langfuse project. It does not redirect Mushi’s LLM traces.

### Langfuse public key

<a id="integrations-langfuse-public-key"></a>

`integrations.langfuse.public_key`

**Summary** — Pairs with the secret key for HTTP Basic auth against the Langfuse ingest endpoint.

**How it works** — Stored in Vault. The integration health probe sends it as the username of HTTP Basic auth when it checks your Langfuse host. Mushi’s own LLM traces use the deployment’s `LANGFUSE_PUBLIC_KEY`, not this.

**Default** — `unset`

**Where it lives** — table `project_settings.langfuse_public_key_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/langfuse` · read by `integration-health-probe edge function (credential probe)`

**When to change** — Rotate together with the secret key whenever you suspect either is leaked.

### Langfuse secret key

<a id="integrations-langfuse-secret-key"></a>

`integrations.langfuse.secret_key`

**Summary** — Secret half of the Langfuse key pair the Integrations page checks your Langfuse project with.

**How it works** — Stored in Vault. The integration health probe sends it as the password of HTTP Basic auth when it checks your Langfuse host. Mushi’s own LLM traces use the deployment’s `LANGFUSE_SECRET_KEY`, not this.

**Default** — `unset`

**Where it lives** — table `project_settings.langfuse_secret_key_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/langfuse` · read by `integration-health-probe edge function (credential probe)`

**When to change** — Rotate quarterly, or immediately on any suspicion of leak.

### GitHub repo URL

<a id="integrations-github-repo-url"></a>

`integrations.github.repo_url`

**Summary** — The code repository the auto-fix worker opens draft PRs against.

**How it works** — Full HTTPS URL (SSH URLs are normalised). The fix-worker clones the default branch, applies the LLM patch on a feature branch, and pushes a draft PR with the report id in the body.

**Default** — `unset (autofix disabled)`

**Where it lives** — table `project_settings.github_repo_url` · endpoint `PUT /v1/admin/integrations/platform/github` · read by `fix-worker edge function`

**When to change** — Set when you graduate from "review only" to "Mushi opens PRs". Typically the production repo, not a sandbox.

### GitHub default branch

<a id="integrations-github-default-branch"></a>

`integrations.github.default_branch`

**Summary** — The repo’s default branch as saved on the GitHub card.

**How it works** — Shown on the GitHub card and copied by "Apply to projects". The fix-worker does not read it: it takes the PR base from the primary connected repo (`project_repos.default_branch`), or `main` when that is empty.

**Default** — `unset`

**Where it lives** — table `project_settings.github_default_branch` · endpoint `PUT /v1/admin/integrations/platform/github` · read by `api edge function (GET /v1/admin/integrations/platform, POST …/platform/github/apply)`

**When to change** — Keep it matching your repo's default branch. To change the branch fixes are opened against, change the connected repo's default branch instead.

### GitHub installation token

<a id="integrations-github-installation-token"></a>

`integrations.github.installation_token`

**Summary** — GitHub App installation token (preferred) or fine-grained PAT used to push branches and open PRs.

**How it works** — Needs `Contents:write` + `Pull requests:write` on the target repo. Stored as a vault reference. App tokens are preferred — they auto-rotate and have a shorter blast radius than PATs.

**Default** — `unset`

**Where it lives** — table `project_settings.github_installation_token_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/github` · read by `fix-worker edge function`

**When to change** — Re-issue when the GitHub App is uninstalled/reinstalled, or when a PAT hits its expiry.

### GitHub webhook secret

<a id="integrations-github-webhook-secret"></a>

`integrations.github.webhook_secret`

**Summary** — HMAC secret that authenticates inbound check-run, check-suite and push webhooks from GitHub.

**How it works** — Mushi's webhook route (`POST /v1/webhooks/github`) verifies the `X-Hub-Signature-256` header against this secret. Without a match → 401, the event is dropped. The same value must be set in the GitHub repo Settings → Webhooks.

**Default** — `unset (CI sync disabled)`

**Where it lives** — table `project_settings.github_webhook_secret (Vault)` · endpoint `PUT /v1/admin/integrations/platform/github` · read by `api edge function (POST /v1/webhooks/github)`

**When to change** — Set this once you want PR check-run conclusions (CI passing/failing) reflected in the Auto-Fix Pipeline UI.

### Cursor API key

<a id="integrations-cursor-cloud-api-key"></a>

`integrations.cursor_cloud.api_key`

**Summary** — Cursor API key Mushi uses to start Cursor Cloud Agent runs that draft a fix PR.

**How it works** — Stored in Vault. When a fix is dispatched to the `cursor_cloud` agent, the fix-worker starts a Cursor Cloud Agent run with this key against the repo from the GitHub card, and the status poller uses it to follow the run. Skill-pipeline steps in cloud mode use it too. Connect GitHub first: Cursor needs the repo URL and token.

**Default** — `unset (Cursor dispatch unavailable)`

**Where it lives** — table `project_settings.cursor_api_key_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/cursor_cloud` · read by `fix-worker edge function (via _shared/agent-adapters.ts)`, `agent-status-poll edge function`, `api edge function (skill pipeline steps, via _shared/plugins.ts)`, `integration-health-probe edge function`

**When to change** — Set it when you want "Send to Cursor" on reports. Rotate it in the Cursor dashboard whenever someone with access to it leaves.

### Cursor default model

<a id="integrations-cursor-cloud-default-model"></a>

`integrations.cursor_cloud.default_model`

**Summary** — Cursor model slug for agent runs Mushi starts.

**How it works** — Passed as the model on each Cursor Cloud Agent run. When empty, fix dispatches let Cursor use your account default, skill-pipeline steps use `composer-2.5`, and the story mapper sends `default`.

**Default** — `composer-2.5 (database default)`

**Where it lives** — table `project_settings.cursor_default_model` · endpoint `PUT /v1/admin/integrations/platform/cursor_cloud` · read by `fix-worker edge function`, `story-mapper edge function`, `api edge function (skill pipeline steps, via _shared/plugins.ts)`

**When to change** — Change it when Cursor ships a model that fixes your codebase better, or to cut cost per run.

### Cursor auto-create PRs

<a id="integrations-cursor-cloud-auto-create-pr"></a>

`integrations.cursor_cloud.auto_create_pr`

**Summary** — Whether a Cursor agent run opens a draft PR by itself when it finishes.

**How it works** — Only skill-pipeline steps sent to Cursor read this setting. Fix dispatches from a report always ask Cursor to open the PR, because Mushi tracks the fix through that PR.

**Default** — `true`

**Where it lives** — table `project_settings.cursor_auto_create_pr` · endpoint `PUT /v1/admin/integrations/platform/cursor_cloud` · read by `api edge function (skill pipeline steps, via _shared/plugins.ts)`

**When to change** — Turn it off if you want to review a skill-pipeline step’s branch before any PR exists.

### Cursor max iterations

<a id="integrations-cursor-cloud-max-iterations"></a>

`integrations.cursor_cloud.max_iterations`

**Summary** — Intended cap on agent iterations per Cursor run. Saved, but not sent to Cursor yet.

**How it works** — The skill-pipeline dispatcher reads it along with the other Cursor settings, but no Cursor request includes it today, so runs use Cursor’s own limit. The server does not range-check it; the card suggests 1–10.

**Default** — `1`

**Where it lives** — table `project_settings.cursor_max_iterations` · endpoint `PUT /v1/admin/integrations/platform/cursor_cloud` · read by `api edge function (read by _shared/plugins.ts, not sent to Cursor)`

**When to change** — Leave it at 1 for now: changing it has no effect on runs yet.

### Claude Code agent: Anthropic API key

<a id="integrations-claude-code-agent-api-key"></a>

`integrations.claude_code_agent.api_key`

**Summary** — Anthropic key Mushi uses only to check that the Claude Code agent integration is healthy.

**How it works** — Stored in Vault. The integration health probe calls the Anthropic models list with it (no tokens used). The fix itself runs in your repo’s GitHub Actions workflow with the `ANTHROPIC_API_KEY` secret you add there; Mushi never sends this key to GitHub.

**Default** — `unset`

**Where it lives** — table `project_settings.claude_api_key_ref (Vault)` · endpoint `PUT /v1/admin/integrations/platform/claude_code_agent` · read by `integration-health-probe edge function`

**When to change** — Rotate it together with the `ANTHROPIC_API_KEY` secret in your repo, so the health check tests the key the workflow uses.

### Claude Code agent: default model

<a id="integrations-claude-code-agent-default-model"></a>

`integrations.claude_code_agent.default_model`

**Summary** — Model slug saved for the Claude Code fix workflow.

**How it works** — Validated and stored only. No Mushi code sends it anywhere yet: the server has no dispatch path for the Claude Code workflow today, so the workflow in your repo picks its own model.

**Default** — `claude-opus-4-1 (database default)`

**Where it lives** — table `project_settings.claude_default_model` · endpoint `PUT /v1/admin/integrations/platform/claude_code_agent`

**When to change** — No need to change it yet; it has no effect until Mushi dispatches the workflow.

### Claude Code agent: workflow event

<a id="integrations-claude-code-agent-workflow-event"></a>

`integrations.claude_code_agent.workflow_event`

**Summary** — The `repository_dispatch` event type your mushi-claude-fix workflow listens for.

**How it works** — The setup checklist on the card writes this value into the workflow YAML it hands you (`on.repository_dispatch.types`). Anything that is not a plain identifier falls back to `mushi_claude_fix`.

**Default** — `mushi_claude_fix`

**Where it lives** — table `project_settings.claude_workflow_event` · endpoint `PUT /v1/admin/integrations/platform/claude_code_agent` · read by `api edge function (GET /v1/admin/integrations/claude-code-agent/setup)`

**When to change** — Change it only if the default event name clashes with another workflow, then copy the regenerated YAML into your repo.

### Claude Code agent: base branch

<a id="integrations-claude-code-agent-default-branch"></a>

`integrations.claude_code_agent.default_branch`

**Summary** — Branch saved as the base for Claude Code fix runs.

**How it works** — Validated and stored only. No Mushi code reads it yet: the server has no dispatch path for the Claude Code workflow today, so the workflow checks out whatever its YAML says.

**Default** — `main (database default)`

**Where it lives** — table `project_settings.claude_default_branch` · endpoint `PUT /v1/admin/integrations/platform/claude_code_agent`

**When to change** — No need to change it yet; set the branch in the workflow YAML instead.

### Jira base URL

<a id="integrations-routing-jira-base-url"></a>

`integrations.routing.jira.base_url`

**Summary** — Your Atlassian Cloud or Server base URL — issues and links resolve relative to this.

**How it works** — Used to build issue URLs (`{baseUrl}/browse/{key}`) and as the API host for create/update calls. Cloud URLs typically end in `.atlassian.net`.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.baseUrl (integration_type = jira)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Update if Atlassian migrates your tenant or you self-host Jira behind a new domain.

### Jira user email

<a id="integrations-routing-jira-email"></a>

`integrations.routing.jira.email`

**Summary** — Atlassian account email that owns the API token below — Jira pairs them as basic auth.

**How it works** — Sent as the username for every Jira request. Pair with the API token in the next field.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.email (integration_type = jira)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Set this to a service account, not a real human — service accounts survive offboarding.

### Jira API token

<a id="integrations-routing-jira-api-token"></a>

`integrations.routing.jira.api_token`

**Summary** — Atlassian API token paired with the email above for basic auth.

**How it works** — Stored in Supabase Vault; the routing row keeps only a reference, and the console shows that a token is set. Create at id.atlassian.com → Security → API tokens.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.apiToken (integration_type = jira, Vault)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Rotate quarterly. Re-issue immediately if the owning email changes.

### Jira project key

<a id="integrations-routing-jira-project-key"></a>

`integrations.routing.jira.project_key`

**Summary** — Short uppercase code that prefixes every issue in the target project (e.g. `BUG`, `MUSHI`).

**How it works** — Used in the `POST /rest/api/3/issue` payload as `fields.project.key`. The created issues get keys like `BUG-123`. Wrong key → Jira rejects the create call.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.projectKey (integration_type = jira)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`

**When to change** — Change to route to a different Jira project — typically when the support team owns a new tracker.

### Linear API key

<a id="integrations-routing-linear-api-key"></a>

`integrations.routing.linear.api_key`

**Summary** — Personal API key used to mirror reports as Linear issues.

**How it works** — Sent as the `Authorization` header on every Linear GraphQL call. Stored in Supabase Vault; the routing row keeps only a reference, and the console shows that a token is set. Generate at Linear → Settings → API → Personal API keys.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.apiKey (integration_type = linear, Vault)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`

**When to change** — Rotate when the issuing user changes role. Linear keys don't auto-expire, so quarterly review is wise.

### Linear team ID

<a id="integrations-routing-linear-team-id"></a>

`integrations.routing.linear.team_id`

**Summary** — UUID of the Linear team that should receive mirrored issues.

**How it works** — Used as the `teamId` argument on `issueCreate`. Find it in Linear → Settings → API → "Find your team ID".

**Default** — `unset`

**Where it lives** — table `project_integrations.config.teamId (integration_type = linear)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`

**When to change** — Update when re-routing to a different team — e.g. moving from Triage to Engineering once the team grows.

### GitHub Issues PAT

<a id="integrations-routing-github-issues-token"></a>

`integrations.routing.github_issues.token`

**Summary** — Fine-grained PAT with `Issues:write` on the public-tracker repo.

**How it works** — Distinct from the auto-fix repo PAT — this one targets the tracker repo (often public), not the code repo. Stored in Supabase Vault; the routing row keeps only a reference, and the console shows that a token is set.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.token (integration_type = github, Vault)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Use when you want a public-facing changelog of reviewed bugs without exposing your code repo.

### GitHub Issues owner

<a id="integrations-routing-github-issues-owner"></a>

`integrations.routing.github_issues.owner`

**Summary** — Org or user that owns the issue-tracker repo (the bit before the slash in `owner/repo`).

**How it works** — Concatenated into the GitHub API path: `/repos/{owner}/{repo}/issues`.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.owner (integration_type = github)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Change when the tracker repo moves under a new org — typically during company rebranding.

### GitHub Issues repo

<a id="integrations-routing-github-issues-repo"></a>

`integrations.routing.github_issues.repo`

**Summary** — Repository name (no owner prefix) that issues are filed under.

**How it works** — Concatenated with the owner above into the API path. Case-sensitive on the GitHub API side.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.repo (integration_type = github)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Update when archiving and replacing the tracker — Mushi follows the new repo as soon as you save.

### PagerDuty routing key

<a id="integrations-routing-pagerduty-routing-key"></a>

`integrations.routing.pagerduty.routing_key`

**Summary** — 32-character integration key for PagerDuty Events API v2 — pages on-call when severity = critical.

**How it works** — Mushi POSTs a v2 event payload with `event_action=trigger` and a fingerprint built from the report cluster id, so duplicate criticals dedupe instead of paging twice. Auto-resolves the incident when the linked report closes.

**Default** — `unset`

**Where it lives** — table `project_integrations.config.routingKey (integration_type = pagerduty, Vault)` · endpoint `POST /v1/admin/integrations` · read by `classify-report edge function (files the issue)`, `api edge function (POST /v1/admin/integrations/sync/:reportId; closes the issue when the report resolves)`, `integration-health-probe edge function`

**When to change** — Set this once you have a real on-call rotation. Don't use a personal key — use a service-level integration key.

## Storage (BYO)

<a id="storage-byo-"></a>

### Storage provider

<a id="storage-provider"></a>

`storage.provider`

**Summary** — Which object-storage backend hosts user-uploaded artifacts (screenshots, recordings, attachments).

**How it works** — Switches the storage adapter used for new uploads — supabase (default, lives in Supabase Storage), s3 (any S3-compatible host), gcs (Google Cloud Storage), or r2 (Cloudflare R2). Existing artifacts stay where they were written; only new traffic moves.

**Default** — `supabase`

**Where it lives** — table `project_storage_settings.provider` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function: every upload and download)`

**When to change** — Switch to your own bucket once you cross the Supabase Storage egress free tier, or when compliance asks you to keep artifacts inside your own VPC.

### Bucket

<a id="storage-bucket"></a>

`storage.bucket`

**Summary** — Name of the bucket the storage adapter writes artifacts into.

**How it works** — Must already exist on the chosen provider — Mushi never creates buckets implicitly (avoids accidental data scattering across regions). The IAM identity behind the credentials below needs `s3:PutObject` / `s3:GetObject` (or the equivalent) on this bucket.

**Default** — `unset`

**Where it lives** — table `project_storage_settings.bucket` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Set once when wiring BYO storage. Migrate to a new bucket only with a backfill plan — old links keep pointing at the old one.

### Region

<a id="storage-region"></a>

`storage.region`

**Summary** — Geographic region of the bucket — used to sign requests and to build the default S3 endpoint.

**How it works** — For S3, the region is part of the URL signing process; mismatch → SignatureDoesNotMatch. With no endpoint set, the adapter builds `https://s3.<region>.amazonaws.com` (us-east-1 when empty). It is not compared with the project’s data residency region.

**Default** — `unset`

**Where it lives** — table `project_storage_settings.region` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Set the region your bucket actually lives in. Don't guess — write failures from a wrong region are silent until the user can't open their screenshot.

### Endpoint

<a id="storage-endpoint"></a>

`storage.endpoint`

**Summary** — Full URL of the storage API endpoint — only needed for non-AWS S3-compatible providers.

**How it works** — Leave blank for AWS S3 (the SDK builds the URL from region). Set explicitly for R2 (`https://<account>.r2.cloudflarestorage.com`), Backblaze B2, MinIO, or any other S3-compatible host.

**Default** — `empty (provider default)`

**Where it lives** — table `project_storage_settings.endpoint` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Set once when pointing at a non-AWS S3 host. Update if your provider migrates accounts to a new endpoint shape.

### Path prefix

<a id="storage-path-prefix"></a>

`storage.path_prefix`

**Summary** — String prepended to every key the storage adapter writes — segments artifacts inside a shared bucket.

**How it works** — A trailing slash is added if missing. Useful when one bucket hosts multiple Mushi projects or coexists with other apps — set to `mushi/prod/` so your tooling can audit just the Mushi paths without confusing them with neighbours.

**Default** — `empty (writes to bucket root)`

**Where it lives** — table `project_storage_settings.path_prefix` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Set when sharing a bucket. Don't change after writes have started — old keys stay where they were.

### Signed URL TTL (seconds)

<a id="storage-signed-url-ttl-secs"></a>

`storage.signed_url_ttl_secs`

**Summary** — Lifetime of presigned download URLs handed out to admin users for screenshots and recordings.

**How it works** — Every download in the admin (e.g. preview a screenshot, replay a session recording) is gated by a fresh presigned URL. Lower = tighter security (links expire fast); higher = friendlier UX (a copied link still works in a Slack thread an hour later).

**Default** — `3600 (1 hour)` · range `60 – 604800 (7 days)`

**Where it lives** — table `project_storage_settings.signed_url_ttl_secs` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (every signed URL it mints)`

**When to change** — Drop to 5–15 minutes for high-sensitivity data. Bump up to a day if your team works asynchronously and copies links into long-running threads.

### Access key ID

<a id="storage-access-key-ref"></a>

`storage.access_key_ref`

**Summary** — The access-key half of your bucket credentials. Paste the key itself; Mushi stores it in Supabase Vault, never in plain text.

**How it works** — On Save the server stores the raw key in Vault under the project's own Vault name (mushi/storage/<project>/access_key) and keeps only that name. The storage adapter reads the secret when it signs a request. A saved key is never shown again; paste a new one to replace it.

**Default** — `unset`

**Where it lives** — table `project_storage_settings.access_key_vault_ref (Vault)` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Rotate quarterly, or immediately if the key may have leaked.

### Secret access key

<a id="storage-secret-key-ref"></a>

`storage.secret_key_ref`

**Summary** — The secret half of your bucket credentials. Paste it as your provider shows it.

**How it works** — Same Vault flow as the access key. Rotate the pair together — half-rotations leave the adapter unable to sign.

**Default** — `unset`

**Where it lives** — table `project_storage_settings.secret_key_vault_ref (Vault)` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Rotate alongside the access key. Never paste the raw value into an email or ticket.

### KMS key ID

<a id="storage-kms-key-id"></a>

`storage.kms_key_id`

**Summary** — Optional customer-managed KMS key used to encrypt artifacts at rest with SSE-KMS.

**How it works** — When set, every PutObject specifies `x-amz-server-side-encryption: aws:kms` with this key id. Without it, the bucket's default encryption applies (typically AES256).

**Default** — `empty (provider default encryption)`

**Where it lives** — table `project_storage_settings.kms_key_id` · endpoint `PUT /v1/admin/storage/:projectId` · read by `_shared/storage.ts adapter (api edge function)`

**When to change** — Set when compliance demands customer-managed encryption keys. Verify the IAM principal has `kms:Encrypt`/`kms:Decrypt` on the key ARN.

## Compliance

<a id="compliance"></a>

### Data residency region

<a id="compliance-residency-region"></a>

`compliance.residency.region`

**Summary** — Pins your project's data to a specific geographic region — `us`, `eu`, `jp`, or `self` (BYO storage).

**How it works** — On first set, Mushi pins the project to this region: a trigger copies it into `region_routing`, and the API’s region router sends that project’s requests to the matching regional deployment. It does not check where your storage bucket lives. Once pinned, change attempts return 409 with `code: REGION_LOCKED`. To migrate, open a support ticket so the data move can be audited.

**Default** — `unpinned`

**Where it lives** — table `projects.data_residency_region` · endpoint `PUT /v1/admin/residency/{projectId}` · read by `projects_sync_region_routing trigger → region_routing`, `api edge function (regionRouter in _shared/region.ts)`

**When to change** — Set on day 1 if compliance demands it (HIPAA, GDPR, J-SOX). Don't set speculatively — the lock-out is real and reversal is manual.

**Learn more** — [Configuration reference](https://github.com/kensaurus/mushi-mushi/blob/master/docs/CONFIG_REFERENCE.md)

### Reports retention (days)

<a id="compliance-retention-reports-days"></a>

`compliance.retention.reports_days`

**Summary** — How long classified reports stay in the database before the retention sweeper deletes them.

**How it works** — Two nightly sweeps (the retention-sweep function at 03:00 UTC and the `mushi_apply_retention()` cron at 03:30 UTC) delete any report whose `created_at + reports_retention_days` is in the past, UNLESS `legal_hold` is true (in which case nothing is deleted regardless of age). Deletes are permanent; there is no soft-delete step.

**Default** — `365 (1 year)`

**Where it lives** — table `project_retention_policies.reports_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `retention-sweep edge function`, `mushi-soc2-retention-sweep cron (mushi_apply_retention)`, `soc2-evidence edge function`

**When to change** — Lower to 90 for GDPR-tight projects. Raise to 730+ for regulated industries that need multi-year audit history.

### Audit log retention (days)

<a id="compliance-retention-audit-days"></a>

`compliance.retention.audit_days`

**Summary** — How long admin-action audit logs (who saw / changed / deleted what) are retained.

**How it works** — Independent of the reports retention. The nightly `mushi_apply_retention()` cron deletes `audit_logs` rows older than this window unless the project is on legal hold. Most regulators want 1–7 years of audit even on 90-day data.

**Default** — `730 (2 years)`

**Where it lives** — table `project_retention_policies.audit_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `mushi-soc2-retention-sweep cron (mushi_apply_retention)`, `soc2-evidence edge function`

**When to change** — Match your strictest regulatory ask (SOC 2 typically asks for 1y; HIPAA 6y; J-SOX 7y).

### BYOK audit retention (days)

<a id="compliance-retention-attachments-days"></a>

`compliance.retention.attachments_days`

**Summary** — How long the log of AI-key changes (keys added, rotated, tested, removed) is kept.

**How it works** — The nightly `mushi_apply_retention()` cron deletes `byok_audit_log` rows older than this window unless the project is on legal hold. The keys themselves live in Vault and are not affected.

**Default** — `365 (1 year)`

**Where it lives** — table `project_retention_policies.byok_audit_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `mushi-soc2-retention-sweep cron (mushi_apply_retention)`

**When to change** — Keep it at least as long as your audit log retention, so you can still show who changed an AI key during an audit window.

### LLM traces retention (days)

<a id="compliance-retention-events-days"></a>

`compliance.retention.events_days`

**Summary** — The retention window recorded for LLM call traces. No sweep enforces it yet.

**How it works** — Saved with the project’s retention policy and shown here, but neither nightly sweep reads it: LLM call records are not deleted by age today. Set it to the window your policy promises, so it is in place once a sweep enforces it.

**Default** — `90`

**Where it lives** — table `project_retention_policies.llm_traces_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}`

**When to change** — Match what your privacy policy says about AI processing logs. Changing it does not delete anything yet.

### Legal hold

<a id="compliance-legal-hold"></a>

`compliance.legal_hold`

**Summary** — Master switch that suspends ALL retention deletes — for litigation holds and regulatory inquiries.

**How it works** — When on, both retention sweeps skip the project and delete nothing. The toggle is itself audit-logged (who flipped it, when, and the reason if one is given) so a compliance team can prove the hold was active during the incident window.

**Default** — `off`

**Where it lives** — table `project_retention_policies.legal_hold` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `retention-sweep edge function`, `mushi-soc2-retention-sweep cron (mushi_apply_retention)`, `soc2-evidence edge function`

**When to change** — Flip ON the moment counsel hands you a hold notice. Flip OFF only after counsel confirms the hold is released — leaving it on indefinitely defeats GDPR/CCPA right-to-be-forgotten.

### DSAR subject email

<a id="compliance-dsar-subject-email"></a>

`compliance.dsar.subject_email`

**Summary** — Email address of the data subject who asked for access, export, deletion or correction of their data.

**How it works** — Submitting records a DSAR (Data Subject Access Request) with this email and the request type (access, export, deletion or rectification), status `pending`, and writes an audit log entry. Mushi does not search, export or delete anything for you: your team fulfils the request, then marks it in progress, completed (with an evidence link) or rejected. The SOC 2 evidence check fails while any request stays pending for more than 30 days.

**Default** — `unset`

**Where it lives** — table `data_subject_requests.subject_email` · endpoint `POST /v1/admin/compliance/dsars` · read by `api edge function (GET /v1/admin/compliance/dsars, PATCH …/dsars/:id)`, `soc2-evidence edge function (DSAR fulfilment lag control: reads the request status, not the email)`

**When to change** — Fill in only when recording a real DSAR. Each submission creates an auditable request — don't test on real customer emails.

## SSO

<a id="sso"></a>

### SSO provider type

<a id="sso-provider-type"></a>

`sso.provider_type`

**Summary** — Which federation protocol the IdP speaks — `saml` (self-service) or `oidc` (audit-only — manual setup required).

**How it works** — Decides how the config is registered. SAML is fully self-service: Mushi calls the Supabase Auth (GoTrue) Admin API to register the provider and stores the ACS URL + Entity ID it returns. Supabase Auth then handles the SAML sign-in itself; Mushi has no SSO callback of its own. OIDC is stored for audit but Mushi cannot auto-register it (GoTrue's Admin API does not yet expose an OIDC endpoint); selecting it returns HTTP 202 with `status: 'manual_required'` so you can quote the config id in a Supabase support ticket.

**Default** — `saml`

**Where it lives** — table `enterprise_sso_configs.provider_type` · endpoint `POST /v1/admin/sso` · read by `api edge function (POST /v1/admin/sso → Supabase Auth Admin API)`, `api edge function (GET /v1/admin/sso)`

**When to change** — Pick what your IdP actually serves. Don't pick OIDC yet — the gate exists for safety, not capacity.

### IdP metadata URL

<a id="sso-metadata-url"></a>

`sso.metadata_url`

**Summary** — URL of the IdP's SAML metadata (certificates, endpoints, assertion shape).

**How it works** — Mushi passes it to the Supabase Auth Admin API when it registers the SAML provider; Supabase Auth fetches and parses the metadata. Mushi keeps the URL on the config row for display and audit. SAML needs either this URL or pasted metadata XML.

**Default** — `unset`

**Where it lives** — table `enterprise_sso_configs.metadata_url` · endpoint `POST /v1/admin/sso` · read by `api edge function (POST /v1/admin/sso → Supabase Auth Admin API)`, `api edge function (GET /v1/admin/sso)`

**When to change** — Update when migrating IdPs (Okta → Entra, etc.). Verify the new metadata URL is reachable from your Mushi region before flipping.

### Entity ID

<a id="sso-entity-id"></a>

`sso.entity_id`

**Summary** — Unique identifier for this Mushi project as seen by the IdP — also called the audience.

**How it works** — For SAML, Mushi replaces what you type with the Entity ID Supabase Auth reports after registering the provider; that is the value to enter as the audience in your IdP. For OIDC the column holds the client ID. Mushi only displays it; Supabase Auth checks assertions.

**Default** — `unset`

**Where it lives** — table `enterprise_sso_configs.entity_id` · endpoint `POST /v1/admin/sso` · read by `api edge function (GET /v1/admin/sso)`

**When to change** — Set once during provisioning. Match exactly what the IdP's app config has for "Audience URI".

### SSO email domains

<a id="sso-allowed-domains"></a>

`sso.allowed_domains`

**Summary** — Comma-separated email domains routed to this SSO provider (`acme.com, acme.co.jp`).

**How it works** — Sent to the Supabase Auth Admin API with the SAML provider, so Supabase Auth can pick this provider when an SSO sign-in starts from one of these email domains. The Mushi console sign-in page does not offer SSO sign-in by domain yet, and there is no "SSO required" switch.

**Default** — `unset`

**Where it lives** — table `enterprise_sso_configs.domains (text[])` · endpoint `POST /v1/admin/sso` · read by `api edge function (POST /v1/admin/sso → Supabase Auth Admin API)`, `api edge function (GET /v1/admin/sso)`

**When to change** — Add a domain the day before that company's users start onboarding. Remove a domain immediately on contract end so old emails can't still SSO in.

## Prompt Lab

<a id="prompt-lab"></a>

### Pipeline stage

<a id="prompt-lab-stage"></a>

`prompt-lab.stage`

**Summary** — Picks which AI step you're editing prompts for — fast-filter, classifier, fix-worker, or judge.

**How it works** — Each stage has its own active prompt id. Switching tabs scopes every action below (create new version, set traffic split, replay) to that stage's prompts only — they don't cross-pollinate.

**Default** — `classifier (most-used)`

**Where it lives** — table `prompt_versions.stage` · endpoint `POST /v1/admin/prompt-lab/prompts` · read by `_shared/prompt-ab.ts (fast-filter, classify-report, fix-worker, judge-batch and other LLM stages)`

**When to change** — Pick the stage you're iterating on. Most teams start with classifier — it has the largest impact per token.

### Traffic percentage

<a id="prompt-lab-traffic-percentage"></a>

`prompt-lab.traffic_percentage`

**Summary** — Share of production traffic that gets this prompt version — 0% to 100%.

**How it works** — A weighted random pick (`prompt-ab.ts`) routes each request to a prompt version based on its `traffic_percentage`. The percentages should sum to 100 across active versions of a stage; the helper normalises if they don't. Live changes apply within seconds — no deploy required.

**Default** — `0% on new versions`

**Where it lives** — table `prompt_versions.traffic_percentage` · endpoint `POST /v1/admin/prompt-lab/prompts` · read by `_shared/prompt-ab.ts (fast-filter, classify-report, fix-worker, judge-batch and other LLM stages)`

**When to change** — Start a new version at 5%, watch the eval scores for 24h, then ramp 25→50→100. Don't flip 0→100 — you lose the ability to A/B against the previous champion.

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Prompt body

<a id="prompt-lab-prompt-body"></a>

`prompt-lab.prompt_body`

**Summary** — The system + user templates the LLM sees, with named slots for runtime variables.

**How it works** — Slots like `{report_text}` and `{recent_events}` get substituted at call time. The body is versioned — saving creates a new `prompt_versions` row, never overwrites an existing one. The previous version stays at its current traffic split until you move it.

**Default** — `shipped baseline (varies by stage)`

**Where it lives** — table `prompt_versions.prompt_template` · endpoint `POST /v1/admin/prompt-lab/prompts` · read by `fast-filter edge function`, `classify-report edge function`, `fix-worker edge function`, `judge-batch edge function`

**When to change** — When eval scores plateau or a new model rewards different prompting style. Tag every change with what you tried, so the changelog is honest.

### Synthetic case count

<a id="prompt-lab-synthetic-count"></a>

`prompt-lab.synthetic_count`

**Summary** — How many synthetic test cases to generate when seeding evals for a new prompt version.

**How it works** — Higher count = more statistical power on eval scores, but also more LLM spend (each case runs both the prompt and the judge). 25 is enough to spot regressions; 100+ is needed to detect <5% delta with confidence.

**Default** — `25` · range `5 – 200`

**Where it lives** — endpoint `POST /v1/admin/synthetic` · read by `generate-synthetic edge function`

**When to change** — Bump to 100 when a regression is suspected and you need confidence; drop to 10 for quick smoke tests during iteration.

## Marketplace plugins

<a id="marketplace-plugins"></a>

### Plugin webhook URL

<a id="marketplace-plugin-webhook-url"></a>

`marketplace.plugin_webhook_url`

**Summary** — Where Mushi POSTs subscribed plugin events — your endpoint receives them.

**How it works** — Every subscribed event fires a signed JSON POST against this URL (public https only). A failed delivery is retried by a per-minute cron, up to 5 attempts in all, with exponential backoff starting at 30 seconds; after the last one the plugin’s last delivery status turns to `error` and the operator is alerted.

**Default** — `unset (plugin disabled)`

**Where it lives** — table `project_plugins.webhook_url` · endpoint `POST /v1/admin/plugins` · read by `_shared/plugins.ts dispatchPluginEvent (api, classify-report, fix-worker, judge-batch, qa-story-runner, status-reconciler, webhooks-linear)`, `plugin-dispatch-retry edge function`

**When to change** — Set when wiring a plugin. Update when your plugin host migrates — the dispatcher honours the new URL on the next event.

### Plugin signing secret

<a id="marketplace-plugin-signing-secret"></a>

`marketplace.plugin_signing_secret`

**Summary** — HMAC secret your plugin verifies on every inbound event so it can trust the payload.

**How it works** — The API requires a secret whenever a webhook URL is set and stores it in Vault; the console pre-fills the field with a random 64-character hex value you can copy or replace. Mushi signs every event with `X-Mushi-Signature: t=<ms>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` and also sends Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`). Your plugin recomputes the HMAC with this secret; mismatch = drop the event.

**Default** — `random value pre-filled by the console (the API requires one; it never generates it)`

**Where it lives** — table `project_plugins.webhook_secret_vault_ref (Vault)` · endpoint `POST /v1/admin/plugins` · read by `_shared/plugins.ts dispatchPluginEvent (api, classify-report, fix-worker, judge-batch, qa-story-runner, status-reconciler, webhooks-linear)`, `plugin-dispatch-retry edge function`

**When to change** — Rotate when the plugin owner changes hands by installing the plugin again with a new secret (editing the plugin never changes it). Always update both ends in lockstep — no overlap window.

### Subscribed events

<a id="marketplace-subscribed-events"></a>

`marketplace.subscribed_events`

**Summary** — List of event types your plugin wants to receive (`report.created`, `report.classified`, `fix.opened`, etc.).

**How it works** — The dispatcher emits to your URL only for events on this list (or every event when the list contains `*`). An empty list also means every event. Keep the list minimal; each event is a webhook delivery your endpoint has to handle.

**Default** — `empty (plugin receives every event)`

**Where it lives** — table `project_plugins.subscribed_events (text[])` · endpoint `POST /v1/admin/plugins` · read by `_shared/plugins.ts dispatchPluginEvent (api, classify-report, fix-worker, judge-batch, qa-story-runner, status-reconciler, webhooks-linear)`

**When to change** — Subscribe only to events your plugin actually reacts to. Adding/removing is instant — no plugin restart required.

## Anti-gaming

<a id="anti-gaming"></a>

### Anti-gaming filter

<a id="anti-gaming-flagged-filter"></a>

`anti-gaming.flagged_filter`

**Summary** — Show only flagged reports, only clean ones, or both — scopes the table without losing your sort state.

**How it works** — Drives the `?flagged=true|false` query param on the reports listing. Pure UI filter — doesn't change underlying data, doesn't mark anything reviewed.

**Default** — `all`

**When to change** — Switch to "flagged only" when investigating a suspected attack pattern. Switch back when you're reviewing the regular bug queue.

### Aggregate identical reports

<a id="anti-gaming-aggregate-identical"></a>

`anti-gaming.aggregate_identical`

**Summary** — Collapses runs of byte-identical reports into a single grouped row with an occurrence count.

**How it works** — When on, the table group-bys on `content_hash` and shows one row per unique payload. Useful when one bot or one bug retries the same submission thousands of times — the grouping makes the actual diversity visible.

**Default** — `on`

**When to change** — Turn off when you need to see the timing distribution of a flood (the per-row timestamps tell you about cadence, the grouped view doesn't).

### Flag reason

<a id="anti-gaming-flag-reason"></a>

`anti-gaming.flag_reason`

**Summary** — Free-text note attached to a flag — explains *why* this report tripped the human reviewer.

**How it works** — Persisted on the flagged reporter device (the fingerprint row, not the report) and logged as a `manual_flag` event in `anti_gaming_events`. The next reviewer (or the LLM, if you wire it through Prompt Lab) can read this when deciding whether the flag still applies.

**Default** — `empty`

**Where it lives** — table `reporter_devices.flag_reason` · endpoint `POST /v1/admin/anti-gaming/devices/:id/flag` · read by `api edge function (GET /v1/admin/anti-gaming/devices)`, `_shared/anti-gaming.ts (report ingest keeps the reason when it updates the device)`

**When to change** — Always fill it in — "flagged with no reason" is the ticket the next person on rotation can't review.

## Notifications

<a id="notifications"></a>

### Show filter

<a id="notifications-show-filter"></a>

`notifications.show_filter`

**Summary** — Picks which notifications appear in the list — `all`, `unread only`, or per-category.

**How it works** — Pure UI filter. Doesn't mark anything as read; doesn't mute future notifications. Persists in the URL so a deep link to "unread severities high+" survives a reload.

**Default** — `unread`

**When to change** — Stay on `unread` for daily review. Flip to `all` when looking for a specific notification you saw last week.

### Type filter

<a id="notifications-type-filter"></a>

`notifications.type_filter`

**Summary** — Filter the list to a single notification type (severity escalation, autofix opened, plugin error, etc.).

**How it works** — Reads `?type=` from the URL. Multi-select isn't supported — pick one type at a time.

**Default** — `all types`

**When to change** — Use when chasing one class of notification (e.g. all "autofix opened") — keeps your inbox legible while you bulk-review.

## Intelligence

<a id="intelligence"></a>

### Benchmarking opt-in

<a id="intelligence-benchmarking-optin"></a>

`intelligence.benchmarking_optin`

**Summary** — When ON, your project contributes anonymised aggregate metrics to cross-customer benchmarks (which then power the Intelligence page comparisons).

**How it works** — The intelligence helper inspects this flag before including a project in a percentile bucket. OFF = your data is never in the buckets, AND you don't see the bucketed share — the Intelligence page falls back to your own historical data.

**Default** — `off`

**Where it lives** — table `project_settings.benchmarking_optin` · endpoint `PUT /v1/admin/settings/benchmarking` · read by `intelligence-report edge function (via _shared/intelligence.ts)`

**When to change** — Turn on if you want "you vs the median customer" comparisons. Keep off for projects under strict NDAs — even anonymised aggregates leak shape information.

## Billing

<a id="billing"></a>

### Plan

<a id="billing-plan"></a>

`billing.plan`

**Summary** — Subscription tier — determines the included LLM credits, MAU cap, and feature gates.

**How it works** — Plan changes go through Stripe Checkout / Customer Portal — Mushi mirrors the new plan id back via webhook. Downgrades are queued to the end of the current period; upgrades take effect immediately and are pro-rated.

**Default** — `free`

**Where it lives** — table `billing_subscriptions.plan_id` · endpoint `(Stripe webhook → stripe-webhooks edge function)` · read by `_shared/entitlements.ts requireFeature (api feature gates)`, `_shared/quota.ts (api report ingest, classify-report quota gate)`

**When to change** — Upgrade when you're consistently hitting the cap on the dashboard. Downgrade only after one full month under the next-tier-down's cap.

### Monthly spend cap

<a id="billing-spend-cap"></a>

`billing.spend_cap`

**Summary** — Hard USD ceiling on overage charges. When projected spend hits the cap, new diagnoses pause gracefully — no surprise invoice.

**How it works** — Stored on billing_subscriptions.monthly_spend_cap_usd_override and enforced in classify-report before Stage-2 runs. Overrides the plan default (Indie $50, Pro $200). Clear the field to revert to the plan default.

**Default** — `plan default`

**Where it lives** — table `billing_subscriptions.monthly_spend_cap_usd_override` · endpoint `PUT /v1/admin/billing/spend-cap` · read by `classify-report quota gate`, `usage-alerts email copy`

**When to change** — Set before a launch or marketing spike. Lower the cap if you want a hard stop; raise it only when you have budget headroom.

### Usage alert email

<a id="billing-alert-email"></a>

`billing.alert_email`

**Summary** — Inbox that receives 50%, 80%, and 100% diagnosis quota alerts for this project.

**How it works** — Stored on project_settings.alert_email. The usage-alerts cron sends at most one email per threshold per billing month. Leave blank to use the project owner email.

**Default** — `project owner email`

**Where it lives** — table `project_settings.alert_email` · endpoint `PUT /v1/admin/billing/alert-email` · read by `usage-alerts edge function`

**When to change** — Point at a shared ops inbox (e.g. billing@yourco.com) when the owner email is a personal Gmail.

### Support subject

<a id="billing-support-subject"></a>

`billing.support_subject`

**Summary** — One-line summary of your support request — the title of the ticket the Mushi team sees.

**How it works** — The contact route (`POST /v1/support/contact` on the api edge function) saves a row in `support_tickets` and posts the subject and the start of the body to the Mushi operators’ Slack or Discord alert channel. You can send at most 5 tickets an hour. Keep it specific (`"Refund for May overage — invoice 1234"`) so support doesn't bounce it back asking for clarification.

**Default** — `empty` · range `3 – 200 characters`

**Where it lives** — table `support_tickets.subject` · endpoint `POST /v1/support/contact` · read by `api edge function (POST /v1/support/contact → operator Slack/Discord alert)`

**When to change** — Always fill before submitting. The route rejects a subject shorter than 3 or longer than 200 characters with a 400.

### Support category

<a id="billing-support-category"></a>

`billing.support_category`

**Summary** — What your support ticket is about — billing, bug, feature request, or other.

**How it works** — Saved on the ticket and shown in the operator alert (and in the audit log when you pick a project), so the right person picks it up. Any value other than billing, bug, feature or other is saved as `other`. Wrong category just means a slower first response, not a lost ticket.

**Default** — `billing`

**Where it lives** — table `support_tickets.category` · endpoint `POST /v1/support/contact` · read by `api edge function (POST /v1/support/contact → operator Slack/Discord alert)`

**When to change** — Always pick the closest match. Use `other` only when nothing else fits.

### Support body

<a id="billing-support-body"></a>

`billing.support_body`

**Summary** — The full text of your support request — paste invoice numbers, screenshots, anything that helps the responder.

**How it works** — Saved as the ticket body, exactly as typed; the operator alert shows the first 800 characters. The route rejects a body shorter than 10 or longer than 5,000 characters with a 400.

**Default** — `empty` · range `10 – 5,000 characters`

**Where it lives** — table `support_tickets.body` · endpoint `POST /v1/support/contact` · read by `api edge function (POST /v1/support/contact → operator Slack/Discord alert)`

**When to change** — Include the invoice id and the dollar amount you're asking about — billing tickets without specifics get bounced.

## Onboarding

<a id="onboarding"></a>

### Project name

<a id="onboarding-project-name"></a>

`onboarding.project_name`

**Summary** — Display name for your first project — visible in the active-project switcher and across the console.

**How it works** — Used for display only. The internal `project_id` is generated and immutable; you can rename freely without breaking SDK keys or webhook subscriptions.

**Default** — `unset`

**Where it lives** — table `projects.name` · endpoint `POST /v1/admin/projects` · read by `api edge function (GET /v1/admin/projects)`, `console ProjectSwitcher`

**When to change** — Set during onboarding. Rename later as your product naming firms up — no migration needed.

### First API key label

<a id="onboarding-first-key-label"></a>

`onboarding.first_key_label`

**Summary** — Human-readable label for the first API key — helps you find and revoke it later.

**How it works** — Saved on the `project_api_keys` row alongside the hash and scopes (trimmed, up to 64 characters). Pure metadata — the value isn't sent to the SDK, doesn't affect ingest behaviour.

**Default** — ``default` if blank (`mcp-readonly` / `mcp-readwrite` for MCP keys)`

**Where it lives** — table `project_api_keys.label` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `api edge function (GET /v1/admin/projects, key list)`, `console Projects page key list`

**When to change** — Use a name that tells future-you what app or env this key belongs to — `"web-prod"`, `"native-staging"`, `"cursor-mcp-kenji"`.

## MCP install

<a id="mcp-install"></a>

### Snippet mode

<a id="mcp-snippet-mode"></a>

`mcp.snippet_mode`

**Summary** — Picks which install snippet you copy — `mcp.json` (Claude Desktop / Cursor) vs `.env.local` (custom MCP host).

**How it works** — Pure UI toggle. The first mode emits a `~/.cursor/mcp.json` block that registers the Mushi MCP server with stdio transport. The second emits an env-var preamble for hosts that read MCP config via env (some self-hosted Claude Desktop forks).

**Default** — `mcp.json`

**When to change** — Use `mcp.json` for off-the-shelf clients. Switch to `.env.local` only if your MCP host doesn't parse `mcp.json` natively.

## SDK install card

<a id="sdk-install-card"></a>

### Widget position

<a id="sdk-install-position"></a>

`sdk-install.position`

**Summary** — Which corner of the user's app the bug-capture trigger pins to — top-left, top-right, bottom-left, bottom-right.

**How it works** — Drives the live preview and the generated `Mushi.init({ widget: { position: '…' }})` call. The widget mounts in a shadow DOM, so the position is independent of the host app's CSS.

**Default** — `bottom-right`

**When to change** — Pick the corner that doesn't collide with your existing chrome (chat bubbles usually live bottom-right, so move Mushi to bottom-left if so).

### Trigger mode

<a id="sdk-install-trigger-mode"></a>

`sdk-install.trigger_mode`

**Summary** — Controls whether Mushi injects its own launcher, pins a slim header banner, attaches to your button, or stays programmatic-only.

**How it works** — Five modes: `banner` (recommended) renders a slim 36 px strip pinned to the top or bottom of the viewport — less obtrusive than a FAB and never competes with bottom navigation. `auto` keeps the default editorial stamp button. `edge-tab` pins a vertical tab to the viewport edge. `attach` hides the default button and binds to `attachToSelector`. `manual` / `hidden` render no launcher — call `Mushi.open()` programmatically. The banner's body padding is adjusted automatically on mount and removed on dismiss, sdk.hide(), route suppression, or destroy().

**Default** — `auto`

**When to change** — Use `banner` for beta apps and user-research builds — maximises discoverability with minimal layout intrusion. Use `attach` for mature production apps with a help menu. Use `edge-tab` on tablet or when bottom nav competes. Use `manual` on regulated or fullscreen flows.

**Learn more** — [Trigger modes](https://kensaur.us/mushi-mushi/docs/concepts/trigger-modes)

### Banner launcher options

<a id="sdk-install-banner-config"></a>

`sdk-install.banner_config`

**Summary** — Customise the header-banner launcher: visual variant, position (top / bottom), announcement copy, and button labels.

**How it works** — Only applies when `trigger_mode` is `banner`. `variant`: `neon` = electric-lime dev/beta aesthetic; `brand` = vermillion editorial feel; `subtle` = hairline muted strip. `position`: `top` pushes the page down; `bottom` lifts content up. `bannerMessage` + `bannerLabel` switch the strip to the rich admin-console layout (Beta pill + announcement line + flat text CTAs). `bugCta` / `featureCta` / `featureCtaLabel` let you relabel the buttons for your audience. Configure live in the console — the SDK picks up changes without re-init via the same runtime config pull that handles all other settings.

**Default** — `variant: brand · position: top · featureCta: true`

**Where it lives** — table `project_settings.sdk_banner_variant / sdk_banner_position / sdk_banner_message / sdk_banner_label / sdk_banner_bug_cta / sdk_banner_feature_cta` · endpoint `PATCH /v1/admin/settings` · read by `api edge function (GET /v1/sdk/config)`

**When to change** — Use `subtle` when the banner must blend into a polished production UI. Use `neon` for internal beta tools where high visibility matters. Switch `position` to `bottom` when your app has a sticky top header that would collide with the banner.

### Smart hide

<a id="sdk-install-smart-hide"></a>

`sdk-install.smart_hide`

**Summary** — Lets the launcher shrink, hide, or become an edge tab on mobile and while the user scrolls.

**How it works** — The SDK listens for scroll and viewport changes inside the host app and adjusts only the launcher, not the capture pipeline. Reports can still be opened programmatically while the trigger is hidden or shrunk.

**Default** — `off in 0.6; planned default after dogfood`

**When to change** — Enable on consumer apps where the report button competes with bottom navigation, media controls, chat bubbles, or primary checkout CTAs.

**Learn more** — [Trigger modes](https://kensaur.us/mushi-mushi/docs/concepts/trigger-modes)

### Widget theme

<a id="sdk-install-theme"></a>

`sdk-install.theme`

**Summary** — Light, dark, or auto — auto follows the user's `prefers-color-scheme` media query.

**How it works** — Auto re-evaluates on system theme change so the widget never goes white-on-white when the user toggles dark mode at night. Light/dark force the theme regardless of system preference.

**Default** — `auto`

**When to change** — Force `light` or `dark` when your app explicitly ignores system preference (rare). Otherwise stay on auto for the best a11y default.

### Trigger text

<a id="sdk-install-trigger-text"></a>

`sdk-install.trigger_text`

**Summary** — Short label shown next to the bug-capture trigger button (or hidden if the button is icon-only).

**How it works** — Localise this for non-English audiences (e.g. `バグ報告` for Japanese). Empty string = icon-only mode, which saves space but loses the affordance for first-time users.

**Default** — `Report`

**When to change** — Localise to your audience's language. Lengthen to "Report a bug" for novice users; shorten to "" for power users.

### Capture console

<a id="sdk-install-capture-console"></a>

`sdk-install.capture_console`

**Summary** — Attaches the most recent console logs (configurable depth) to every bug report.

**How it works** — A ring buffer wraps `console.log/warn/error` and keeps the last N entries. On report submit, the buffer is serialised and uploaded as part of the artifacts payload. No effect on production console behaviour — entries still print normally.

**Default** — `on`

**When to change** — Turn off in apps that log secrets to the console (rare and a smell). Keep on for everyday debugging.

### Capture network

<a id="sdk-install-capture-network"></a>

`sdk-install.capture_network`

**Summary** — Attaches the most recent fetch/XHR requests + responses to every bug report.

**How it works** — Hooks `fetch` and `XMLHttpRequest` to record method, URL, status, timing, and (optionally) bodies. Bodies are scrubbed of common secret patterns before upload, but the SDK errs on the side of NOT capturing bodies by default.

**Default** — `on (headers/timing only)`

**When to change** — Disable on apps with PII-laden API traffic (medical, financial). Enable bodies temporarily when investigating a hard-to-repro API bug.

### Capture performance

<a id="sdk-install-capture-performance"></a>

`sdk-install.capture_performance`

**Summary** — Attaches Web Vitals (LCP, INP, CLS) and recent `PerformanceObserver` entries to bug reports.

**How it works** — Subscribes to the standard `web-vitals` library hooks. Attached as a small JSON blob on the report — useful for "the page felt slow" reports the user can't describe more precisely.

**Default** — `on`

**When to change** — Keep on for consumer apps where perf matters. Turn off for internal tools where noise outweighs signal.

### Capture element picker

<a id="sdk-install-capture-element-picker"></a>

`sdk-install.capture_element_picker`

**Summary** — Lets the user click an on-page element while filing a report; the CSS selector is attached.

**How it works** — Adds a "Pick element" affordance to the in-widget form. On selection, the SDK computes a stable selector (id → data-test → class chain) and stamps it on the report payload.

**Default** — `on`

**When to change** — Turn off in apps where users describe bugs textually (forms, dashboards). Keep on for visually-rich apps where pointing > typing.

### Screenshot mode

<a id="sdk-install-screenshot-mode"></a>

`sdk-install.screenshot_mode`

**Summary** — When the SDK captures a screenshot — when the report opens, always (continuous), or never.

**How it works** — `on-report` is the default and respects user privacy. `auto` captures every few seconds (more diagnostic context, but storage-heavy). `off` disables screenshots entirely (compliance-friendly).

**Default** — `on-report`

**When to change** — Stay on `on-report` for most apps. Switch to `auto` for hard-to-repro intermittent bugs. Switch to `off` for HIPAA-style apps where any screenshot is a privacy risk.

### Screenshot privacy caption

<a id="sdk-install-screenshot-sensitive-hint"></a>

`sdk-install.screenshot_sensitive_hint`

**Summary** — A short "don't share sensitive information" caption shown under the screenshot preview before a reporter submits.

**How it works** — When on, the widget shows the preview the reporter is about to send plus a privacy caption so they can redact or drop it first. Leave the custom box empty to use the SDK's localized default copy, type your own to override it, or turn the caption off entirely. Surfaces as `widget.screenshotSensitiveHint` in GET /v1/sdk/config and is honored by both the web and React Native widgets.

**Default** — `on (default caption)`

**Where it lives** — table `project_settings.sdk_screenshot_sensitive_hint` · endpoint `PUT /v1/admin/projects/:id/sdk-config` · read by `api edge function (GET /v1/sdk/config)`, `@mushi-mushi/web widget`, `@mushi-mushi/react-native widget`

**When to change** — Keep on for any app that captures screenshots — it is the reporter's chance to catch PII. Customize the copy to match your tone or compliance wording. Turn off only when screenshots are disabled or never contain user data.

**Learn more** — [Screenshot preview docs](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_SCREENSHOT_PREVIEW.md)

### Framework tab

<a id="sdk-install-framework"></a>

`sdk-install.framework`

**Summary** — Picks which framework's install snippet you copy — React, Vue, Svelte, React Native, Expo, Capacitor, or Vanilla.

**How it works** — Pure UI toggle. Web frameworks (React/Vue/Svelte/Vanilla) wire up `Mushi.init()` from `@mushi-mushi/web` via the right adapter so framework error boundaries get hooked. Mobile frameworks (React Native / Expo) ship their own `<MushiProvider>` from `@mushi-mushi/react-native`. Capacitor uses the dedicated `@mushi-mushi/capacitor` plugin with `Mushi.configure(...)` and a follow-up `npx cap sync`.

**Default** — `react`

**When to change** — Pick whatever your app uses. Vanilla is the right answer for non-framework apps. For Capacitor → React Native migrations, see https://kensaur.us/mushi-mushi/docs/migrations/capacitor-to-react-native.

## Settings → Page-aware assistant

<a id="settings-page-aware-assistant"></a>

### Page-aware assistant

<a id="assistant-config-enabled"></a>

`assistant.config.enabled`

**Summary** — Adds an "Ask" tab to the SDK widget so users get answers about your app, grounded only in the page they're on and the knowledge you author.

**How it works** — Turns on an Ask tab in the widget when enabled. Each question hits POST /v1/sdk/assistant, which grounds answers in the published page context plus your knowledge corpus — it never reads user rows, source, or env. Uses your project LLM key (Anthropic primary, OpenAI fallback) and logs every turn.

**Default** — `false (off)`

**Where it lives** — table `project_settings.assistant_enabled` · endpoint `PUT /v1/admin/projects/:id/assistant` · read by `api edge function (POST /v1/sdk/assistant)`, `api edge function (GET /v1/sdk/config)`

**When to change** — Turn on once you have written a knowledge corpus (Advanced). Leave off if you only want bug reporting — the widget works fully without it.

**Learn more** — [Assistant docs](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_ASSISTANT.md)

### Tab label

<a id="assistant-config-label"></a>

`assistant.config.label`

**Summary** — The label shown on the assistant tab in the widget (e.g. "Ask").

**How it works** — Pure display string, capped at 24 chars. Returned in the SDK config so the widget can localise the tab without a rebuild.

**Default** — `Ask`

**Where it lives** — table `project_settings.assistant_label` · endpoint `PUT /v1/admin/projects/:id/assistant` · read by `api edge function (GET /v1/sdk/config)`

**When to change** — Rename to match your product voice ("Help", "Guide", "Concierge").

### Greeting

<a id="assistant-config-greeting"></a>

`assistant.config.greeting`

**Summary** — First message shown on an empty assistant thread.

**How it works** — Display-only, capped at 400 chars. Shown before the user types anything; it does not prime the LLM.

**Default** — `Hi! Ask me anything about this page.`

**Where it lives** — table `project_settings.assistant_greeting` · endpoint `PUT /v1/admin/projects/:id/assistant` · read by `api edge function (GET /v1/sdk/config)`

**When to change** — Set expectations — tell users what the assistant can and cannot help with.

### Starter questions

<a id="assistant-config-suggestions"></a>

`assistant.config.suggestions`

**Summary** — Up to 6 tappable starter-question chips shown on an empty thread.

**How it works** — Stored as a JSON array of strings (each ≤ 120 chars, max 6). The widget renders them as one-tap prompts to lower the cold-start barrier.

**Default** — `unset (no chips)`

**Where it lives** — table `project_settings.assistant_suggestions` · endpoint `PUT /v1/admin/projects/:id/assistant` · read by `api edge function (GET /v1/sdk/config)`

**When to change** — Seed with your top 3-6 FAQs so first-time users see what to ask.

### App knowledge corpus

<a id="assistant-config-knowledge"></a>

`assistant.config.knowledge`

**Summary** — Operator-authored text the assistant may cite — features, pricing, how-tos, FAQs. Capped at 40k chars and secret-scanned on save.

**How it works** — This is the only grounding source besides the live page context. It is sent to the LLM on every turn, so it must never contain secrets — the save endpoint rejects text matching key/token/connection-string patterns (SECRET_DETECTED). Never returned in the public SDK config.

**Default** — `unset` · range `max 40,000 chars`

**Where it lives** — table `project_settings.assistant_knowledge` · endpoint `PUT /v1/admin/projects/:id/assistant` · read by `api edge function (POST /v1/sdk/assistant)`

**When to change** — Expand it whenever users ask something the assistant could not answer. Review recent turns in Advanced → logs to find gaps. Never paste keys, tokens, or source.

