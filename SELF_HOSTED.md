# Self-Hosted Deployment Guide

Minimal guide to get Mushi Mushi running on your own Supabase project.

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
```

## 4. Deploy Edge Functions

Three functions are required for the core pipeline:

```bash
npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy fast-filter --no-verify-jwt
npx supabase functions deploy classify-report --no-verify-jwt
```

Optional functions:

```bash
npx supabase functions deploy judge-batch --no-verify-jwt
npx supabase functions deploy intelligence-report --no-verify-jwt
npx supabase functions deploy generate-synthetic --no-verify-jwt
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
curl https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health
# Should return: {"status":"ok","version":"1.0.0"}
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

The `judge-batch` function runs nightly LLM-as-Judge quality evaluation. Schedule it with `pg_cron`:

```sql
SELECT cron.schedule(
  'mushi-judge-batch',
  '0 3 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/judge-batch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )$$
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
isn't covered by migrations: enable HaveIBeenPwned-based leaked-password
protection in **Authentication → Policies**, and turn on at least one
additional MFA factor in **Authentication → Providers**.
