# Environment variables

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/environment

---
title: Environment variables
description: Every environment variable a self-hosted Mushi Mushi reads, where to set it, and whether it is required. Generated from the .env.example templates.
---

# Environment variables

You need very few of these. `npx mushi-mushi selfhost up` sets the required function secrets for you, and `npx mushi-mushi selfhost secrets` writes the Compose `.env`. Everything else turns on an optional feature.

| You run | Required | Set by |
| --- | --- | --- |
| Your own Supabase project | `MUSHI_INTERNAL_CALLER_SECRET` | `selfhost up` |
| Docker Compose | `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MUSHI_INTERNAL_CALLER_SECRET` | `selfhost secrets` |
| A console you build yourself | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | your build command |

An AI key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) is optional: without one, reports get rule-based triage, and no plain-English diagnosis.

## Set by the platform

Supabase sets these in every function. Compose passes them to the `edge-functions` service. Do not set them yourself on Supabase.

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | The project URL. Compose passes the internal gateway, `http://caddy:8000`. |
| `SUPABASE_ANON_KEY` | The anon (public) key. |
| `SUPABASE_SERVICE_ROLE_KEY` | The service-role key. Server only. |
| `SUPABASE_DB_URL` | Direct Postgres connection string. |
| `SB_REGION` | Region the function runs in (read-only). |

## Function secrets

A Supabase function secret: `supabase secrets set NAME=value` (or Project Settings → Edge Functions → Secrets). In Docker Compose, add it to the `edge-functions` service environment.

### Core (selfhost up sets these)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_INTERNAL_CALLER_SECRET` | Required: `selfhost up` and the Compose secrets script generate it | — | Lets pg_cron call your functions; the same value goes in mushi_runtime_config |
| `ADMIN_BASE_URL` | Optional | — | Where your console is served; links in Slack, Discord and email open it |

### AI keys (optional; one turns on the plain-English diagnosis and fix drafts)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Optional | — | — |
| `OPENAI_API_KEY` | Optional | — | Either provider works; OpenAI also powers duplicate detection, semantic search and voice |
| `OPENROUTER_API_KEY` | Optional | — | Optional fallback for the OpenAI models when the OpenAI key is out of credit or down |
| `AGENT_PR_REVIEW_MODEL` | Optional | `claude-opus-5-5` | Agent PR review model for every project that has not set its own (project_settings.agent_pr_review_model, ADR 0039). Default: claude-opus-5-5. |

