# Mushi Mushi · Configuration reference

> Auto-generated from [`apps/admin/src/lib/configDocs.ts`](../apps/admin/src/lib/configDocs.ts).
> Do not edit by hand — run `pnpm gen:config-docs` instead.

_91 configuration knobs across 18 sections · last regenerated 2026-05-04._

Every knob in the admin console has an in-app `i` icon next to it that opens a longer-form explanation. The same content is mirrored here so you can search, link, and review configuration choices outside the app.

## Contents

- [Settings → General](#settings-general) (7)
- [Settings → BYOK (LLM keys)](#settings-byok-llm-keys-) (3)
- [Settings → Firecrawl (web research)](#settings-firecrawl-web-research-) (3)
- [Settings → Dev tools](#settings-dev-tools) (1)
- [Projects](#projects) (6)
- [Integrations](#integrations) (20)
- [Storage (BYO)](#storage-byo-) (9)
- [Compliance](#compliance) (7)
- [SSO](#sso) (4)
- [Prompt Lab](#prompt-lab) (4)
- [Marketplace plugins](#marketplace-plugins) (3)
- [Anti-gaming](#anti-gaming) (3)
- [Notifications](#notifications) (2)
- [Intelligence](#intelligence) (1)
- [Billing](#billing) (4)
- [Onboarding](#onboarding) (2)
- [MCP install](#mcp-install) (1)
- [SDK install card](#sdk-install-card) (11)

## Settings → General

<a id="settings-general"></a>

### Slack Webhook URL

<a id="settings-general-slack-webhook-url"></a>

`settings.general.slack_webhook_url`

**Summary** — Mushi posts new high-severity reports and weekly digests to this Slack webhook.

**How it works** — When a report exits triage at severity ≥ high (or via the weekly summary cron), the notifier fires a single POST against this URL with a formatted Slack Block Kit payload. Leave blank to disable Slack delivery without affecting in-app notifications.

**Default** — `unset (Slack disabled)`

**Where it lives** — table `project_settings.slack_webhook_url` · endpoint `PATCH /v1/admin/settings` · read by `notify-slack edge function`

**When to change** — Set this on day 1 if your team triages from Slack. Rotate it whenever the channel owner changes — webhooks don't expire, so a stale URL keeps posting until you replace it.

### Sentry DSN

<a id="settings-general-sentry-dsn"></a>

`settings.general.sentry_dsn`

**Summary** — Project DSN used to forward Mushi reports back into Sentry as events.

**How it works** — Optional outbound integration. When set, classified reports get sent to Sentry as `captureException`-style events with the report id and severity attached, so the Sentry → Mushi loop can be closed without leaving either tool.

**Default** — `unset (no forwarding)`

**Where it lives** — table `project_settings.sentry_dsn` · endpoint `PATCH /v1/admin/settings` · read by `report-to-sentry forwarder`

**When to change** — Add this if you want Mushi reports visible in Sentry dashboards alongside crash data. Skip it if Sentry is purely the source — the Integrations page handles inbound webhooks separately.

### Sentry Webhook Secret

<a id="settings-general-sentry-webhook-secret"></a>

`settings.general.sentry_webhook_secret`

**Summary** — Shared HMAC secret that authenticates inbound Sentry user-feedback webhooks.

**How it works** — The Sentry webhook handler verifies the `Sentry-Hook-Signature` HMAC against this secret before it accepts a payload. Mismatch → 401, the report is dropped. The same value must be set in Sentry → Settings → Webhooks.

**Default** — `unset (inbound disabled)`

**Where it lives** — table `project_settings.sentry_webhook_secret` · endpoint `PATCH /v1/admin/settings` · read by `sentry-webhook edge function`

**When to change** — Set this once when wiring inbound Sentry user feedback. Rotate it together with the Sentry-side value — never one without the other or every payload starts failing signature verification.

### Consume Sentry User Feedback

<a id="settings-general-sentry-consume-user-feedback"></a>

`settings.general.sentry_consume_user_feedback`

**Summary** — When enabled, Sentry user-feedback submissions are mirrored into the Mushi report queue.

**How it works** — Drives the inbound webhook handler. With the toggle on, every Sentry user-feedback event creates a fresh report (deduplicated by Sentry event id). With it off, payloads are acknowledged but ignored — useful when you want webhook signing wired without yet doubling your queue volume.

**Default** — `true`

**Where it lives** — table `project_settings.sentry_consume_user_feedback` · endpoint `PATCH /v1/admin/settings` · read by `sentry-webhook edge function`

**When to change** — Turn off temporarily when piloting Sentry on a noisy public app — re-enable once you're happy with the volume and your routing rules are in place.

### Stage 2 Model

<a id="settings-general-stage2-model"></a>

`settings.general.stage2_model`

**Summary** — The LLM that classifies reports after Stage 1 fast-filter passes them through.

**How it works** — Stage 2 is the deep classifier — it labels severity, category, intent, dedup hints, and reproduction steps. The choice trades cost vs depth: Sonnet 4.6 is the recommended default; Opus is slow but catches subtle cases; Haiku is cheap but rougher. The selected model is read on every report, so changes apply immediately to new traffic.

**Default** — `claude-sonnet-4-6`

**Where it lives** — table `project_settings.stage2_model` · endpoint `PATCH /v1/admin/settings` · read by `classify-report edge function`

**When to change** — Stay on Sonnet 4.6 unless cost is biting (drop to Haiku) or you're finding misses on subtle pattern reports (try Opus on a small slice via Prompt Lab first).

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Stage 1 Confidence Threshold

<a id="settings-general-stage1-confidence-threshold"></a>

`settings.general.stage1_confidence_threshold`

**Summary** — How sure the fast-filter must be that a report is junk before it auto-rejects it.

**How it works** — Every inbound report runs through Stage 1 (Haiku 4.5). If the model says "this is spam/test/noise" with confidence ≥ this threshold, the report is dropped before Stage 2 spends tokens on it. Higher = more strict (more reports survive to Stage 2, fewer false drops); lower = more aggressive culling (cheaper, slightly more false drops).

**Default** — `0.85` · range `0.50 – 0.99`

**Where it lives** — table `project_settings.stage1_confidence_threshold` · endpoint `PATCH /v1/admin/settings` · read by `fast-filter edge function`

**When to change** — Raise to 0.90+ if you suspect Stage 1 is dropping real reports (check Anti-Gaming for "fast-filter rejected" with low confidence margins). Lower to ~0.70 if a public-facing form is flooding the queue with obvious noise.

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Dedup Similarity Threshold

<a id="settings-general-dedup-threshold"></a>

`settings.general.dedup_threshold`

**Summary** — Cosine similarity above which two reports are merged as duplicates instead of stored separately.

**How it works** — After Stage 2, a pgvector lookup finds the nearest existing report by embedding distance. If similarity ≥ this value, the new report is attached to the existing cluster (its `dup_of` points at the canonical id and the cluster's occurrence count ticks up). Below it, the report stays separate.

**Default** — `0.82` · range `0.50 – 0.99`

**Where it lives** — table `project_settings.dedup_threshold` · endpoint `PATCH /v1/admin/settings` · read by `classify-report edge function`

**When to change** — Raise to 0.88+ if you're seeing false merges (different bugs being lumped together). Lower to ~0.75 if duplicate clusters look thin and the same regression keeps appearing as separate reports.

## Settings → BYOK (LLM keys)

<a id="settings-byok-llm-keys-"></a>

### Anthropic (Claude) API Key

<a id="settings-byok-anthropic-key"></a>

`settings.byok.anthropic_key`

**Summary** — BYOK key powering Stage 1 fast-filter, Stage 2 classifier, vision analysis, and the LLM fix agent.

**How it works** — Stored in Supabase Vault — only a `vault://<id>` reference lives in `project_settings`. Every LLM call resolves the key at request time, so rotation is instant. When unset, the pipeline falls back to the platform default (if your plan includes one).

**Default** — `unset (uses platform default)`

**Where it lives** — table `project_settings.byok_anthropic_key_ref (vault://…)` · endpoint `PUT /v1/admin/byok/anthropic` · read by `fast-filter`, `classify-report`, `fix-worker edge functions`

**When to change** — Set on day 1 if your plan is BYOK-only. Rotate when an engineer with key access leaves, or when Anthropic's usage console shows unfamiliar traffic.

**Learn more** — [Self-hosting & BYOK setup](https://kensaur.us/mushi-mushi/docs/self-hosting)

### OpenAI / OpenRouter API Key

<a id="settings-byok-openai-key"></a>

`settings.byok.openai_key`

**Summary** — BYOK key for the OpenAI-compatible fallback path (and OpenRouter / Together / Fireworks gateways).

**How it works** — Used as the automatic failover when Anthropic 5xxs, and as the judge fallback in the autofix loop. Pair with the Base URL preset chips below to route the same key through any OpenAI-compatible gateway without code changes.

**Default** — `unset (failover disabled)`

**Where it lives** — table `project_settings.byok_openai_key_ref (vault://…)` · endpoint `PUT /v1/admin/byok/openai` · read by `fast-filter`, `classify-report`, `judge edge functions`

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

**Summary** — BYOK key for the optional web-research provider. Used by Research, fix-augmentation, and the library modernizer.

**How it works** — Stored in Supabase Vault. When set, three flows light up: the Research page can crawl arbitrary URLs during triage; the fix-worker pulls the top-3 web snippets when local RAG is sparse; a weekly cron scrapes release notes for outdated dependencies and files modernization reports.

**Default** — `unset (web research disabled)`

**Where it lives** — table `project_settings.firecrawl_api_key_ref (vault://…)` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `research`, `fix-worker`, `library-modernizer edge functions`

**When to change** — Add this once you start seeing autofix attempts hit a wall on "library X changed its API". Skip it for offline-first projects or fully air-gapped deployments.

### Firecrawl Allowed Domains

<a id="settings-firecrawl-allowed-domains"></a>

`settings.firecrawl.allowed_domains`

**Summary** — Domain allowlist that bounds which hosts Firecrawl can scrape on your behalf.

**How it works** — One host per line. The shared crawler helper rejects any URL whose host doesn't match an entry — exact match, no wildcards, no subdomain implied. An empty list means unrestricted (the crawler accepts any reachable host).

**Default** — `empty (unrestricted)`

**Where it lives** — table `project_settings.firecrawl_allowed_domains` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `_shared/firecrawl helper (research, fix-worker, library-modernizer)`

**When to change** — Lock this down to your stack's docs (`react.dev`, `nextjs.org`, `developer.mozilla.org`, etc.) when compliance demands provenance for any external content the LLM sees. Leave empty for open exploration during early adoption.

### Firecrawl Max Pages per Call

<a id="settings-firecrawl-max-pages-per-call"></a>

`settings.firecrawl.max_pages_per_call`

**Summary** — Hard cap on pages a single Firecrawl crawl can fetch — prevents one bad request from draining your quota.

**How it works** — The crawler helper caps each `crawlAndScrape` invocation at this number, regardless of what the calling code asks for. Caps stack: this is the per-call ceiling, on top of any per-day quota set by Firecrawl.

**Default** — `5` · range `1 – 20`

**Where it lives** — table `project_settings.firecrawl_max_pages_per_call` · endpoint `PUT /v1/admin/byok/firecrawl` · read by `_shared/firecrawl helper`

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

**How it works** — Project names appear in the switcher, on every report, and in webhook payloads — keep them recognisable to humans. Slugs are auto-derived from the name (lowercased, hyphenated) and used in URLs / API keys, so very short or generic names produce ambiguous slugs across orgs.

**Default** — `unset (you must pick a name)`

**Where it lives** — table `projects.name` · endpoint `POST /v1/admin/projects` · read by `ProjectSwitcher`, `every admin endpoint that scopes by project`

**When to change** — Set when adding a new app, environment, or customer. Rename later via the API if your team rebrands — slugs persist, names don't affect routing.

### API key scope preset

<a id="projects-api-key-scope"></a>

`projects.api_key_scope`

**Summary** — Picks the capability bundle a freshly minted API key gets — SDK ingest, MCP read, or MCP read + write.

**How it works** — Each preset maps to one or more raw scopes stored on `project_api_keys.scopes`. Edge functions check the scope before serving the call, so a leaked SDK key can't suddenly start mutating state. Mirror of the check constraint in migration `20260421003000_api_key_scopes.sql`.

**Default** — `SDK ingest (report:write only)`

**Where it lives** — table `project_api_keys.scopes (jsonb)` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `report-ingest edge function`, `mcp server (@mushi-mushi/mcp)`

**When to change** — Pick `SDK ingest` for keys you ship inside a browser bundle. Pick `MCP read-only` for safely letting an agent browse triage. Only pick `MCP read + write` for trusted local clients with an audit trail.

### Key scope: report:write

<a id="projects-key-scope-report-write"></a>

`projects.key_scope.report_write`

**Summary** — Allows the API key to ingest new reports via the public report endpoint.

**How it works** — Required for the SDK to submit user-reported bugs. Without this scope, `POST /v1/reports` returns 403. Safe to ship in browser bundles — the Edge Function rate-limits per IP and validates payload shape before storing anything.

**Default** — `enabled by default for new keys`

**Where it lives** — table `project_api_keys.scopes (jsonb)` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `report-ingest edge function`

**When to change** — Always grant this for keys used by the SDK. Drop it for back-office keys that only need to read state (admin dashboards, MCP read-only).

### Key scope: mcp:read

<a id="projects-key-scope-mcp-read"></a>

`projects.key_scope.mcp_read`

**Summary** — Lets the MCP server expose read-only resources (reports, projects, prompts) to LLM clients.

**How it works** — The MCP server bundled at `packages/mcp` reads this scope to decide which tools / resources to register. Without it, only the public health-probe tools work.

**Default** — `disabled by default — opt-in via the mint dialog`

**Where it lives** — table `project_api_keys.scopes (jsonb)` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `mcp server (@mushi-mushi/mcp)`

**When to change** — Grant on keys you paste into Claude Desktop / Cursor / Cline so the LLM can read your triage queue. Pair with `mcp:write` only if you want the LLM to mutate state.

### Key scope: mcp:write

<a id="projects-key-scope-mcp-write"></a>

`projects.key_scope.mcp_write`

**Summary** — Allows MCP tool calls to mutate state — close reports, dispatch fixes, post comments.

**How it works** — Mutating MCP tools (`close_report`, `dispatch_fix`, etc.) gate on this scope. Add it sparingly — anything an LLM can call from a paste-able key, an attacker with the same key can call too.

**Default** — `disabled by default`

**Where it lives** — table `project_api_keys.scopes (jsonb)` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `mcp server (@mushi-mushi/mcp)`

**When to change** — Only when you've scoped the key to a single trusted client (e.g. one developer's Cursor) and have an audit trail in place. Revoke + re-mint on personnel changes.

### Active Project

<a id="projects-active-project"></a>

`projects.active_project`

**Summary** — Picks which project's data the entire admin operates on for this session.

**How it works** — Every admin API call carries the active project id as a header. Switching here re-issues all queries — there's no manual "reload everything" step. Persisted per-user in your auth profile, so each operator can have their own default.

**Default** — `first project the user has access to`

**Where it lives** — table `auth.users / user_profile.active_project_id` · endpoint `PATCH /v1/admin/me/active-project` · read by `every admin API endpoint`

**When to change** — Switch when triaging across multiple apps. For SSO orgs, ask the workspace owner to scope your invite so the picker only shows projects you should see.

## Integrations

<a id="integrations"></a>

### Sentry org slug

<a id="integrations-sentry-org-slug"></a>

`integrations.sentry.org_slug`

**Summary** — Identifies your Sentry organization in API calls — the bit after `sentry.io/organizations/`.

**How it works** — Used to scope every Sentry API call (issues, events, Seer root-cause). Wrong slug → 404 on every request and the integration goes red.

**Default** — `unset`

**Where it lives** — table `platform_integrations.config.sentry_org_slug` · endpoint `PUT /v1/admin/integrations/sentry` · read by `sentry-enricher edge function`

**When to change** — Set once at install. Update only if Sentry renames your org (rare).

### Sentry project slug

<a id="integrations-sentry-project-slug"></a>

`integrations.sentry.project_slug`

**Summary** — The specific Sentry project Mushi correlates against for stack traces and breadcrumbs.

**How it works** — Scopes the event search when enriching a report. Leave blank to search across all projects under the org (slower; recommended only for tiny orgs).

**Default** — `unset (org-wide search)`

**Where it lives** — table `platform_integrations.config.sentry_project_slug` · endpoint `PUT /v1/admin/integrations/sentry` · read by `sentry-enricher edge function`

**When to change** — Set this whenever you have more than one Sentry project — the speed-up on enrichment is significant.

### Sentry auth token

<a id="integrations-sentry-auth-token"></a>

`integrations.sentry.auth_token`

**Summary** — User-level Sentry token granting `project:read` + `event:read` for enrichment lookups.

**How it works** — Stored as a vault reference (`vault://id`) — never in plaintext. The enricher uses it to fetch the matching event payload for a report.

**Default** — `unset (enrichment disabled)`

**Where it lives** — table `platform_integrations.config.sentry_auth_token_ref` · endpoint `PUT /v1/admin/integrations/sentry` · read by `sentry-enricher edge function`

**When to change** — Rotate quarterly, or whenever the issuing user leaves the org.

### Langfuse host

<a id="integrations-langfuse-host"></a>

`integrations.langfuse.host`

**Summary** — Base URL of your Langfuse instance — cloud or self-hosted.

**How it works** — Every LLM call (Stage 1, Stage 2, fix-worker, judge) emits a trace to this host. Stripped of trailing slashes server-side, so paste either form.

**Default** — `unset (tracing disabled)`

**Where it lives** — table `platform_integrations.config.langfuse_host` · endpoint `PUT /v1/admin/integrations/langfuse` · read by `fast-filter`, `classify-report`, `fix-worker`, `judge`

**When to change** — Set on day 1 — tracing is the only way to see what the LLM actually saw when it misclassifies.

### Langfuse public key

<a id="integrations-langfuse-public-key"></a>

`integrations.langfuse.public_key`

**Summary** — Pairs with the secret key for HTTP Basic auth against the Langfuse ingest endpoint.

**How it works** — Sent as the username portion of every trace POST. Safe to commit — the secret key is what gates writes.

**Default** — `unset`

**Where it lives** — table `platform_integrations.config.langfuse_public_key_ref` · endpoint `PUT /v1/admin/integrations/langfuse` · read by `LLM observability layer`

**When to change** — Rotate together with the secret key whenever you suspect either is leaked.

### Langfuse secret key

<a id="integrations-langfuse-secret-key"></a>

`integrations.langfuse.secret_key`

**Summary** — Pairs with the public key — gates trace writes from Mushi to Langfuse.

**How it works** — Stored as a vault reference. Sent as the password portion of HTTP Basic auth on every trace POST.

**Default** — `unset`

**Where it lives** — table `platform_integrations.config.langfuse_secret_key_ref` · endpoint `PUT /v1/admin/integrations/langfuse` · read by `LLM observability layer`

**When to change** — Rotate quarterly, or immediately on any suspicion of leak.

### GitHub repo URL

<a id="integrations-github-repo-url"></a>

`integrations.github.repo_url`

**Summary** — The code repository the auto-fix worker opens draft PRs against.

**How it works** — Full HTTPS URL (SSH URLs are normalised). The fix-worker clones the default branch, applies the LLM patch on a feature branch, and pushes a draft PR with the report id in the body.

**Default** — `unset (autofix disabled)`

**Where it lives** — table `platform_integrations.config.github_repo_url` · endpoint `PUT /v1/admin/integrations/github` · read by `fix-worker edge function`

**When to change** — Set when you graduate from "triage only" to "Mushi opens PRs". Typically the production repo, not a sandbox.

### GitHub default branch

<a id="integrations-github-default-branch"></a>

`integrations.github.default_branch`

**Summary** — Branch the fix-worker checks out before applying the LLM-generated patch.

**How it works** — Defaults to `main` when blank. Override for repos that branch from `master`, `develop`, or a release line. The branch name is also used as the PR base.

**Default** — `main`

**Where it lives** — table `platform_integrations.config.github_default_branch` · endpoint `PUT /v1/admin/integrations/github` · read by `fix-worker edge function`

**When to change** — Change only if your repo's default isn't `main` — otherwise leaving it blank is the right answer.

### GitHub installation token

<a id="integrations-github-installation-token"></a>

`integrations.github.installation_token`

**Summary** — GitHub App installation token (preferred) or fine-grained PAT used to push branches and open PRs.

**How it works** — Needs `Contents:write` + `Pull requests:write` on the target repo. Stored as a vault reference. App tokens are preferred — they auto-rotate and have a shorter blast radius than PATs.

**Default** — `unset`

**Where it lives** — table `platform_integrations.config.github_installation_token_ref` · endpoint `PUT /v1/admin/integrations/github` · read by `fix-worker edge function`

**When to change** — Re-issue when the GitHub App is uninstalled/reinstalled, or when a PAT hits its expiry.

### GitHub webhook secret

<a id="integrations-github-webhook-secret"></a>

`integrations.github.webhook_secret`

**Summary** — HMAC secret that authenticates inbound check-run / check-suite webhooks from GitHub.

**How it works** — Mushi's webhook handler verifies the `X-Hub-Signature-256` header against this secret. Without a match → 401, the event is dropped. The same value must be set in the GitHub repo Settings → Webhooks.

**Default** — `unset (CI sync disabled)`

**Where it lives** — table `platform_integrations.config.github_webhook_secret` · endpoint `PUT /v1/admin/integrations/github` · read by `github-webhook edge function`

**When to change** — Set this once you want PR check-run conclusions (CI passing/failing) reflected in the Auto-Fix Pipeline UI.

### Jira base URL

<a id="integrations-routing-jira-base-url"></a>

`integrations.routing.jira.base_url`

**Summary** — Your Atlassian Cloud or Server base URL — issues and links resolve relative to this.

**How it works** — Used to build issue URLs (`{baseUrl}/browse/{key}`) and as the API host for create/update calls. Cloud URLs typically end in `.atlassian.net`.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.baseUrl` · endpoint `POST /v1/admin/routing` · read by `route-to-jira edge function`

**When to change** — Update if Atlassian migrates your tenant or you self-host Jira behind a new domain.

### Jira user email

<a id="integrations-routing-jira-email"></a>

`integrations.routing.jira.email`

**Summary** — Atlassian account email that owns the API token below — Jira pairs them as basic auth.

**How it works** — Sent as the username for every Jira request. Pair with the API token in the next field.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.email` · endpoint `POST /v1/admin/routing` · read by `route-to-jira edge function`

**When to change** — Set this to a service account, not a real human — service accounts survive offboarding.

### Jira API token

<a id="integrations-routing-jira-api-token"></a>

`integrations.routing.jira.api_token`

**Summary** — Atlassian API token paired with the email above for basic auth.

**How it works** — Stored as vault reference. Create at id.atlassian.com → Security → API tokens.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.apiToken` · endpoint `POST /v1/admin/routing` · read by `route-to-jira edge function`

**When to change** — Rotate quarterly. Re-issue immediately if the owning email changes.

### Jira project key

<a id="integrations-routing-jira-project-key"></a>

`integrations.routing.jira.project_key`

**Summary** — Short uppercase code that prefixes every issue in the target project (e.g. `BUG`, `MUSHI`).

**How it works** — Used in the `POST /rest/api/3/issue` payload as `fields.project.key`. The created issues get keys like `BUG-123`. Wrong key → Jira rejects the create call.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.projectKey` · endpoint `POST /v1/admin/routing` · read by `route-to-jira edge function`

**When to change** — Change to route to a different Jira project — typically when the support team owns a new tracker.

### Linear API key

<a id="integrations-routing-linear-api-key"></a>

`integrations.routing.linear.api_key`

**Summary** — Personal API key used to mirror reports as Linear issues.

**How it works** — Sent as the `Authorization` header on every Linear GraphQL call. Stored as vault reference. Generate at Linear → Settings → API → Personal API keys.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.apiKey` · endpoint `POST /v1/admin/routing` · read by `route-to-linear edge function`

**When to change** — Rotate when the issuing user changes role. Linear keys don't auto-expire, so quarterly review is wise.

### Linear team ID

<a id="integrations-routing-linear-team-id"></a>

`integrations.routing.linear.team_id`

**Summary** — UUID of the Linear team that should receive mirrored issues.

**How it works** — Used as the `teamId` argument on `issueCreate`. Find it in Linear → Settings → API → "Find your team ID".

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.teamId` · endpoint `POST /v1/admin/routing` · read by `route-to-linear edge function`

**When to change** — Update when re-routing to a different team — e.g. moving from Triage to Engineering once the team grows.

### GitHub Issues PAT

<a id="integrations-routing-github-issues-token"></a>

`integrations.routing.github_issues.token`

**Summary** — Fine-grained PAT with `Issues:write` on the public-tracker repo.

**How it works** — Distinct from the auto-fix repo PAT — this one targets the tracker repo (often public), not the code repo. Stored as vault reference.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.token` · endpoint `POST /v1/admin/routing` · read by `route-to-github-issues edge function`

**When to change** — Use when you want a public-facing changelog of triaged bugs without exposing your code repo.

### GitHub Issues owner

<a id="integrations-routing-github-issues-owner"></a>

`integrations.routing.github_issues.owner`

**Summary** — Org or user that owns the issue-tracker repo (the bit before the slash in `owner/repo`).

**How it works** — Concatenated into the GitHub API path: `/repos/{owner}/{repo}/issues`.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.owner` · endpoint `POST /v1/admin/routing` · read by `route-to-github-issues edge function`

**When to change** — Change when the tracker repo moves under a new org — typically during company rebranding.

### GitHub Issues repo

<a id="integrations-routing-github-issues-repo"></a>

`integrations.routing.github_issues.repo`

**Summary** — Repository name (no owner prefix) that issues are filed under.

**How it works** — Concatenated with the owner above into the API path. Case-sensitive on the GitHub API side.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.repo` · endpoint `POST /v1/admin/routing` · read by `route-to-github-issues edge function`

**When to change** — Update when archiving and replacing the tracker — Mushi follows the new repo as soon as you save.

### PagerDuty routing key

<a id="integrations-routing-pagerduty-routing-key"></a>

`integrations.routing.pagerduty.routing_key`

**Summary** — 32-character integration key for PagerDuty Events API v2 — pages on-call when severity = critical.

**How it works** — Mushi POSTs a v2 event payload with `event_action=trigger` and a fingerprint built from the report cluster id, so duplicate criticals dedupe instead of paging twice. Auto-resolves the incident when the linked report closes.

**Default** — `unset`

**Where it lives** — table `routing_destinations.config.routingKey` · endpoint `POST /v1/admin/routing` · read by `route-to-pagerduty edge function`

**When to change** — Set this once you have a real on-call rotation. Don't use a personal key — use a service-level integration key.

## Storage (BYO)

<a id="storage-byo-"></a>

### Storage provider

<a id="storage-provider"></a>

`storage.provider`

**Summary** — Which object-storage backend hosts user-uploaded artifacts (screenshots, recordings, attachments).

**How it works** — Switches the storage adapter used for new uploads — supabase (default, lives in Supabase Storage), s3 (any S3-compatible host), gcs (Google Cloud Storage), or r2 (Cloudflare R2). Existing artifacts stay where they were written; only new traffic moves.

**Default** — `supabase`

**Where it lives** — table `storage_configs.provider` · endpoint `PUT /v1/admin/storage` · read by `storage adapter (every artifact upload/download)`

**When to change** — Switch to your own bucket once you cross the Supabase Storage egress free tier, or when compliance asks you to keep artifacts inside your own VPC.

### Bucket

<a id="storage-bucket"></a>

`storage.bucket`

**Summary** — Name of the bucket the storage adapter writes artifacts into.

**How it works** — Must already exist on the chosen provider — Mushi never creates buckets implicitly (avoids accidental data scattering across regions). The IAM identity behind the credentials below needs `s3:PutObject` / `s3:GetObject` (or the equivalent) on this bucket.

**Default** — `unset`

**Where it lives** — table `storage_configs.bucket` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Set once when wiring BYO storage. Migrate to a new bucket only with a backfill plan — old links keep pointing at the old one.

### Region

<a id="storage-region"></a>

`storage.region`

**Summary** — Geographic region of the bucket — used to build the endpoint and for residency enforcement.

**How it works** — For S3, the region is part of the URL signing process; mismatch → SignatureDoesNotMatch. For Compliance: storage region is checked against `data_residency_region` and a mismatch triggers a hard refusal at write time.

**Default** — `unset`

**Where it lives** — table `storage_configs.region` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`, `compliance check`

**When to change** — Set the region your bucket actually lives in. Don't guess — write failures from a wrong region are silent until the user can't open their screenshot.

### Endpoint

<a id="storage-endpoint"></a>

`storage.endpoint`

**Summary** — Full URL of the storage API endpoint — only needed for non-AWS S3-compatible providers.

**How it works** — Leave blank for AWS S3 (the SDK builds the URL from region). Set explicitly for R2 (`https://<account>.r2.cloudflarestorage.com`), Backblaze B2, MinIO, or any other S3-compatible host.

**Default** — `empty (provider default)`

**Where it lives** — table `storage_configs.endpoint` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Set once when pointing at a non-AWS S3 host. Update if your provider migrates accounts to a new endpoint shape.

### Path prefix

<a id="storage-path-prefix"></a>

`storage.path_prefix`

**Summary** — String prepended to every key the storage adapter writes — segments artifacts inside a shared bucket.

**How it works** — A trailing slash is added if missing. Useful when one bucket hosts multiple Mushi projects or coexists with other apps — set to `mushi/prod/` so your tooling can audit just the Mushi paths without confusing them with neighbours.

**Default** — `empty (writes to bucket root)`

**Where it lives** — table `storage_configs.path_prefix` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Set when sharing a bucket. Don't change after writes have started — old keys stay where they were.

### Signed URL TTL (seconds)

<a id="storage-signed-url-ttl-secs"></a>

`storage.signed_url_ttl_secs`

**Summary** — Lifetime of presigned download URLs handed out to admin users for screenshots and recordings.

**How it works** — Every download in the admin (e.g. preview a screenshot, replay a session recording) is gated by a fresh presigned URL. Lower = tighter security (links expire fast); higher = friendlier UX (a copied link still works in a Slack thread an hour later).

**Default** — `3600 (1 hour)` · range `60 – 604800 (7 days)`

**Where it lives** — table `storage_configs.signed_url_ttl_secs` · endpoint `PUT /v1/admin/storage` · read by `storage adapter (every signed URL it mints)`

**When to change** — Drop to 5–15 minutes for high-sensitivity data. Bump up to a day if your team works asynchronously and copies links into long-running threads.

### Access key (vault ref)

<a id="storage-access-key-ref"></a>

`storage.access_key_ref`

**Summary** — Reference to the access-key half of the storage credentials — stored in Supabase Vault, never plaintext.

**How it works** — Form takes the raw key on save and stashes it in Vault, then stores only `vault://<id>` here. The adapter resolves the secret at request time.

**Default** — `unset`

**Where it lives** — table `storage_configs.access_key_ref` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Rotate quarterly, or immediately if the key may have leaked.

### Secret key (vault ref)

<a id="storage-secret-key-ref"></a>

`storage.secret_key_ref`

**Summary** — Reference to the secret-key half of the storage credentials.

**How it works** — Same Vault flow as the access key. Pair must be rotated together — half-rotations leave the adapter unable to sign.

**Default** — `unset`

**Where it lives** — table `storage_configs.secret_key_ref` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Rotate alongside the access key. Never paste the raw value into an email or ticket.

### KMS key ID

<a id="storage-kms-key-id"></a>

`storage.kms_key_id`

**Summary** — Optional customer-managed KMS key used to encrypt artifacts at rest with SSE-KMS.

**How it works** — When set, every PutObject specifies `x-amz-server-side-encryption: aws:kms` with this key id. Without it, the bucket's default encryption applies (typically AES256).

**Default** — `empty (provider default encryption)`

**Where it lives** — table `storage_configs.kms_key_id` · endpoint `PUT /v1/admin/storage` · read by `storage adapter`

**When to change** — Set when compliance demands customer-managed encryption keys. Verify the IAM principal has `kms:Encrypt`/`kms:Decrypt` on the key ARN.

## Compliance

<a id="compliance"></a>

### Data residency region

<a id="compliance-residency-region"></a>

`compliance.residency.region`

**Summary** — Pins your project's data to a specific geographic region — `us`, `eu`, `jp`, or `self` (BYO storage).

**How it works** — On first set, Mushi pins the project to this region and validates that storage + DB + edge functions all run there. Once pinned, the value is REGION_LOCKED — subsequent change attempts return 409 with `code: REGION_LOCKED`. To migrate, open a support ticket so the data move can be audited.

**Default** — `unpinned (first traffic locks it)`

**Where it lives** — table `projects.data_residency_region` · endpoint `PUT /v1/admin/residency/{projectId}` · read by `every storage write`, `compliance check`

**When to change** — Set on day 1 if compliance demands it (HIPAA, GDPR, J-SOX). Don't set speculatively — the lock-out is real and reversal is manual.

**Learn more** — [Configuration reference](https://github.com/kensaurus/mushi-mushi/blob/master/docs/CONFIG_REFERENCE.md)

### Reports retention (days)

<a id="compliance-retention-reports-days"></a>

`compliance.retention.reports_days`

**Summary** — How long classified reports stay in the database before the retention sweeper deletes them.

**How it works** — A nightly cron deletes any report whose `created_at + reports_retention_days` is in the past, UNLESS `legal_hold` is true (in which case nothing is deleted regardless of age). Soft-delete first (90-day tombstone), then hard-delete.

**Default** — `365 (1 year)`

**Where it lives** — table `project_retention_policies.reports_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `retention-sweep cron`, `soc2-evidence edge function`

**When to change** — Lower to 90 for GDPR-tight projects. Raise to 730+ for regulated industries that need multi-year audit history.

### Audit log retention (days)

<a id="compliance-retention-audit-days"></a>

`compliance.retention.audit_days`

**Summary** — How long admin-action audit logs (who saw / changed / deleted what) are retained.

**How it works** — Independent of the reports retention. Audit logs are append-only and rarely need to be the same age as the underlying data — most regulators want 1–7 years of audit even on 90-day data.

**Default** — `730 (2 years)`

**Where it lives** — table `project_retention_policies.audit_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `audit-sweep cron`, `soc2-evidence edge function`

**When to change** — Match your strictest regulatory ask (SOC 2 typically asks for 1y; HIPAA 6y; J-SOX 7y).

### Attachments retention (days)

<a id="compliance-retention-attachments-days"></a>

`compliance.retention.attachments_days`

**Summary** — How long screenshots, recordings, and other binary attachments are retained.

**How it works** — Object-storage entries are deleted via the configured storage adapter. If a report is older than its retention window but its attachments aren't, the attachments are orphaned but kept until their own clock expires.

**Default** — `180 (6 months)`

**Where it lives** — table `project_retention_policies.attachments_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `attachment-sweep cron`

**When to change** — Lower aggressively if storage cost dominates. Raise only when artifacts are evidentiary (regulated reproduction steps).

### Events retention (days)

<a id="compliance-retention-events-days"></a>

`compliance.retention.events_days`

**Summary** — How long pipeline events (LLM calls, ingest spans, fix attempts) are retained for analytics.

**How it works** — Drives the rollup tables that power the Health page. Events older than this window are dropped; aggregated rollups (hourly/daily) survive longer because they're much smaller.

**Default** — `90`

**Where it lives** — table `project_retention_policies.events_retention_days` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `events-sweep cron`, `health-rollups cron`

**When to change** — Lower to 30 if the events table is your top storage line item. Raise to 365 if you do longitudinal pipeline analysis.

### Legal hold

<a id="compliance-legal-hold"></a>

`compliance.legal_hold`

**Summary** — Master switch that suspends ALL retention deletes — for litigation holds and regulatory inquiries.

**How it works** — When on, every retention sweeper short-circuits and deletes nothing. The toggle is itself audit-logged (who flipped it, when, why) so a compliance team can prove the hold was active during the incident window.

**Default** — `off`

**Where it lives** — table `project_retention_policies.legal_hold` · endpoint `PUT /v1/admin/compliance/retention/{projectId}` · read by `every retention sweeper`

**When to change** — Flip ON the moment counsel hands you a hold notice. Flip OFF only after counsel confirms the hold is released — leaving it on indefinitely defeats GDPR/CCPA right-to-be-forgotten.

### DSAR subject email

<a id="compliance-dsar-subject-email"></a>

`compliance.dsar.subject_email`

**Summary** — Email address of the data subject whose data you want exported or deleted.

**How it works** — The DSAR (Data Subject Access Request) endpoint searches every report, attachment, and event whose `reporter_email` or session metadata matches this address, and produces either an export bundle or a delete plan.

**Default** — `unset`

**Where it lives** — table `dsar_requests.subject_email` · endpoint `POST /v1/admin/compliance/dsar` · read by `dsar-runner edge function`

**When to change** — Fill in only when processing a real DSAR. Each submission creates an auditable request — don't test on real customer emails.

## SSO

<a id="sso"></a>

### SSO provider type

<a id="sso-provider-type"></a>

`sso.provider_type`

**Summary** — Which federation protocol the IdP speaks — `saml` (production) or `oidc` (currently gated).

**How it works** — Determines which authn flow Mushi expects on the callback. SAML is the supported path; OIDC is wired in the API but returns 501 until the next release wave is shipped.

**Default** — `saml`

**Where it lives** — table `sso_providers.provider_type` · endpoint `PUT /v1/admin/sso` · read by `sso-callback edge function`

**When to change** — Pick what your IdP actually serves. Don't pick OIDC yet — the gate exists for safety, not capacity.

### IdP metadata URL

<a id="sso-metadata-url"></a>

`sso.metadata_url`

**Summary** — URL Mushi fetches to learn the IdP's certificates, endpoints, and assertion shape.

**How it works** — Refetched daily so cert rotations propagate without a manual sync. If the URL goes 4xx, the previous cached metadata is used until it does.

**Default** — `unset`

**Where it lives** — table `sso_providers.metadata_url` · endpoint `PUT /v1/admin/sso` · read by `sso-callback edge function`

**When to change** — Update when migrating IdPs (Okta → Entra, etc.). Verify the new metadata URL is reachable from your Mushi region before flipping.

### Entity ID

<a id="sso-entity-id"></a>

`sso.entity_id`

**Summary** — Unique identifier for this Mushi project as seen by the IdP — also called the audience.

**How it works** — Sent in the SAML AuthnRequest as `Issuer` and asserted by the IdP in the response. Mismatch → assertion rejected.

**Default** — `unset`

**Where it lives** — table `sso_providers.entity_id` · endpoint `PUT /v1/admin/sso` · read by `sso-callback edge function`

**When to change** — Set once during provisioning. Match exactly what the IdP's app config has for "Audience URI".

### SSO email domains

<a id="sso-allowed-domains"></a>

`sso.allowed_domains`

**Summary** — Comma-separated email domains routed to this SSO provider (`acme.com, acme.co.jp`).

**How it works** — On the login page, the email a user types is matched against this list — domain hit → redirect to SSO. Domain miss → fall back to password (or block, depending on the org's "SSO required" toggle).

**Default** — `unset (no SSO routing)`

**Where it lives** — table `sso_providers.allowed_domains (text[])` · endpoint `PUT /v1/admin/sso` · read by `login-resolver edge function`

**When to change** — Add a domain the day before that company's users start onboarding. Remove a domain immediately on contract end so old emails can't still SSO in.

## Prompt Lab

<a id="prompt-lab"></a>

### Pipeline stage

<a id="prompt-lab-stage"></a>

`prompt-lab.stage`

**Summary** — Picks which step of the LLM pipeline you're editing prompts for — Stage 1 fast-filter, Stage 2 classifier, fix-worker, or judge.

**How it works** — Each stage has its own active prompt id. Switching tabs scopes every action below (create new version, set traffic split, replay) to that stage's prompts only — they don't cross-pollinate.

**Default** — `classifier (most-used)`

**Where it lives** — table `prompt_versions.stage` · endpoint `GET /v1/admin/prompt-lab/prompts` · read by `_shared/prompt-ab helper`

**When to change** — Pick the stage you're iterating on. Most teams start with classifier — it has the largest impact per token.

### Traffic percentage

<a id="prompt-lab-traffic-percentage"></a>

`prompt-lab.traffic_percentage`

**Summary** — Share of production traffic that gets this prompt version — 0% to 100%.

**How it works** — A weighted random pick (`prompt-ab.ts`) routes each request to a prompt version based on its `traffic_percentage`. The percentages should sum to 100 across active versions of a stage; the helper normalises if they don't. Live changes apply within seconds — no deploy required.

**Default** — `0% on new versions`

**Where it lives** — table `prompt_versions.traffic_percentage` · endpoint `POST /v1/admin/prompt-lab/prompts` · read by `_shared/prompt-ab helper`

**When to change** — Start a new version at 5%, watch the eval scores for 24h, then ramp 25→50→100. Don't flip 0→100 — you lose the ability to A/B against the previous champion.

**Learn more** — [Architecture overview](https://kensaur.us/mushi-mushi/docs/concepts/architecture)

### Prompt body

<a id="prompt-lab-prompt-body"></a>

`prompt-lab.prompt_body`

**Summary** — The system + user templates the LLM sees, with named slots for runtime variables.

**How it works** — Slots like `{report_text}` and `{recent_events}` get substituted at call time. The body is versioned — saving creates a new `prompt_versions` row, never overwrites an existing one. The previous version stays at its current traffic split until you move it.

**Default** — `shipped baseline (varies by stage)`

**Where it lives** — table `prompt_versions.body` · endpoint `POST /v1/admin/prompt-lab/prompts` · read by `fast-filter`, `classify-report`, `fix-worker, judge`

**When to change** — When eval scores plateau or a new model rewards different prompting style. Tag every change with what you tried, so the changelog is honest.

### Synthetic case count

<a id="prompt-lab-synthetic-count"></a>

`prompt-lab.synthetic_count`

**Summary** — How many synthetic test cases to generate when seeding evals for a new prompt version.

**How it works** — Higher count = more statistical power on eval scores, but also more LLM spend (each case runs both the prompt and the judge). 25 is enough to spot regressions; 100+ is needed to detect <5% delta with confidence.

**Default** — `25` · range `5 – 200`

**Where it lives** — table `prompt_versions.(driven by generator job, not stored)` · endpoint `POST /v1/admin/prompt-lab/synthesize` · read by `eval-runner cron`

**When to change** — Bump to 100 when a regression is suspected and you need confidence; drop to 10 for quick smoke tests during iteration.

## Marketplace plugins

<a id="marketplace-plugins"></a>

### Plugin webhook URL

<a id="marketplace-plugin-webhook-url"></a>

`marketplace.plugin_webhook_url`

**Summary** — Where Mushi POSTs subscribed plugin events — your endpoint receives them.

**How it works** — Every subscribed event fires a JSON POST against this URL. Failed posts retry with exponential backoff up to 24 hours; persistently-failing webhooks are quarantined and surfaced as an alert.

**Default** — `unset (plugin disabled)`

**Where it lives** — table `marketplace_plugins.webhook_url` · endpoint `POST /v1/admin/plugins` · read by `marketplace-dispatcher edge function`

**When to change** — Set when wiring a plugin. Update when your plugin host migrates — the dispatcher honours the new URL on the next event.

### Plugin signing secret

<a id="marketplace-plugin-signing-secret"></a>

`marketplace.plugin_signing_secret`

**Summary** — HMAC secret your plugin verifies on every inbound event so it can trust the payload.

**How it works** — Mushi signs every event with `X-Mushi-Signature: t=<ts>,v1=<hmac>`. Your plugin recomputes the HMAC against the raw body using this secret; mismatch = drop the event.

**Default** — `auto-generated on plugin create`

**Where it lives** — table `marketplace_plugins.signing_secret_ref` · endpoint `POST /v1/admin/plugins` · read by `marketplace-dispatcher edge function`

**When to change** — Rotate when the plugin owner changes hands. Always update both ends in lockstep — no overlap window.

### Subscribed events

<a id="marketplace-subscribed-events"></a>

`marketplace.subscribed_events`

**Summary** — List of event types your plugin wants to receive (`report.created`, `report.classified`, `fix.opened`, etc.).

**How it works** — The dispatcher emits to your URL only for events on this list — every other event is no-op for your plugin. Keep the list minimal; each event is a billable webhook delivery.

**Default** — `empty (plugin receives nothing)`

**Where it lives** — table `marketplace_plugins.subscribed_events (text[])` · endpoint `POST /v1/admin/plugins` · read by `marketplace-dispatcher edge function`

**When to change** — Subscribe only to events your plugin actually reacts to. Adding/removing is instant — no plugin restart required.

## Anti-gaming

<a id="anti-gaming"></a>

### Anti-gaming filter

<a id="anti-gaming-flagged-filter"></a>

`anti-gaming.flagged_filter`

**Summary** — Show only flagged reports, only clean ones, or both — scopes the table without losing your sort state.

**How it works** — Drives the `?flagged=true|false` query param on the reports listing. Pure UI filter — doesn't change underlying data, doesn't mark anything reviewed.

**Default** — `all`

**When to change** — Switch to "flagged only" when investigating a suspected attack pattern. Switch back when you're reviewing the regular triage queue.

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

**How it works** — Persisted on the report and surfaced in the audit log. The next reviewer (or the LLM, if you wire it through Prompt Lab) can read this when deciding whether the flag still applies.

**Default** — `empty`

**Where it lives** — table `reports.flag_reason` · endpoint `PATCH /v1/admin/reports/{id}/flag` · read by `anti-gaming dashboard`, `audit log`

**When to change** — Always fill it in — "flagged with no reason" is the ticket the next person on rotation can't triage.

## Notifications

<a id="notifications"></a>

### Show filter

<a id="notifications-show-filter"></a>

`notifications.show_filter`

**Summary** — Picks which notifications appear in the list — `all`, `unread only`, or per-category.

**How it works** — Pure UI filter. Doesn't mark anything as read; doesn't mute future notifications. Persists in the URL so a deep link to "unread severities high+" survives a reload.

**Default** — `unread`

**When to change** — Stay on `unread` for daily triage. Flip to `all` when looking for a specific notification you saw last week.

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

**Where it lives** — table `project_settings.benchmarking_optin` · endpoint `PUT /v1/admin/settings/benchmarking` · read by `_shared/intelligence helper`

**When to change** — Turn on if you want "you vs the median customer" comparisons. Keep off for projects under strict NDAs — even anonymised aggregates leak shape information.

## Billing

<a id="billing"></a>

### Plan

<a id="billing-plan"></a>

`billing.plan`

**Summary** — Subscription tier — determines the included LLM credits, MAU cap, and feature gates.

**How it works** — Plan changes go through Stripe Checkout / Customer Portal — Mushi mirrors the new plan id back via webhook. Downgrades are queued to the end of the current period; upgrades take effect immediately and are pro-rated.

**Default** — `free`

**Where it lives** — table `subscriptions.plan_id` · endpoint `(via Stripe webhook → /v1/billing/webhook)` · read by `feature-gate middleware`, `usage caps`

**When to change** — Upgrade when you're consistently hitting the cap on the dashboard. Downgrade only after one full month under the next-tier-down's cap.

### Support subject

<a id="billing-support-subject"></a>

`billing.support_subject`

**Summary** — One-line summary of your support request — appears as the email subject line.

**How it works** — Submitted to the billing-support edge function which files a Zendesk-style ticket. Keep it specific (`"Refund for May overage — invoice #1234"`) so triage doesn't bounce it back asking for clarification.

**Default** — `empty`

**Where it lives** — table `support_requests.subject` · endpoint `POST /v1/admin/billing/support` · read by `billing-support edge function`

**When to change** — Always fill before submitting. The edge function rejects empty subjects with a 400.

### Support category

<a id="billing-support-category"></a>

`billing.support_category`

**Summary** — Triage hint that routes the ticket to the right team — billing, plan change, refund, technical, other.

**How it works** — The category is appended to the ticket body and used by the support inbox's automation to assign the right responder. Wrong category just means a slower first response, not a lost ticket.

**Default** — `billing`

**Where it lives** — table `support_requests.category` · endpoint `POST /v1/admin/billing/support` · read by `billing-support edge function`

**When to change** — Always pick the closest match. Use `other` only when nothing else fits.

### Support body

<a id="billing-support-body"></a>

`billing.support_body`

**Summary** — The full text of your support request — paste invoice numbers, screenshots, anything that helps the responder.

**How it works** — Posted as the ticket body. Markdown is preserved on the support side, so feel free to use lists and code blocks. Maximum 10k chars.

**Default** — `empty`

**Where it lives** — table `support_requests.body` · endpoint `POST /v1/admin/billing/support` · read by `billing-support edge function`

**When to change** — Include the invoice id and the dollar amount you're asking about — billing tickets without specifics get bounced.

## Onboarding

<a id="onboarding"></a>

### Project name

<a id="onboarding-project-name"></a>

`onboarding.project_name`

**Summary** — Display name for your first project — visible in the active-project switcher and in routing-destination payloads.

**How it works** — Used for display only. The internal `project_id` is generated and immutable; you can rename freely without breaking SDK keys or webhook subscriptions.

**Default** — `unset`

**Where it lives** — table `projects.name` · endpoint `POST /v1/admin/projects` · read by `admin UI`, `routing payloads`

**When to change** — Set during onboarding. Rename later as your product naming firms up — no migration needed.

### First API key label

<a id="onboarding-first-key-label"></a>

`onboarding.first_key_label`

**Summary** — Human-readable label for the first API key — helps you find and revoke it later.

**How it works** — Saved on the `project_api_keys` row alongside the hash and scopes. Pure metadata — the value isn't sent to the SDK, doesn't affect ingest behaviour.

**Default** — `"Default" if blank`

**Where it lives** — table `project_api_keys.label` · endpoint `POST /v1/admin/projects/{id}/keys` · read by `admin UI`, `audit log`

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

**Summary** — Controls whether Mushi injects its own launcher, pins a slim edge tab, binds to your button, or stays programmatic-only.

**How it works** — `auto` keeps the default editorial stamp button. `edge-tab` makes the trigger less obstructive on dense apps. `attach` hides the default button and binds to `attachToSelector`, while `manual` / `hidden` render no launcher so host apps can call `Mushi.open()` themselves.

**Default** — `auto`

**When to change** — Use `attach` for mature production apps with a help menu. Use `edge-tab` when bottom nav or chat widgets compete with the default corner trigger. Use `manual` on regulated or fullscreen flows.

**Learn more** — [Trigger modes](https://kensaur.us/mushi-mushi/docs/concepts/trigger-modes)

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

### Framework tab

<a id="sdk-install-framework"></a>

`sdk-install.framework`

**Summary** — Picks which framework's install snippet you copy — React, Vue, Svelte, React Native, Expo, Capacitor, or Vanilla.

**How it works** — Pure UI toggle. Web frameworks (React/Vue/Svelte/Vanilla) wire up `Mushi.init()` from `@mushi-mushi/web` via the right adapter so framework error boundaries get hooked. Mobile frameworks (React Native / Expo) ship their own `<MushiProvider>` from `@mushi-mushi/react-native`. Capacitor uses the dedicated `@mushi-mushi/capacitor` plugin with `Mushi.configure(...)` and a follow-up `npx cap sync`.

**Default** — `react`

**When to change** — Pick whatever your app uses. Vanilla is the right answer for non-framework apps. For Capacitor → React Native migrations, see https://docs.mushimushi.dev/migrations/capacitor-to-react-native.

