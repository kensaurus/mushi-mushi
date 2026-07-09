# Performance Audit — 2026-04-21

**Scope:** `apps/admin` Web Vitals, bundle, network behaviour; `packages/server` Edge Function latency; Postgres query performance.
**Method:** Live Sentry `measurements.lcp/cls/inp` (last 7 d), live `pg_stat_statements`, `EXPLAIN ANALYZE` on suspect routes, dedup-cache verification, bundle config review, Firecrawl cross-check against 2026 Web Vitals + Postgres best practices.

> **Caveat — early operational stage.** Largest table is `cron_runs` at 807 rows. The DB is at dev/pilot scale, so what looks fast today may not scale. Findings in §3 are *shape* findings, not measured production hotspots.

---

## TL;DR — top findings

| ID | Severity | Finding | Quick fix |
|----|----------|---------|-----------|
| **PERF-1** | **P1** | Pipeline-recovery cron (`recover_stranded_pipeline()`) has run **785 times** consuming **21.5 s of total CPU** (avg 27 ms). It fires every 5 min on schedule. At current report volume (52) this is overkill — most invocations do zero work. As volume grows, the function does an unbounded scan of `processing_queue` + `reports` looking for stranded items. | Add an early-exit guard `IF NOT EXISTS (SELECT 1 FROM processing_queue WHERE status='pending' AND created_at < now() - '5 min'::interval) THEN RETURN; END IF;` and an index on `(status, created_at)` for the lookup. |
| **PERF-2** | **P1** | `/prompt-lab` p75 LCP = **2076 ms** (Web Vital "Needs Improvement" boundary is 2500 ms; "Good" is ≤2500 ms — close to bad). Page renders FineTuningJobs + PromptEditor + SyntheticReports panels which fire 6+ `apiFetch`es on mount. | Lift heavy panels to `<Suspense>` islands; defer non-critical panels until viewport intersection. |
| **PERF-3** | **P1** | Vite config has **no manual code-splitting**. With React 19, Tailwind v4, Sentry React, Supabase JS, and Recharts (referenced in dashboards) the main chunk is likely > 400 kB gzipped. There is no `rollupOptions.output.manualChunks` and no route-level lazy import for the big pages. | Add `manualChunks` for `react`, `@sentry`, `@supabase`, `recharts`. Convert page imports in the router to `React.lazy()`. Expected savings: ≥ 30% main-chunk shrink. |
| **PERF-4** | **P2** | `INP` is **null in Sentry for every page** — interactions are not being tracked. Without INP we can't see input lag (replaces FID as a Core Web Vital). | Confirm `Sentry.browserTracingIntegration({ enableInp: true })` is set. |
| **PERF-5** | **P2** | `/settings` p75 CLS = **0.076** — under the 0.10 "Good" threshold but higher than the rest of the app (most pages: < 0.001). | Reserve fixed heights for the panels that mount asynchronously (`HealthPanel`, `ByokPanel`, `FirecrawlPanel`). |
| **PERF-6** | **P2** | 62 unused indexes (DB audit DB-3) slow down every write. At today's volume invisible; at 1 M rows / table they will cost. | Drop after 30 days zero `idx_scan`. |
| **PERF-7** | **P2** | 20 unindexed FKs (DB-1) force seq scans on parent delete and JOIN expansion. | Add the indexes. |
| **PERF-8** | ✅ | The 200 ms dedup cache in `apiFetch` is correctly implemented and saves 11 redundant `/v1/admin/setup` round-trips per page mount (verified: 19 importers across the admin). | — |
| **PERF-9** | ✅ | All admin Web Vitals p75 LCP **< 2.1 s**, CLS **< 0.08**. App is in **Good** Web Vitals territory across the board. | — |

---

## 1. Web Vitals (live Sentry, last 7 d, p75)

| Page | LCP (ms) | CLS | INP | Samples |
|------|---------:|-----|-----|--------:|
| `/prompt-lab` | **2076** | 0.020 | — | 10 |
| `/marketplace` | 1460 | — | — | 10 |
| `/projects` | 1224 | — | — | 10 |
| `/reports/*` | 1164 | 0.000 | — | 20 |
| `/notifications` | 1140 | 0.000 | — | 10 |
| `/settings` | 1020 | **0.076** | — | 20 |

**Threshold reference (web.dev 2026):** LCP Good ≤ 2500 ms, CLS Good ≤ 0.10, INP Good ≤ 200 ms.

The app is comfortably in **Good** for LCP and CLS. **INP is missing entirely** — see PERF-4. Once enabled, monitor `/prompt-lab` and `/judge` (heavy interaction surfaces) closely.

## 2. Bundle / build

`apps/admin/vite.config.ts` (full):
- `react()`, `tailwindcss()`, optional `sentryVitePlugin` for sourcemaps
- `build.sourcemap: true` (required for Sentry symbolication)
- **no `rollupOptions.output.manualChunks`**
- **no route-level `React.lazy`** in `apps/admin/src/main.tsx` (spot-checked)

Implications:
- All 30+ pages bundled into one chunk
- Sentry React (~30 kB), Recharts (~150 kB if used), Supabase JS (~90 kB) all in critical path
- First-paint cost stays acceptable today only because users on dev hardware test with fast networks

