# Self-Hosted Deployment Guide

Run Mushi Mushi on your own Supabase project. The free tier is enough.

**Supported path:** your own Supabase project + `mushi selfhost up` (below).
**Experimental:** [Docker Compose](#docker-compose-experimental) and the
[Helm chart](../deploy/helm/README.md). Nobody has run either end to end yet.

## What you need

| | Required? | What it is for |
| --- | --- | --- |
| A [Supabase](https://supabase.com) project | Required | Database, auth, storage, edge functions |
| [Supabase CLI](https://supabase.com/docs/guides/cli), logged in (`supabase login` or `SUPABASE_ACCESS_TOKEN`) | Required | `selfhost up` drives it |
| Node.js 22+ and a clone of this repo | Required | The migrations and functions ship from the clone |
| `MUSHI_INTERNAL_CALLER_SECRET` | Required, **generated for you** | Lets pg_cron call your functions. `up` creates it, sets it as a function secret, and writes the same value into the database |
| An LLM key: Anthropic **or** OpenAI | Optional | The plain-English diagnosis (Stage 2) and fix drafts. Either provider works |
| An OpenAI key specifically | Optional | Duplicate detection, semantic search and voice transcription (they use OpenAI embeddings / speech-to-text) |
| `--console-url` (where you serve the console) | Optional, recommended | Report links in Slack/Discord (`ADMIN_BASE_URL`), and `mushi login` signing in on **your** console instead of Mushi Mushi Cloud |

### Without an LLM key

Mushi Mushi still runs. Reports are ingested with their screenshots and
context, stored, and shown in the console. Stage 1 falls back to rule-based
triage (`fast-filter` → heuristic category and severity, status `classified`).
You do not get the plain-English diagnosis, fix drafts, or duplicate detection.
Add a key later with `supabase secrets set ANTHROPIC_API_KEY=…` (or
`OPENAI_API_KEY=…`), or per app in the console under **Settings → API Keys**.

## Quickstart (5 commands)

```bash
git clone https://github.com/kensaurus/mushi-mushi.git && cd mushi-mushi
supabase login                                   # once per machine
npx mushi-mushi@latest selfhost up --project-ref <your-ref> \
  --console-url https://mushi.example.com        # optional; where you'll serve the console
```

`selfhost up` asks you to confirm, then asks for an Anthropic or OpenAI key
(press Enter to skip; `--anthropic-key`, `--openai-key`, `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` skip the prompt). It then:

1. links the project (`supabase link --project-ref`),
2. applies every migration (`supabase db push`),
3. sets the function secrets: `MUSHI_INTERNAL_CALLER_SECRET`, your LLM key, `ADMIN_BASE_URL`,
4. points the database at your project: `mushi_runtime_config.supabase_url`,
   `service_role_key` and `internal_caller_token`. The migrations seed the
   Mushi Mushi Cloud URL there; until this step, your cron jobs call Cloud,
5. lifts the Mushi Mushi Cloud free-plan limits on your instance (100 diagnoses
   a month, 1 app, 1 seat, 14-day retention), since there is nothing to bill,
6. deploys every edge function (`verify_jwt` comes from `config.toml`),
7. saves the endpoint and console URL to the CLI config, and checks `GET /health`.

Re-running `up` is safe: it re-applies only new migrations and rotates the
internal secret in both places. To keep the secret, export
`MUSHI_INTERNAL_CALLER_SECRET` before you run it. CI: add `--yes`.
No Supabase CLI, or want to see everything first? `--print-commands` prints
each command with placeholders for every secret.

Then:

```bash
# 4. Serve the console (next section), sign up there: the first account owns the instance.
# 5. Sign the CLI in. This mints your key in the browser; no SQL needed.
mushi login --endpoint https://<your-ref>.supabase.co/functions/v1/api
mushi selfhost doctor
```

`mushi login` opens the console saved by `--console-url`. If you skipped it,
run `mushi config consoleUrl <url>` first, or the CLI opens the Mushi Mushi
Cloud console.

## Serve the admin console

The console is a static Vite app. Vite inlines its settings at **build** time,
so pass them when you build:

```bash
VITE_SUPABASE_URL=https://<your-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon key from Supabase → Settings → API> \
VITE_API_URL=https://<your-ref>.supabase.co/functions/v1/api \
VITE_INSTANCE_TYPE=self-hosted \
pnpm --filter "@mushi-mushi/admin..." build      # output: apps/admin/dist
```

Serve `apps/admin/dist` from any static host that falls back to `index.html`
(see [Admin SPA deploy](../apps/docs/content/self-hosting/admin-spa.mdx)), or
run it locally with `pnpm --filter @mushi-mushi/admin dev` (http://localhost:6464).
A console built without `VITE_SUPABASE_URL` asks for the URL and anon key on
first open and keeps them in that browser.

## Connect your app

`mushi init` in your app repo installs the SDK and writes the project id and
key. By hand:

```tsx
import { MushiProvider } from 'mushi-mushi/react'

<MushiProvider config={{
  projectId: 'YOUR_PROJECT_ID',
  apiKey: 'YOUR_API_KEY',
  apiEndpoint: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/api',
}}>
  <YourApp />
</MushiProvider>
```

Get both from your console: **Projects** → create a project → copy the id and
generate an SDK key (`report:write`).

## Verify

```bash
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health        # process up
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health/ready  # database reachable
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/healthz           # {"status":"ok","db":"ok",…}
mushi selfhost doctor
```

Cron jobs should reach your project, not Mushi Mushi Cloud:

```sql
select key, case when key = 'supabase_url' then value else '(set)' end
  from mushi_runtime_config
 where key in ('supabase_url', 'service_role_key', 'internal_caller_token');

-- Pipeline recovery: success/degraded, not skipped
select status, metadata from cron_runs
 where job_name = 'pipeline-recovery' order by finished_at desc limit 3;
```

Screenshots go to the private `screenshots` bucket the first migration
creates (service-role only). Do
not make it public.

## Doing it by hand

`--print-commands` prints the exact sequence. In short, from `packages/server/`:

```bash
supabase link --project-ref <ref>
supabase db push --remote                # CLI 2.x: --linked. Without it, 3.x pushes to your LOCAL db
supabase secrets set --env-file mushi-secrets.env   # MUSHI_INTERNAL_CALLER_SECRET, LLM key, ADMIN_BASE_URL
supabase db query --remote --file mushi-runtime-config.sql
supabase functions deploy                # every function; verify_jwt from config.toml
```

If one function's upload is rejected as too large (the deploy endpoint caps a
request at about 5 MB; `api` is the biggest), deploy it with the repo's
compacting uploader:
`SUPABASE_PROJECT_REF=<your-ref> SUPABASE_ACCESS_TOKEN=sbp_… node scripts/deploy-edge-function.mjs api`.
Always set `SUPABASE_PROJECT_REF`: without it the script targets Mushi Mushi Cloud.

`mushi-runtime-config.sql` must upsert `supabase_url` (your project URL),
`service_role_key` and `internal_caller_token` (both the same value as
`MUSHI_INTERNAL_CALLER_SECRET`) into `public.mushi_runtime_config`, and lift
the Mushi Mushi Cloud plan limits on every `pricing_plans` row. `--print-commands` prints the full file.
`mushi.edge_function_post` (every cron job) reads `supabase_url` and
`service_role_key`; pipeline recovery reads `internal_caller_token`.

### Optional cron schedules

The migrations schedule the core jobs. These are extra; they use the same
`mushi.edge_function_post` helper. Do **not** use
`current_setting('app.settings.…')`: it returns NULL on hosted Supabase and the
job fails silently every tick.

```sql
SELECT cron.schedule('mushi-mistake-clusterer', '0 */6 * * *',
  $$ SELECT mushi.edge_function_post('mistake-clusterer', '{}'::jsonb); $$);
SELECT cron.schedule('mushi-drift-walker', '0 3 * * *',
  $$ SELECT mushi.edge_function_post('drift-walker', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$);
SELECT cron.schedule('mushi-anomaly-detector', '0 * * * *',
  $$ SELECT mushi.edge_function_post('anomaly-detector', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$);
```

### Other integrations

- `POST /v1/intake/voice` (in `api`) takes a project API key with the `voice:write` scope; enable `voice_intake_enabled` per project in the console first. Transcription uses the project's OpenAI key (`gpt-transcribe`, then `gpt-4o-mini-transcribe`); audio is deleted after transcription unless `voice_audio_retention_days` is set.
- Telegram: create a bot with @BotFather, paste the token in the project's Voice intake settings (stored as a vault reference), call `POST /v1/admin/telegram/setup` (registers the webhook at `<SUPABASE_URL>/functions/v1/telegram-webhook?project=<id>` with a secret token), mint a bind code with `POST /v1/admin/telegram/bind-code`, then send `/start <code>` to the bot.
- Slack: re-install the app from `packages/plugin-slack-app/manifest.json` (scopes `files:read`, `commands`, history events) after deploying `api`; Slack verifies the Events URL on save.
- Cursor Cloud: `autofix_agent = 'cursor_cloud'` or `mushi fix --agent cursor_cloud`; uses the v1 API with the project's Cursor key. Completion is polled by `agent-status-poll` (cron `5-55/5`); set `CURSOR_USE_V0_WEBHOOK=1` to use the v0 callback into `cursor-webhook` instead (secret derived from `MUSHI_INTERNAL_CALLER_SECRET`).
- GitHub cloud agent: `autofix_agent = 'github_cloud_agent'`; needs a user-to-server token (fine-grained PAT with "Agent tasks" read+write plus Contents and Pull requests, or a GitHub App user token) stored as `project_settings.github_user_token_ref` or `GITHUB_TOKEN`, and a Copilot plan with the coding-agent policy enabled. Installation tokens are rejected by GitHub.
- Web Push: set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:) as edge secrets; the installed console PWA subscribes devices.

> **Re-deploys overwrite source.** Supabase keeps the uploaded bundle as the
> source of truth; a deploy of a stale `index.ts` silently drops new routes.
> After deploying, check `GET /v1/health`: its `version` is the deployed commit.

## Docker Compose (experimental)

`deploy/docker-compose.yml` runs the whole stack without a Supabase account:
Postgres, Auth, PostgREST, Storage (Supabase's images), every edge function in
one `supabase/edge-runtime` container, the console, and Caddy as the gateway.
It has not been run end to end yet; expect to fix things.

```bash
./deploy/generate-secrets.sh          # or: npx mushi-mushi selfhost secrets
# optional: add ANTHROPIC_API_KEY or OPENAI_API_KEY to deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
# console + API: http://localhost  (MUSHI_PUBLIC_URL; a domain gets TLS)
```

The secrets script writes a random Postgres password, JWT secret and internal
caller secret, and signs the anon and service_role JWTs with that JWT secret,
so you never mint JWTs by hand. Compose refuses to start without them. The
`migrate` service applies the migrations after Auth and Storage create their
schemas, then points `mushi_runtime_config` at the internal gateway
(`http://caddy:8000`) and lifts the plan limits. Not included: Realtime (the
console's live updates need a reload), SMTP (sign-up is auto-confirmed), Studio.
Known gap: signed Storage URLs are built from the internal gateway, so
screenshot links handed to the browser may not load yet.

## Pipeline Flow

```
SDK → api (ingestion) → fast-filter (Haiku Stage 1)
                            ↓ (low confidence)
                       classify-report (Sonnet Stage 2)
```

## Scheduling judge-batch

The `judge-batch` function runs nightly LLM-as-Judge quality evaluation. Schedule it with `pg_cron`, using the same `mushi.edge_function_post` helper as the [other schedules](#optional-cron-schedules) (it needs the runtime config `selfhost up` writes) — do **not** use `current_setting('app.settings.…')`, which returns NULL on hosted Supabase and fails silently):

```sql
SELECT cron.schedule(
  'mushi-judge-batch',
  '0 3 * * *',
  $$ SELECT mushi.edge_function_post('judge-batch', '{}'::jsonb); $$
);
```

Or use an external cron service (GitHub Actions, cron-job.org, etc.) that POSTs to the function URL.

## Security Notes

**Edge function auth:** The `api` function authenticates via API key (hashed lookup in `project_api_keys`) and JWT (Supabase auth). Internal functions (`fast-filter`, `classify-report`, `judge-batch`, `intelligence-report`, `generate-synthetic`) authenticate via `SUPABASE_SERVICE_ROLE_KEY` comparison. Only the `api` function should be exposed to the internet. The others should be invoked server-side (by `api` or by `pg_cron`).

**Screenshot capture limitations:** The SDK captures screenshots using canvas/SVG `foreignObject` serialization. This approach does not work with cross-origin iframes, tainted `<canvas>` elements, or pages with strict Content Security Policies. It works well on most single-origin SPAs.

**Fix agent sandbox:** If you enable the agentic fix pipeline, be aware that `packages/agents/src/sandbox.ts` generates a security spec document describing intended container constraints (gVisor, network isolation, resource limits) but does **not** enforce them at runtime. The fix agent runs with the permissions of the host process. Implement your own container isolation (Docker, gVisor, Firecracker) before running fix agents in production.

**PII scrubbing:** The built-in PII scrubber (`_shared/pii-scrubber.ts`) uses regex-based redaction for emails, SSNs, phone numbers, and credit card numbers. It is not a full DLP solution — review your compliance requirements and consider additional scrubbing for your use case.

**Row-level security:** All tables have RLS enabled. However, the Edge Functions use the service role client which bypasses RLS. If you add custom Edge Functions or API routes, always scope queries by `project_id`.

**Extensions in `public` schema:** `vector` and `pg_net` are installed in `public`
on Supabase managed projects (the platform doesn't allow `ALTER EXTENSION ... SET
SCHEMA` because the extensions are owned by an internal role you can't access).
This is flagged as a `WARN` by the database linter but cannot be remediated
without a destructive `DROP EXTENSION CASCADE`, which would drop every
embedding column in `report_embeddings`. The functions still live in the
correct namespaces (`vector.*`, `net.*`) so this has no functional impact.

**Auth hardening:** Two further `WARN`s require dashboard configuration that
isn't covered by migrations:

1. **Leaked-password protection** (`auth_leaked_password_protection`): In the
   [Supabase dashboard](https://app.supabase.com) → your project →
   **Authentication** → **Sign In / Sign Up** → **Password Security** → enable
   **HaveIBeenPwned password check**. This prevents users from setting passwords
   that appear in public breach datasets.

2. **MFA / second factor** (`auth_insufficient_mfa_options`): Navigate to
   **Authentication** → **Providers** → enable at least one second factor beyond
   email (e.g. **TOTP authenticator app** or **SMS**). With only password auth
   enabled, Supabase flags the project as having insufficient MFA options. TOTP
   via Google Authenticator is the recommended option for self-hosters — it has
   no SMS cost and works offline.

Both are dashboard-level toggles on Supabase managed projects. For self-hosted
Supabase (running `supabase start` locally or self-managed Postgres), set the
equivalent `GOTRUE_*` environment variables in your `supabase/config.toml`:

```toml
[auth]
# Enable HaveIBeenPwned leaked-password check
enable_pwned_passwords = true

[auth.mfa]
# Enable TOTP as a second factor
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

---

## Running multi-region

Deploy one Helm chart per region and configure each with `global.region` and
`global.peerRegions`. The chart injects `MUSHI_CLUSTER_REGION` and
`MUSHI_PEER_REGIONS` into the API pod so edge functions can tag reports with
the correct `data_residency_region`.

Helm's `--set` and `--set-string` split on unescaped commas, so escape the
comma in `peerRegions` and single-quote the argument to keep the backslash.

```bash
# Deploy US region
helm install mushi-us ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-us.internal \
  --set global.region=us \
  --set-string 'global.peerRegions=eu\,jp'

# Deploy EU region
helm install mushi-eu ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-eu.internal \
  --set global.region=eu \
  --set-string 'global.peerRegions=us\,jp'
```

Set up GeoDNS (Route 53 latency routing, Cloudflare load balancer, etc.) to
route `api.mushimushi.io` to the nearest regional ALB.

For Postgres logical replication setup (publish on source → subscribe on
target) and DNS configuration details, see
[`docs/runbooks/region-routing-replication.md`](./runbooks/region-routing-replication.md).

> **Current limitation**: Full active/active write replication is not automated.
> `region_routing` replicates read-only; write routing relies on client-side
> GeoDNS stickiness. Cross-region write conflicts are the operator's
> responsibility.

---

## Headless bootstrap (`MUSHI_INIT_*`) — currently broken

> **Does not work today (2026-11-18).** `POST /v1/admin/bootstrap` inserts
> `organizations` without the required `slug` and `owner_id`, and `projects`
> without `slug`, so it returns `ORG_CREATE_FAILED` / `PROJECT_CREATE_FAILED`.
> Create the first account, project and key in the console and with
> `mushi login` (see the [Quickstart](#quickstart-5-commands)). The section
> below describes the intended behaviour, kept for when the route is fixed.

Mirror of [Langfuse's `LANGFUSE_INIT_*`](https://langfuse.com/docs/self-hosting) pattern.
When these environment variables are set, the Mushi API bootstraps an initial
organisation, project, and reporter API key on the first authenticated request
— useful for IaC, Docker Compose, CI seeds, and one-click deploys.

Set the following Supabase secrets (all optional; omit any you don't need):

```bash
# Org
npx supabase secrets set MUSHI_INIT_ORG_NAME="My Team"
npx supabase secrets set MUSHI_INIT_ORG_ID="00000000-0000-0000-0000-000000000001"   # optional, makes idempotent

# Project
npx supabase secrets set MUSHI_INIT_PROJECT_NAME="Production"
npx supabase secrets set MUSHI_INIT_PROJECT_ID="00000000-0000-0000-0000-000000000002"  # optional, makes idempotent

# First reporter key (mushi_... format); written as a pre-hashed key
npx supabase secrets set MUSHI_INIT_REPORTER_KEY="mushi_mystaticreporterkey123"
```

Then call the bootstrap endpoint (once, after `supabase db push`):

```bash
curl -X POST https://YOUR_REF.supabase.co/functions/v1/api/v1/admin/bootstrap \
  -H "Authorization: Bearer $(npx supabase projects api-keys --project-ref YOUR_REF | grep service_role | awk '{print $NF}')" \
  -H "Content-Type: application/json" \
  --data '{}'
```

The endpoint is idempotent — it skips creation when the org/project/key already exists.
The response lists what was created and what was skipped.

> **Security note**: the bootstrap endpoint requires a service-role JWT. Never
> expose it to the public internet without auth.
