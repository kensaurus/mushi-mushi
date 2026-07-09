# Performance audit — 2026-04-23

**Scope**: admin SPA (Vite/React), edge functions (Deno/Hono), Postgres, LLM call flow.
**Inputs**: Sentry `search_events` (none — see below), Supabase `get_advisors(performance)`, `cron.job_run_details`, `llm_invocations` table, source scan.

## Executive summary

| Area | Verdict | Top action |
|---|---|---|
| Admin SPA bundle | UNKNOWN | `vite.config.ts` ships no `manualChunks`; bundle analyzer not captured this session — keep Wave R's "add manualChunks for @tanstack/react-query, reactflow, recharts, @supabase/supabase-js" as the one Phase 2 delta |
| Admin SPA lazy loading | PARTIAL | `apps/admin/src/App.tsx` eagerly imports all 24 pages — only the 5 heaviest (`PromptLabPage`, `GraphPage`, `IntelligencePage`, `JudgePage`, `DashboardPage`) need `React.lazy` to cut first-paint meaningfully |
| Edge function latency (Plan→Classified) | PASS | End-to-end live run: 4 s (target < 10 s) |
| Edge function latency (Dispatch→PR) | PASS | End-to-end live run: 11.5 s (target < 30 s) |
| LLM prompt caching | FAIL | **0 / 17** calls in last 24 h had `cache_read_input_tokens > 0`; Wave R flagged silently-broken; still broken |
| Postgres hot functions | PASS | `recover_stranded_pipeline` now runs in ~150 ms / 5 min with 0 rows — was flagged as hot in Wave R; closed |
| Unused indexes | INFO | 83 reported by `pg_stat_user_indexes` — expected on fresh Wave Q/R indexes; keep |
| RLS initplan | WARN | 1 (`fix_events.fix_events_owner_select`) — one-line fix |

## Detail — admin SPA

### Route inventory and eagerness

24 top-level Advanced-mode routes, all imported at the top of `apps/admin/src/App.tsx`. That means the main bundle ships code for every page the user might visit even if they never do. A cold SPA load for `/reports` currently ships `recharts`, `reactflow`, `@tanstack/react-query`, Monaco-style diff deps (PromptLab), and Supabase SDK into the initial chunk.

Wave T Phase 2 will land one `vite.config.ts` patch:

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-query': ['@tanstack/react-query', '@tanstack/react-table'],
        'vendor-charts': ['recharts'],
        'vendor-graph': ['reactflow'],
        'vendor-supabase': ['@supabase/supabase-js'],
        'vendor-sentry': ['@sentry/react'],
      }
    }
  }
}
```

Plus `React.lazy(() => import('./pages/PromptLabPage'))` for the 5 heaviest pages (PromptLab, Graph, Intelligence, Judge, Dashboard) with a `Suspense` fallback matching our existing `PageSkeleton`.

### Memoisation coverage

Grepped `apps/admin/src/pages` for `useMemo` / `useCallback` / `React.memo`:

- 22 / 24 pages use `useMemo` for derived state (chart series, filter aggregations).
- 2 pages re-render on every parent update: `MCPPage`, `MarketplacePage`. Both are low-traffic; skip for Phase 2.

### Web Vitals (target)

Not captured this session (Lighthouse not run against the deployed admin because the admin deploy is gated on Phase 6). Wave R captured:

- `/` LCP: 1.4 s (good)
- `/prompt-lab` LCP: 2.3 s (needs improvement — manualChunks + lazy will bring this under 1.8 s)

## Detail — edge functions

### Live timings (this run)

| Call | p50 | p99 |
|---|---|---|
| `POST /v1/reports` (`api` → ingest + schema validate) | 1.3 s | — |
| `fast-filter` (LLM stage 1) | 3.0 s | — |
| `POST /v1/admin/fixes/dispatch` (synchronous dispatch queue insert) | 450 ms | — |
| `fix-worker` (LLM planning + apply + PR open) | 11.5 s | — |
| `anthropic` health probe | 644 ms | — |
| `judge-batch` (3 reports) | 2.0 s | — |

All within SLO.

### Sentry transactions (would-be source)

`mushi-mushi-server` has **0 transactions** in Sentry for last 14 d. Two possibilities:

1. `SENTRY_DSN_SERVER` not deployed to the function runtime (tracing silently off). Most likely — corroborated by zero error issues either.
2. `tracesSampleRate: 0` at the SDK level.

Phase 2 action: add `supabase secrets list` verification to the `check:publish-readiness` script.

## Detail — LLM cost + cache

`llm_invocations` last 24 h:

```
total_calls       : 17
with_cache_read   : 0
total_cost_usd    : $0.15
```

Wave R flagged: Anthropic prompt caching added in Wave Q, `cache_control: {type: 'ephemeral'}` is on the system prompts, but `cache_read_input_tokens` never logs > 0. Options:

1. The `logLlmInvocation` helper logs the anthropic response field under the wrong key. Likely — `npm:@ai-sdk/anthropic@1` surfaces `providerMetadata.anthropic.cacheReadInputTokens` not `cache_read_input_tokens`.
2. Cache key is drifting — prompt template concatenates something dynamic before the cached block.

Phase 4 action: patch the telemetry writer AND assert `> 0` on the next synthetic report.

## Recommendations (ordered by value)

1. **Phase 2 — Admin bundle**: `manualChunks` + lazy-load the 5 heaviest pages. Expected LCP saving on `/prompt-lab`: 500 ms.
2. **Phase 2 — `fix_events_owner_select` RLS initplan**: one-line fix, reduces per-row `auth.uid()` cost.
3. **Phase 2 — Deploy `SENTRY_DSN_SERVER`** to functions; add startup breadcrumb so next audit can confirm capture.
4. **Phase 4 — Fix prompt cache telemetry** so we can actually see the 90 % savings Anthropic quotes.
5. **Phase 5 — Replace Postgres advisory locks with Upstash Redis for `scoped_rate_limits`** (longer-term perf win, see Phase 5 readiness doc).
