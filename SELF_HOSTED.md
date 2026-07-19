# Self-Hosted Deployment Guide

Minimal guide to get Mushi Mushi running on your own Supabase project.

> **Fastest path:** from a clone of this repo, run
> `npx mushi-mushi@latest selfhost up --project-ref <your-ref>` — it wraps
> every step below (link → db push → secrets → function deploys → bucket →
> bootstrap) and ends with a health-check proof step. No Supabase CLI?
> Pass `--print-commands` to get the exact commands to copy-paste.
> Afterwards, `mushi selfhost doctor` verifies the deployment end to end.
> The manual steps below remain the reference for what "up" does.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- A Supabase project (free tier works)
- An [Anthropic API key](https://console.anthropic.com/)
- (Optional) An [OpenAI API key](https://platform.openai.com/) for LLM failover

## 1. Clone and configure

```bash
git clone https://github.com/kensaurus/mushi-mushi.git
cd mushi-mushi/packages/server/supabase
```

Link to your Supabase project:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

## 2. Run database migrations

```bash
npx supabase db push
```

This creates all tables, RLS policies, indexes, and RPCs.

## 3. Set secrets

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# Optional: failover provider
npx supabase secrets set OPENAI_API_KEY=sk-...

# Required for report deep-links in Slack / Discord notifications.
# Set this to the base URL of your deployed admin console (no trailing slash).
# Example: https://your-domain.example.com/admin
# On kensaur.us this is: https://kensaur.us/mushi-mushi/admin
# When unset, notification buttons degrade gracefully (no URL, no crash).
npx supabase secrets set ADMIN_BASE_URL=https://your-domain.example.com/admin
```

## 4. Deploy Edge Functions

Three functions are required for the core ingest + classification pipeline:

```bash
npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy fast-filter --no-verify-jwt
npx supabase functions deploy classify-report --no-verify-jwt
```

Also deploy **`mcp`** if you use the hosted MCP transport:

```bash
npx supabase functions deploy mcp --no-verify-jwt
```

Deploy every directory under `packages/server/supabase/functions/` except `_shared`, or mirror [`.github/workflows/deploy-edge-functions.yml`](.github/workflows/deploy-edge-functions.yml). Run `pnpm docs-stats` for the current function count.

Optional functions:

```bash
npx supabase functions deploy judge-batch --no-verify-jwt
npx supabase functions deploy intelligence-report --no-verify-jwt
npx supabase functions deploy generate-synthetic --no-verify-jwt
```

### Closed-loop evolution functions (Phase 1–6)

All six phases of the closed-loop pipeline have self-hosted parity. Deploy them with:

```bash
# Phase 1 — Mistake clustering + lessons
npx supabase functions deploy mistake-clusterer --no-verify-jwt
npx supabase functions deploy mistake-summarizer --no-verify-jwt

# Phase 2 — Release builder
npx supabase functions deploy release-builder --no-verify-jwt

# Phase 3 — PDCA autonomous iteration
npx supabase functions deploy pdca-runner --no-verify-jwt

# Phase 4 — Contract drift detection
npx supabase functions deploy contract-graph-builder --no-verify-jwt
npx supabase functions deploy drift-walker --no-verify-jwt

# Phase 5 — A/B experiment analyzer
npx supabase functions deploy experiment-analyzer --no-verify-jwt

# Phase 6 — Anomaly detection
npx supabase functions deploy anomaly-detector --no-verify-jwt
```

#### Required secrets for closed-loop functions

```bash
# Already required for classify-report:
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set OPENAI_API_KEY=sk-...

# Required for mistake-clusterer + pdca-runner (OpenAI embeddings):
npx supabase secrets set OPENAI_API_KEY=sk-...
```

#### Recommended pg_cron schedules

Use `mushi.edge_function_post(fn_name, body)` — the same helper every
healthy cron job on the hosted project uses. **Do not** use
`current_setting('app.settings.supabase_url')` / `service_role_key`; those
GUCs return NULL on hosted Supabase and pg_cron will fail silently every
tick with `null value in column "url" of relation "http_request_queue"`.

Prerequisites (once per project):

```sql
-- Mirror the internal caller token + project URL into mushi_runtime_config
-- (the hosted project already has these; self-hosted operators set them once):
INSERT INTO public.mushi_runtime_config (key, value) VALUES
  ('supabase_url', 'https://YOUR_PROJECT_REF.supabase.co'),
  ('service_role_key', 'YOUR_INTERNAL_CALLER_SECRET'),
  -- Required by the pipeline-recovery cron (recover_stranded_pipeline):
  -- generate one secret (e.g. `openssl rand -hex 32`) and use the SAME value
  -- for this row and the MUSHI_INTERNAL_CALLER_SECRET function secret below.
  -- If this row is missing, recovery runs log status='skipped' in cron_runs
  -- and stranded reports are never retried.
  ('internal_caller_token', 'YOUR_INTERNAL_CALLER_SECRET')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

```bash
# The matching function secret (edge functions verify recovery calls with it):
npx supabase secrets set MUSHI_INTERNAL_CALLER_SECRET=YOUR_INTERNAL_CALLER_SECRET
```

Verify recovery is healthy after setup (should show `success`/`degraded`, not
`skipped`, and `responses_failed: 0` once reconciled):

```sql
SELECT status, metadata FROM cron_runs
 WHERE job_name = 'pipeline-recovery'
 ORDER BY finished_at DESC LIMIT 3;
```

Schedules:

```sql
-- Mistake clusterer: every 6 hours
SELECT cron.schedule(
  'mushi-mistake-clusterer',
  '0 */6 * * *',
  $$ SELECT mushi.edge_function_post('mistake-clusterer', '{}'::jsonb); $$
);

-- Drift walker: daily at 03:00 UTC (per project — adapt body)
SELECT cron.schedule(
  'mushi-drift-walker',
  '0 3 * * *',
  $$ SELECT mushi.edge_function_post('drift-walker', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$
);

-- Anomaly detector: hourly
SELECT cron.schedule(
  'mushi-anomaly-detector',
  '0 * * * *',
  $$ SELECT mushi.edge_function_post('anomaly-detector', '{"project_id":"YOUR_PROJECT_ID"}'::jsonb); $$
);
```

> **Re-deploys overwrite source.** Supabase keeps the file bundle as the source
> of truth; if a deploy uploads a stale `index.ts` (e.g. you forgot to save before
> deploying) the function will silently miss new routes. After deploying, smoke
> the endpoints with `curl` to catch this. We hit it during initial admin route
> rollout — see commit history for the affected revision.

## 5. Create a Supabase storage bucket

In your Supabase dashboard, create a storage bucket named `screenshots` with public access.

## 6. Verify the deployment

```bash
# API liveness (process up — does not prove DB)
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health
# Should return: {"status":"ok","version":"1.0.0",…}

# API readiness (fails when Postgres is unreachable)
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health/ready

# Standalone healthz edge function (no JWT; cheap DB probe)
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/healthz
# Should return: {"status":"ok","db":"ok","version":"…"}  (or status "degraded" if DB probe fails)
```

## 7. Connect the SDK

```tsx
import { MushiProvider } from '@mushi-mushi/react'

function App() {
  return (
    <MushiProvider config={{
      projectId: 'YOUR_PROJECT_ID',
      apiKey: 'YOUR_API_KEY',
      apiEndpoint: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/api'
    }}>
      <YourApp />
    </MushiProvider>
  )
}
```

To get `projectId` and `apiKey`, sign in to the admin console or create them via SQL:

```sql
-- Create a project
INSERT INTO projects (name, slug)
VALUES ('My App', 'my-app')
RETURNING id;

-- Create an API key (save the raw key — it's shown only once)
-- Use the CLI: mushi login --api-key <key> --endpoint <url>
```

## 8. Run the Admin Console (optional)

```bash
cd apps/admin
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
pnpm install && pnpm dev
```

## Pipeline Flow

```
SDK → api (ingestion) → fast-filter (Haiku Stage 1)
                            ↓ (low confidence)
                       classify-report (Sonnet Stage 2)
```

## Scheduling judge-batch

The `judge-batch` function runs nightly LLM-as-Judge quality evaluation. Schedule it with `pg_cron`, using the same `mushi.edge_function_post` helper as the other schedules above (requires the [prerequisites](#recommended-pg_cron-schedules) — do **not** use `current_setting('app.settings.…')`, which returns NULL on hosted Supabase and fails silently):

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

```bash
# Deploy US region
helm install mushi-us ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-us.internal \
  --set global.region=us \
  --set global.peerRegions="eu,jp"

# Deploy EU region
helm install mushi-eu ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-eu.internal \
  --set global.region=eu \
  --set global.peerRegions="us,jp"
```

Set up GeoDNS (Route 53 latency routing, Cloudflare load balancer, etc.) to
route `api.mushimushi.io` to the nearest regional ALB.

For Postgres logical replication setup (publish on source → subscribe on
target) and DNS configuration details, see
[`docs/runbooks/region-routing-replication.md`](./docs/runbooks/region-routing-replication.md).

> **Current limitation**: Full active/active write replication is not automated.
> `region_routing` replicates read-only; write routing relies on client-side
> GeoDNS stickiness. Cross-region write conflicts are the operator's
> responsibility.

---

## Headless bootstrap (`MUSHI_INIT_*`)

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
