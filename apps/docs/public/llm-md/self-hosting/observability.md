# Langfuse + Sentry

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/observability

---
title: Langfuse + Sentry
description: Wire Langfuse LLM tracing and Sentry error tracking into a self-hosted Mushi Mushi server. The Edge Function secrets and what each trace records.
---

# Observability

Mushi Mushi integrates Langfuse (LLM traces) and Sentry (error tracking). Both are optional and configured as Edge Function secrets.

## Langfuse (LLM tracing)

When the Langfuse keys are set, LLM calls are traced to Langfuse with the model, token counts, latency and metadata such as the project and report IDs (string metadata is PII-scrubbed first). Every call is also recorded in the `llm_invocations` table, Langfuse or not.

```bash
cd packages/server
npx supabase secrets set LANGFUSE_PUBLIC_KEY=pk-lf-…
npx supabase secrets set LANGFUSE_SECRET_KEY=sk-lf-…
npx supabase secrets set LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

`LANGFUSE_BASE_URL` is the canonical name (matches root `.env.example`). Docker Compose and older snippets may use `LANGFUSE_HOST` — edge code accepts both.

Replace `LANGFUSE_BASE_URL` with your self-hosted Langfuse URL if needed.

  Which key paid for a call is recorded in `llm_invocations.key_source` (`byok` or `env`), not in Langfuse. See [BYOK](/security/byok).

### What gets traced

| Trace | Function |
| --- | --- |
| Report classification | `fast-filter`, `classify-report` |
| Fix generation | `fix-worker` |
| Classification grading | `judge-batch` |
| Intelligence report | `intelligence-report` |
| PDCA iteration | `pdca-runner` |

### Viewing traces

In Langfuse: **Traces**, then filter by the project ID in the trace metadata. The **Health** page in the Mushi admin console lists recent LLM calls from `llm_invocations`, each with its Langfuse trace ID.

## Sentry (error tracking)

Every Edge Function wraps its handler with `withSentry()` from `_shared/sentry.ts`. Unhandled exceptions are forwarded to Sentry automatically.

```bash
cd packages/server
npx supabase secrets set SENTRY_DSN_SERVER=https://…@sentry.io/…   # SENTRY_DSN also works
npx supabase secrets set SUPABASE_ENV=production                     # Sentry environment
npx supabase secrets set SENTRY_RELEASE=$GIT_SHA
```

### Admin SPA Sentry

The Vite SPA also ships a Sentry integration. Pass the DSN at build time:

```bash
VITE_SENTRY_DSN=https://…@sentry.io/… pnpm --filter "@mushi-mushi/admin..." build
```

## OpenTelemetry

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, `classify-report` exports an OTLP span for each classification, as a child of the ingest request's `traceparent` when there is one. Point it at your collector (`OTEL_EXPORTER_OTLP_HEADERS` adds auth headers):

```bash
npx supabase secrets set OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector/v1/traces
```

Spans carry `report.id` and `project.id` attributes so you can join them back to Mushi data.

## Health dashboard

After deploying, open **Mushi health** (`/health`) in the admin console. It shows
the AI calls behind diagnoses and fixes (count, error rate, fallback rate,
latency and cost) and the background jobs' last runs. Integration probes
(Anthropic, OpenAI, Langfuse, Sentry, GitHub) are on the **Integrations** page.
