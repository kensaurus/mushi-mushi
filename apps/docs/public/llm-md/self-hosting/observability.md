# Langfuse + Sentry

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/observability

---
title: Langfuse + Sentry
---

# Observability

Mushi ships with first-class Langfuse (LLM traces) and Sentry (error tracking) integration. Both are configured as Edge Function secrets.

## Langfuse (LLM tracing)

Every LLM invocation is wrapped in a Langfuse trace with the prompt version, model, token usage, latency, cost, and `key_source` (`tenant` vs `platform`).

```bash
cd packages/server
npx supabase secrets set LANGFUSE_PUBLIC_KEY=pk-lf-…
npx supabase secrets set LANGFUSE_SECRET_KEY=sk-lf-…
npx supabase secrets set LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

`LANGFUSE_BASE_URL` is the canonical name (matches root `.env.example`). Docker Compose and older snippets may use `LANGFUSE_HOST` — edge code accepts both.

Replace `LANGFUSE_BASE_URL` with your self-hosted Langfuse URL if needed.

  BYOK traces include `key_source: "tenant"` so you can filter Langfuse by tenant vs platform usage. See [BYOK](/security/byok) for details.

### What gets traced

| Trace | Function | Prompt version key |
| --- | --- | --- |
| Report classification | `classify-report` | `mushi-classifier-v*` |
| Fix generation | `fix-worker` | `mushi-fixer-v*` |
| Fix judgment | `judge-batch` | `mushi-judge-v*` |
| Intelligence report | `intelligence-report` | `mushi-intel-v*` |
| PDCA iteration | `pdca-runner` | tracked per model config |

### Viewing traces

In Langfuse: **Traces** → filter by `project_id` (the Langfuse trace tag matches the Mushi project ID). The **Health** page in the Mushi admin console shows recent LLM call logs pulled from Langfuse.

## Sentry (error tracking)

Every Edge Function wraps its handler with `withSentry()` from `_shared/sentry.ts`. Unhandled exceptions are forwarded to Sentry automatically.

```bash
cd packages/server
npx supabase secrets set SENTRY_DSN=https://…@sentry.io/…
npx supabase secrets set SENTRY_ENVIRONMENT=production
npx supabase secrets set SENTRY_RELEASE=$GIT_SHA
```

### Admin SPA Sentry

The Vite SPA also ships a Sentry integration. Pass the DSN at build time:

```bash
VITE_SENTRY_DSN=https://…@sentry.io/… pnpm --filter @mushi-mushi/admin build
```

## OpenTelemetry

The fix orchestrator emits OTel spans for every sandbox lifecycle event, agent tool call, and PR creation. Point your collector at the standard endpoint:

```bash
npx supabase secrets set OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector/v1/traces
```

Spans include `report_id`, `attempt_id`, and `stage` tags so you can join OTel traces back to Mushi data.

## Health dashboard

After deploying, check **Settings → Health** in the admin console. It shows:
- Provider probe status (Anthropic, OpenAI, Langfuse, Sentry, GitHub)
- Recent LLM call latency and cost
- Cron job last-run timestamps
- Any `degraded` or `error` probes with actionable error codes