### Operator notices and Slack routing (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_FUNCTION_REGION` | Optional | — | Your database's region: pins the Slack bot's Request URLs there (?forceFunctionRegion), so Slack's US calls answer inside its 3 s limit |
| `MUSHI_OPS_KEY` | Optional | — | Optional: this deployment's own ops:write key; operator notices (payments, alerts) go to the Ops hub's Slack bot, the webhooks are the fallback |
| `MUSHI_OPS_API_URL` | Optional | `this project's own api` | Optional: where those notices go (default: this project's own api) |

### Discord triage feed (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_DISCORD_WEBHOOK_URL` | Optional | — | Centralised Discord triage (_shared/discord-triage.README.md). Cross-project operator feed — distinct from the per-project project_settings.discord_webhook_url. Unset = silent no-op. Webhook mode: |
| `MUSHI_DISCORD_THREAD_ID` | Optional | — | Optional; posts into an existing thread |
| `MUSHI_TRIAGE_RELAY_URL` | Optional | — | Relay mode (channels where the bot lacks MANAGE_WEBHOOKS): |
| `MUSHI_TRIAGE_RELAY_TOKEN` | Optional | — | Sent as the x-relay-token header |
| `MUSHI_TRIAGE_RELAY_THREAD` | Optional | — | Default. Absent/other =&gt; relay posts to sales |
| `MUSHI_DISCORD_MIN_LEVEL` | Optional | `error` | low\|medium\|high\|critical (error→high). Default: error |

### Code index (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_REPO_INDEX_SWEEP_FILE_CAP` | Optional | — | Codebase index sweep (webhooks-github-indexer). The coverage ceiling (files a project's index may hold) follows the plan: Free 300, Builder (indie) 1,500, Studio (pro) 5,000, Enterprise 20,000, or pricing_plans.feature_flags .codebase_index_file_cap. Setting the cap pins it for EVERY project, so leave it unset on Mushi Cloud; self-hosts (no billing plans) set it here. |
| `MUSHI_REPO_INDEX_SWEEP_RUN_FILES` | Optional | — | Files one sweep fetches (bounded by the edge function's wall clock and the GitHub token's rate limit); a larger ceiling fills over hourly runs. |

### Public diagram pages (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_PUBLIC_PAGES_BUCKET` | Optional | — | Public architecture-diagram pages (docs/operators/public-diagram-pages.md). An IAM user limited to s3:PutObject + s3:DeleteObject on arn:aws:s3:::&lt;bucket&gt;/mushi-mushi/r/\*. Unset = the crawlable page and its .md twin are not written; the diagram still shows via the docs 404 fallback. |
| `MUSHI_PUBLIC_PAGES_REGION` | Optional | — | — |
| `MUSHI_PUBLIC_PAGES_ACCESS_KEY_ID` | Optional | — | — |
| `MUSHI_PUBLIC_PAGES_SECRET_ACCESS_KEY` | Optional | — | — |

### Self-hosted Sentry hosts (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_SENTRY_SELF_HOSTED_HOSTS` | Optional | — | Self-hosted Sentry (_shared/sentry-dsn.ts). A Sentry DSN on a published app or in Settings → General must point at sentry.io (or a subdomain such as o123.ingest.us.sentry.io). List extra hosts here, comma separated, to accept a self-hosted Sentry. IP addresses, localhost and internal names are refused even when listed. Unset = sentry.io only. |

### Origins (optional; redirects and links in email)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `ADMIN_ORIGIN` | Optional | — | — |
| `MUSHI_ADMIN_URL` | Optional | — | — |
| `MUSHI_ADMIN_BASE_URL` | Optional | — | — |
| `SITE_URL` | Optional | — | — |
| `APP_URL` | Optional | — | — |
| `MUSHI_API_PUBLIC_URL` | Optional | — | — |
| `MUSHI_ADMIN_ORIGIN_ALLOWLIST` | Optional | — | First origin is the CLI device-auth approval page. |
| `DEFAULT_BASE_URL` | Optional | — | — |
| `MCP_PUBLIC_BASE_URL` | Optional | — | — |
| `TELEGRAM_WEBHOOK_BASE_URL` | Optional | — | — |

### Runtime name (optional; unset is treated as production)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `SUPABASE_ENV` | Optional | — | — |
| `DENO_ENV` | Optional | — | — |
| `MUSHI_CLUSTER_REGION` | Optional | — | — |
| `MUSHI_VERSION` | Optional | — | — |

### GitHub App (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `GITHUB_APP_ID` | Optional | — | — |
| `GITHUB_APP_PRIVATE_KEY` | Optional | — | — |
| `GITHUB_APP_PRIVATE_KEY_PEM` | Optional | — | — |
| `GITHUB_APP_WEBHOOK_SECRET` | Optional | — | — |
| `GITHUB_APP_SLUG` | Optional | — | "Connect GitHub" in the console (verified install + repository picker): the App's slug, OAuth client id and secret. The App's callback URLs must include &lt;SUPABASE_URL&gt;/functions/v1/api/v1/webhooks/github/app-authorize (or GITHUB_APP_OAUTH_REDIRECT_URL when set). MUSHI_GITHUB_CONNECT_SECRET signs the short-lived link and grant; unset uses the service role key. |
| `GITHUB_APP_CLIENT_ID` | Optional | — | — |
| `GITHUB_APP_CLIENT_SECRET` | Optional | — | — |
| `GITHUB_APP_OAUTH_REDIRECT_URL` | Optional | — | — |
| `MUSHI_GITHUB_CONNECT_SECRET` | Optional | — | — |
| `GITHUB_TOKEN` | Optional | — | The platform GITHUB_TOKEN serves only apps whose owner is listed here. |
| `MUSHI_OPERATOR_USER_IDS` | Optional | — | — |
| `MUSHI_GITHUB_APP_TRUST_UNVERIFIED_INSTALLS` | Optional | — | Single-tenant self-host only. Hosted production leaves this unset. |

### Slack OAuth (optional; operator workspace)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | Optional | — | — |
| `SLACK_CHANNEL_ID` | Optional | — | — |
| `SLACK_CLIENT_ID` | Optional | — | — |
| `SLACK_CLIENT_SECRET` | Optional | — | — |
| `SLACK_SIGNING_SECRET` | Optional | — | — |
| `SLACK_STATE_SECRET` | Optional | — | — |
| `SLACK_REDIRECT_URI` | Optional | — | — |

### Linear OAuth (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `LINEAR_OAUTH_CLIENT_ID` | Optional | — | — |
| `LINEAR_OAUTH_CLIENT_SECRET` | Optional | — | — |

### Email (optional; both required before any mail is sent)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Optional | — | — |
| `RESEND_FROM_EMAIL` | Optional | — | — |
| `LIFECYCLE_UNSUB_SECRET` | Optional | — | — |

### Tremendous tester payouts (optional; set the host explicitly)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `TREMENDOUS_API_KEY` | Optional | — | — |
| `TREMENDOUS_API_URL` | Optional | — | — |
| `TREMENDOUS_WEBHOOK_SECRET` | Optional | — | — |
| `TESTER_TIN_PEPPER` | Optional | — | — |

### AWS Bedrock fine-tune (optional; off until the flag is 1)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_BEDROCK_FINETUNE_ENABLED` | Optional | — | — |
| `AWS_ACCESS_KEY_ID` | Optional | — | — |
| `AWS_SECRET_ACCESS_KEY` | Optional | — | — |
| `AWS_SESSION_TOKEN` | Optional | — | — |
| `AWS_REGION` | Optional | — | — |
| `BEDROCK_REGION` | Optional | — | — |
| `BEDROCK_ROLE_ARN` | Optional | — | — |
| `BEDROCK_OUTPUT_S3_URI` | Optional | — | — |
| `MUSHI_ALLOW_STUB_FINE_TUNE` | Optional | — | — |

### Hosted LLM billing (optional; stays off without the wallet bridge)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_HOSTED_LLM_BILLING` | Optional | — | — |
| `KENSAURUS_WALLET_URL` | Optional | — | — |
| `KENSAURUS_WALLET_INTERNAL_TOKEN` | Optional | — | — |
| `MUSHI_HOSTED_LLM_PREFLIGHT_TIMEOUT_MS` | Optional | — | — |

### KENSAURUS AI routes (optional; Mushi Mushi Cloud)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `KENSAURUS_ROUTES_URL` | Optional | — | Which provider and model each platform-key AI call uses comes from kenji's kensaurus_ai_routes, read with KENSAURUS_ROUTES_TOKEN (else KENSAURUS_WALLET_INTERNAL_TOKEN). Without a token (a self-host) nothing calls kenji and the built-in OpenAI-first list runs. An app's own keys (BYOK) are not affected. The console edits routes on the Providers &amp; AI routes page (KENSAURUS_OPS_URL / KENSAURUS_OPS_CONSOLE_TOKEN). Default: https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/kensaurus-ai-routes |
| `KENSAURUS_ROUTES_TOKEN` | Optional | — | — |
| `KENSAURUS_LLM_DRILL` | Optional | — | Test and smoke drills only: &lt;provider&gt;:payment fails that provider's call with Anthropic's low-credit error when the call asks for a drill. Leave unset. |

### OpenAI-compatible endpoint (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `OPENAI_BASE_URL` | Optional | — | — |
| `OPENAI_WEBHOOK_SECRET` | Optional | — | — |
| `MUSHI_OPENAI_BASE_URL_ALLOWLIST` | Optional | — | — |
| `MUSHI_ALLOW_PRIVATE_LLM_BASE_URL` | Optional | — | Self-host: true lets OPENAI_BASE_URL (this server-wide setting only, never a per-key base URL) be your own http model server, e.g. http://ollama:11434/v1. |
| `MUSHI_OPENAI_MODEL` | Optional | — | The model that server serves, for every chat call (any name, e.g. qwen3.8:27b). |
| `MUSHI_OPENAI_EMBEDDING_MODEL` | Optional | — | Its embedding model; must return 1536-dimension vectors. Unset = OpenAI's id. |
| `MUSHI_OPENAI_MODEL_MAP` | Optional | — | Per-tier renames, which win over MUSHI_OPENAI_MODEL: gpt-6-luna=small,gpt-6.1-terra=large |

### Self-host public address (optional; unset on the hosted platform)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `SUPABASE_PUBLIC_URL` | Optional | — | The address people use. Signed Storage links are rewritten to it when SUPABASE_URL is an internal gateway. |

### QA crawl providers (optional; project BYOK wins when set)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `FIRECRAWL_API_KEY` | Optional | — | — |
| `BROWSERBASE_API_KEY` | Optional | — | — |

### Operators, bootstrap, and safety switches (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_OPERATOR_USER_IDS` | Optional | — | — |
| `KENSAURUS_OPS_URL` | Optional | — | Providers &amp; AI routes (/providers, operators only): the kensaurus-ops API and its console token. Both unset: the route answers 404. See docs/operators/providers-ai-routes.md. |
| `KENSAURUS_OPS_CONSOLE_TOKEN` | Optional | — | — |
| `MUSHI_FRESH_EYES_EMAIL_DOMAIN` | Optional | — | Fresh-eyes test accounts (ADR 0053): the email domain; one no mailbox answers on. Default synthetic.kensaur.us. |
| `MUSHI_INIT_OWNER_EMAIL` | Optional | — | — |
| `MUSHI_INIT_ORG_NAME` | Optional | — | — |
| `MUSHI_INIT_ORG_ID` | Optional | — | — |
| `MUSHI_INIT_PROJECT_NAME` | Optional | — | — |
| `MUSHI_INIT_PROJECT_ID` | Optional | — | — |
| `MUSHI_INIT_REPORTER_KEY` | Optional | — | — |
| `MUSHI_EE_LICENSE_KEY` | Optional | — | — |
| `MUSHI_EE_PUBLIC_KEY` | Optional | — | — |
| `MUSHI_SELF_PROJECT_ID` | Optional | — | — |
| `MUSHI_ALLOW_INTERNAL_PUSH` | Optional | — | — |
| `MUSHI_ALLOW_LOCAL_SANDBOX` | Optional | — | — |
| `MUSHI_ALLOW_PRIVATE_STORAGE_ENDPOINT` | Optional | — | — |
| `MUSHI_SCREENSHOT_HOST_ALLOWLIST` | Optional | — | — |
| `JIRA_DONE_TRANSITION_ID` | Optional | — | — |
| `CURSOR_USE_V0_WEBHOOK` | Optional | — | — |
| `MUSHI_CI_SYNC_BATCH` | Optional | — | — |
| `MUSHI_FIX_MIN_RAG_CHUNKS` | Optional | — | — |
| `MUSHI_FREE_REPORTS_PER_MONTH` | Optional | — | — |
| `MUSHI_INVENTORY_DRIFT_ROUTES` | Optional | — | — |
| `MUSHI_INVENTORY_DRIFT_COOLDOWN_DAYS` | Optional | — | — |
| `MUSHI_INVENTORY_DRIFT_MAX_PER_RUN` | Optional | — | — |

### Instance and support (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_INSTANCE_MODE` | Optional | — | hosted \| self-hosted. Unset: self-hosted unless SUPABASE_URL is Mushi Mushi Cloud's project. GET /health reports it; `mushi selfhost up` and Compose set self-hosted. |
| `MUSHI_CONSOLE_URL` | Optional | `https://kensaur` | Console address in key-created and usage-alert emails. Default: https://kensaur.us/mushi-mushi/admin |
| `MUSHI_API_ENDPOINT` | Optional | — | API address the console shows for SDK setup. Default: &lt;SUPABASE_URL&gt;/functions/v1/api |
| `SUPPORT_EMAIL` | Optional | — | — |
| `SUPPORT_URL` | Optional | — | — |
| `OPERATOR_SLACK_WEBHOOK_URL` | Optional | — | Operator alerts (payments, platform notices) when no Ops hub key is set. |
| `OPERATOR_DISCORD_WEBHOOK_URL` | Optional | — | — |

### Observability (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `LANGFUSE_PUBLIC_KEY` | Optional | — | Langfuse LLM traces. LANGFUSE_HOST is an alias of LANGFUSE_BASE_URL. |
| `LANGFUSE_SECRET_KEY` | Optional | — | — |
| `LANGFUSE_BASE_URL` | Optional | — | — |
| `LANGFUSE_HOST` | Optional | — | — |
| `SENTRY_DSN_SERVER` | Optional | — | Server errors to Sentry. SENTRY_DSN_SERVER wins; SENTRY_DSN also works. |
| `SENTRY_DSN` | Optional | — | — |
| `SENTRY_RELEASE` | Optional | — | — |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | `0` | Default: 0.05 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | — | OpenTelemetry span per classification (classify-report). |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional | — | — |

### Integration probes (optional; operator-wide tokens)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `CURSOR_API_KEY` | Optional | — | Used by the Integrations health probes when an app has no key of its own. |
| `LINEAR_API_KEY` | Optional | — | — |

### Mushi Mushi Cloud billing (hosted only; a self-host leaves these unset)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Optional | — | — |
| `STRIPE_WEBHOOK_SECRET` | Optional | — | — |
| `STRIPE_LIVEMODE` | Optional | — | — |
| `STRIPE_SUCCESS_URL` | Optional | — | — |
| `STRIPE_CANCEL_URL` | Optional | — | — |
| `STRIPE_PORTAL_RETURN_URL` | Optional | — | — |
| `STRIPE_DEFAULT_PRICE_ID` | Optional | — | — |
| `STRIPE_METER_EVENT_NAME` | Optional | — | — |
| `STRIPE_METER_REPORTS_EVENT_NAME` | Optional | — | — |
| `STRIPE_METER_DIAGNOSES_EVENT_NAME` | Optional | — | — |
| `STRIPE_METER_FIXES_EVENT_NAME` | Optional | — | — |
| `STRIPE_PRICE_STARTER_BASE` | Optional | — | — |
| `STRIPE_PRICE_STARTER_OVERAGE` | Optional | — | — |
| `STRIPE_PRICE_INDIE_BASE` | Optional | — | — |
| `STRIPE_PRICE_INDIE_ANNUAL` | Optional | — | — |
| `STRIPE_PRICE_INDIE_DIAGNOSES_OVERAGE` | Optional | — | — |
| `STRIPE_PRICE_PRO_BASE` | Optional | — | — |
| `STRIPE_PRICE_PRO_BASE_V2` | Optional | — | — |
| `STRIPE_PRICE_PRO_ANNUAL` | Optional | — | — |
| `STRIPE_PRICE_PRO_OVERAGE` | Optional | — | — |
| `STRIPE_PRICE_PRO_DIAGNOSES_OVERAGE` | Optional | — | — |

## Docker Compose (`deploy/.env`)

The `deploy/.env` file Compose reads. Generate it with `npx mushi-mushi selfhost secrets` or `./deploy/generate-secrets.sh`; never fill it by hand.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `MUSHI_PUBLIC_URL` | Optional | — | Public address of the stack. Caddy serves the console at / and the API under /functions/v1, /auth/v1, /rest/v1 and /storage/v1 on the same origin. A domain name (https://mushi.example.com) gets a certificate automatically. |
| `MUSHI_SITE_ADDRESS` | Optional | — | — |
| `POSTGRES_PASSWORD` | Required: generated | — | Required (generated) |
| `JWT_SECRET` | Required: generated | — | — |
| `SUPABASE_ANON_KEY` | Required: generated (signed with JWT_SECRET) | — | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Required: generated (signed with JWT_SECRET) | — | — |
| `MUSHI_INTERNAL_CALLER_SECRET` | Required: generated | — | — |
| `ANTHROPIC_API_KEY` | Optional | — | Optional: one LLM key turns on the plain-English diagnosis and fix drafts. Either provider works. Without one, reports get rule-based triage only. |
| `OPENAI_API_KEY` | Optional | — | — |
| `LANGFUSE_SECRET_KEY` | Optional | — | Optional: Langfuse tracing |
| `LANGFUSE_PUBLIC_KEY` | Optional | — | — |
| `LANGFUSE_BASE_URL` | Optional | — | — |
| `MUSHI_INIT_OWNER_EMAIL` | Optional | — | Optional: headless bootstrap of the first team, app and reporter key (POST /v1/admin/bootstrap). The owner signs up in the console first. |
| `MUSHI_INIT_ORG_NAME` | Optional | — | — |
| `MUSHI_INIT_PROJECT_NAME` | Optional | — | — |
| `MUSHI_INIT_REPORTER_KEY` | Optional | — | — |

## Console build (`VITE_*`)

Build-time values for the admin console. Vite bakes them into the bundle, so changing one means rebuilding (a static build, `docker build --build-arg`, or `apps/admin/.env` for `pnpm dev`). A console built without them asks for the URL and anon key on first open.

### Supabase (required for self-hosted, optional for cloud)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Required: on a self-host | — | — |
| `VITE_SUPABASE_ANON_KEY` | Required: on a self-host | — | — |

### API endpoint (optional — defaults to $&#123;VITE_SUPABASE_URL&#125;/functions/v1/api)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_API_URL` | Optional | — | In `pnpm dev`, any VITE_API_URL that points at \*.supabase.co is rewritten to the Vite same-origin proxy (`/functions/v1/api`) so the browser avoids CORS failures. Production builds use the absolute URL as-is (edge CORS must allow the console origin). |

### Instance type (optional — auto-detected from VITE_SUPABASE_URL)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_INSTANCE_TYPE` | Optional | — | — |

### Sentry error monitoring (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_SENTRY_DSN` | Optional | — | Leave blank to disable telemetry locally. The Sentry SDK no-ops when DSN is unset. DSNs are designed to be public — safe to bake into builds. |
| `VITE_RELEASE` | Optional | — | Set in CI to tag releases (e.g. the package version or commit SHA). |

### GitHub App (one-click repo connect on /integrations)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_GITHUB_APP_SLUG` | Optional | — | The `github.com/apps/` segment of your Mushi GitHub App. Without it the "Install GitHub App" CTA renders an "unavailable" note instead of the button, and users must paste an installation id by hand. Self-hosted installs without a public webhook callback can leave this blank and use the PAT disclosure instead. |

### Cloud fork builds (GitHub Actions deploy-admin.yml)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_CLOUD_SUPABASE_URL` | Optional | — | When building a console that talks to Mushi Cloud Supabase while hosted elsewhere: |
| `VITE_CLOUD_SUPABASE_ANON_KEY` | Optional | — | — |

### Console self-analytics (optional; dogfood)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_MUSHI_SELF_PROJECT_ID` | Optional | — | When both are set the console reports its own bugs and funnel events to this Mushi project through the web SDK (apps/admin/src/lib/mushi-self.ts). |
| `VITE_MUSHI_SELF_API_KEY` | Optional | — | — |
| `VITE_MUSHI_SELF_API_ENDPOINT` | Optional | — | — |

### Docs links and hosted MCP (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_DOCS_URL` | Optional | — | — |
| `VITE_DOCS_ORIGIN_ALLOWLIST` | Optional | — | — |
| `VITE_MCP_HTTP_URL` | Optional | — | — |
| `VITE_LANGFUSE_HOST` | Optional | — | — |

### Feature flags (optional)

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_MUSHI_ASK_STREAMING` | Optional | — | Ask streaming defaults on. Set 0 to opt out of production builds. |
| `VITE_ACTIVATION_COCKPIT_V2` | Optional | — | Activation cockpit defaults on. Set false to disable. |