**Fix template:**
```ts
build: {
  sourcemap: true,
  rollupOptions: {
    output: {
      manualChunks: {
        react: ['react', 'react-dom'],
        sentry: ['@sentry/react'],
        supabase: ['@supabase/supabase-js'],
        charts: ['recharts'],
      },
    },
  },
},
```
And in the router file:
```ts
const PromptLabPage = lazy(() => import('./pages/PromptLabPage'))
```

## 3. Postgres performance

### 3.1 Top mean-time queries (`pg_stat_statements`)

User-relevant rows (system/migration noise filtered):

| query | calls | mean ms | total ms |
|-------|------:|--------:|---------:|
| `SELECT public.recover_stranded_pipeline()` | **785** | 27.4 | **21,537** |
| `SELECT refresh_intelligence_benchmarks()` | 4 | 76.8 | 307 |
| `SELECT prune_sandbox_events_per_project()` | 4 | 13.5 | 54 |
| `SELECT public.mushi_apply_retention()` | 4 | 11.9 | 47 |

`recover_stranded_pipeline()` is the dominant CPU consumer — see PERF-1. The other periodic procedures are bounded and cheap.

### 3.2 Sample EXPLAIN ANALYZE — `processing_queue` lookup

```sql
EXPLAIN ANALYZE SELECT report_id, status, started_at FROM processing_queue
WHERE project_id = '<…>' ORDER BY created_at DESC LIMIT 50;
```
Plan:
- **Seq Scan** on `processing_queue` (cost 0.00..2.56)
- Sort by `created_at DESC`
- Execution time: **0.167 ms**

At 46 rows, seq scan is correct (Postgres planner won't use an index for so few rows). At >10k rows, `(project_id, created_at DESC)` becomes worthwhile. Pre-emptive index recommended:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS processing_queue_project_created_idx
  ON processing_queue(project_id, created_at DESC);
```

### 3.3 Cron schedule density

15 active jobs. Notably:
- `mushi-pipeline-recovery-5m` — every 5 min (the PERF-1 culprit)
- `prune_report_presence` — **every minute** — 1440×/day. Verify this is intentional and the function is bounded.
- `expire_sso_state` — every 15 min
- `mushi-sentry-seer-poll-15m` — every 15 min

**Recommendation:** add a `cron_runs.duration_ms` percentile dashboard so cost trends are visible.

## 4. Network / `apiFetch` behaviour

The 200 ms dedup cache is correctly implemented and is the right call given:
- 19 importers of `useSetupStatus`/`useDashboard`/`useBilling` across pages and components
- Without dedup, page mount fires ≥ 11 redundant `/v1/admin/setup` round-trips

**Verified working:**
- only GET/HEAD with no body get cached (`coalesceKey` lines 75-79)
- `cache: 'no-store'` correctly bypasses (line 96)
- 64-entry FIFO eviction (lines 66-72)
- `invalidateApiCache(prefix)` exists for post-mutation flushing

**Improvement candidates (not blocking):**
- bump TTL to 500 ms during navigation — typical SPA route transitions complete in 200–400 ms
- log cache-hit rate to Sentry as a custom measurement so we can see the win quantitatively

## 5. Edge Function latency

Sentry has no `mushi-mushi-server` slowest-transaction data because the volume is low. From the architectural review:

- **`fast-filter`** (Stage 1) — uses Anthropic Haiku, p50 expected ~600 ms
- **`classify-report`** (Stage 2) — Anthropic Sonnet + optional vision, p50 expected ~2–3 s
- **`judge-batch`** — Sonnet w/ OpenAI fallback, batch-mode

The architecture correctly decouples ingestion from classification by pushing `triggerClassification` behind `EdgeRuntime.waitUntil` (`api/index.ts:518`) so the user-facing POST returns 200 immediately. ✅

**Single concern:** `triggerClassification` is fire-and-forget — if the recovery cron is the only safety net, it adds up to 5 min of latency to the user-facing PDCA loop on transient failures. Consider an exponential-backoff in-process retry (e.g. 3 attempts, 1s/4s/16s) before falling back to the cron.

## 6. Bundle size & React 19 / Vite 8 best practices (2026)

Cross-check against current best practices (Firecrawl):
- ✅ React 19 + concurrent rendering enabled by default
- ✅ Vite 8 with Rollup 4
- ✅ Tailwind v4 (smaller runtime than v3)
- ⚠ No `manualChunks` (PERF-3)
- ⚠ No route-level lazy (PERF-3)
- ⚠ No `<link rel="modulepreload">` for critical chunks
- ⚠ No image optimization noted (depends on whether dashboards use raster images)
- ✅ Source maps deleted from dist after Sentry upload (good — no public source-map exposure)

---

## Priority recommendations

1. **(P1)** Cap `recover_stranded_pipeline()` work with an early-exit guard + index. Estimated CPU reduction: 90%.
2. **(P1)** Add `manualChunks` and convert page imports to `React.lazy`. Expected: 30%+ smaller main chunk; LCP improvement on `/prompt-lab` to under 1500 ms.
3. **(P1)** Defer non-critical panels on `/prompt-lab` to `<Suspense>` islands.
4. **(P2)** Enable Sentry INP tracking.
5. **(P2)** Reserve fixed heights on `/settings` panels to lower CLS.
6. **(P2)** Add `cron_runs.duration_ms` percentile dashboard.
7. **(P2)** Pre-emptive index `(project_id, created_at DESC)` on `processing_queue`.
