# Frontend ↔ API Audit — 2026-04-21

**Scope:** `apps/admin` (React 19 / Vite 8) ↔ `packages/server/supabase/functions/api` (Hono on Deno)
**Method:** Static contract diff, runtime validation gap analysis, dedup-cache verification, Sentry corroboration, OWASP API Top-10 cross-check.
**Inventory:** 100 Hono routes (`app.get/post/put/patch/delete`), ~120 `apiFetch<T>(...)` call sites across 30 admin files.

---

## TL;DR — top findings

| ID | Severity | Finding | Quick fix |
|----|----------|---------|-----------|
| **FE-API-1** | **P0** | **Zero runtime validation of API responses.** All `apiFetch<T>` calls trust the TypeScript generic. A backend regression that drops a field is invisible until a component crashes. Backend uses Zod heavily (Stage 1/2 LLM outputs, settings) but the FE has 0 Zod schemas. | Define one Zod schema per high-traffic endpoint (`/v1/admin/dashboard`, `/v1/admin/setup`, `/v1/admin/projects`) and fail soft with a Sentry breadcrumb on parse failure. |
| **FE-API-2** | **P1** | `apiFetchRaw` does **not** send `Content-Type: application/json` and does **not** generate Sentry breadcrumbs/captures on failure. Used for streaming and CSV but inconsistent with `apiFetch` observability. | Mirror the breadcrumb logic in `apiFetchRaw`. |
| **FE-API-3** | **P1** | 200 ms dedup cache is keyed by `path` alone — query strings included, but **headers are not part of the key**. Two callers passing different `If-None-Match` or auth scopes will collide. Today no caller does this, but it is a subtle footgun. | Either document the constraint or hash relevant headers into the key. |
| **FE-API-4** | **P2** | 5xx → `Sentry.captureMessage` lacks fingerprinting, so every 5xx endpoint+status combo creates a new Sentry issue. Verified live: `mushi-mushi-admin` shows 5 unresolved issues, several are duplicates of the same backend route. | Add `fingerprint: ['api-5xx', method, path]` to the Sentry call. |
| **FE-API-5** | **P2** | 4xx responses are **not** captured at all. Validation/auth bugs (e.g. expired JWTs after a deploy) are invisible to product. | Sample 4xx breadcrumbs (already done) and `captureMessage` 422/409 at 5–10% rate. |
| **FE-API-6** | **P2** | Cloud-fallback baked into client (`RESOLVED_API_URL` defaults to Mushi-Mushi Cloud). Self-hosters must set `VITE_API_URL` or the admin will silently call the SaaS. | Surface a "connected to SaaS — set VITE_API_URL to point at your own server" banner when the fallback is active. |

---

## 1. Inventory

- **Backend:** `packages/server/supabase/functions/api/index.ts` registers **100** Hono routes. Two large families dominate: `/v1/admin/*` (JWT-gated) and `/v1/reports*` (project API-key-gated). Public routes are limited to `/health`, `/.well-known/agent-card`, `/v1/agent-card`, `/v1/admin/auth/manifest`, `/v1/admin/auth/token`, `/v1/region/resolve`, `/v1/marketplace/plugins`, and three webhook receivers (Sentry, Sentry-Seer, GitHub) which gate inside the handler via HMAC.
- **Frontend:** ~120 `apiFetch` invocations spread across pages and feature components. The hottest paths are `/v1/admin/setup` (called from ~17 mount-time hooks), `/v1/admin/dashboard`, `/v1/admin/billing`.
- **Auth:** Single token cache in `apps/admin/src/lib/supabase.ts:17`, refreshed on `onAuthStateChange`. 30 s skew tolerance.

## 2. Contract diff: FE call sites vs backend routes

I cross-referenced `apiFetch('/...')` literals against `app.<verb>('/...')` declarations. Sample of mismatches/risks:

| FE call | Backend route | Status |
|---------|---------------|--------|
| `GET /v1/admin/setup` | `app.get('/v1/admin/setup'…)` | ✅ matches; hottest path |
| `POST /v1/admin/projects` | `app.post('/v1/admin/projects'…)` | ✅ |
| `POST /v1/admin/judge/run` | `app.post('/v1/admin/judge/run'…)` | ✅ |
| `GET /v1/admin/intelligence/findings` | `app.get('/v1/admin/intelligence/findings'…)` | ✅ |
| `POST /v1/admin/dlq/replay` | exists | ✅ |
| `POST /v1/admin/firecrawl/scrape` | exists, FE in `FirecrawlPanel.tsx` | ✅ |
| `POST /v1/admin/byok` | exists | ✅ |

All sampled FE paths resolve to a backend route. **No 404-shaped contract drift was found.** What is missing is *shape* validation — see FE-API-1.

## 3. Runtime validation — the silent killer

**`grep -c 'z\.object\|zod\|Zod' apps/admin/src` → 0 matches.**
The FE imports zero Zod schemas. Every `apiFetch<DashboardSummary>(…)` is an unchecked cast. This is the single highest-leverage quality gap in the FE-API contract.

Concrete impact (corroborated by Sentry `mushi-mushi-admin`):
- One unresolved issue is a `TypeError: Cannot read properties of undefined (reading 'count')` after a backend rename of a dashboard field. A Zod parse would have produced a structured "schema drift" Sentry event with the offending field name *and* let the page render a fallback.

**Recommended minimum:** wrap the top-10 hottest endpoints with Zod schemas. Example pattern:

```ts
import { z } from 'zod'
const DashboardSummary = z.object({
  reports_total: z.number(),
  open_count: z.number(),
  // …
})
const result = await apiFetch<unknown>('/v1/admin/dashboard')
const parsed = DashboardSummary.safeParse(result.data)
if (!parsed.success) {
  Sentry.captureMessage('schema-drift /v1/admin/dashboard', {
    level: 'warning',
    extra: { issues: parsed.error.issues },
  })
}
```

## 4. Dedup + micro-cache validation

The 200 ms TTL / 64-entry FIFO cache in `apps/admin/src/lib/supabase.ts:41-127` is well-implemented:

✅ Only dedupes idempotent verbs (`GET`/`HEAD`).
✅ Bypassed on `cache: 'no-store'`.
✅ FIFO eviction by Map-insertion-order is correct.
✅ Stale entries are eagerly deleted on read (lines 106-108) so the map self-trims.
✅ `invalidateApiCache(prefix)` exists for post-mutation invalidation and is used by `useSetupStatus` and the Projects page.

The whitepaper claim that "17 components calling `useSetupStatus` would otherwise fire 12+ parallel /setup requests" is **plausible**: I counted 19 imports of `useSetupStatus`/`useDashboard`/`useBilling` across pages and components. Without dedup that would be measurably wasteful. The implementation is sound.

**Risk:** the cache key (`coalesceKey`) does not include headers. If anyone introduces per-request `Authorization` overrides or `If-None-Match`, the cache will return wrong results. Add a guard.

## 5. Sentry observability

`apiFetch` produces:
- a breadcrumb for every non-2xx (warn for 4xx, error for 5xx)
- a `captureMessage` for every 5xx (with `tags.api_path`)
- a `captureException` for every network/abort error
- a path-only URL (no Supabase project ref leak)

Strengths:
- consistent `tags.source = 'apiFetch'` makes Sentry filtering easy
- breadcrumbs include `duration_ms`
- the 5xx capture preserves a 500-byte response snippet for repro

Gaps:
- **no fingerprint** ⇒ noisy issue list (FE-API-4)
- **no 4xx capture** ⇒ silent validation failures (FE-API-5)
- `apiFetchRaw` has *no* Sentry hooks at all (FE-API-2)

## 6. CORS / OWASP API spot-check

- `Hono /api/*` uses `cors({ origin: '*' })` — open by design because anonymous reporting clients (browsers) need to POST `/v1/reports`. Acceptable because every admin route is gated by JWT and every reporting route by API key. Not a gap.
- `Authorization: Bearer <jwt>` is sent on every call. ✅
- No CSRF token is needed because all state-changing routes require a Bearer token (not a cookie). ✅
- No `credentials: 'include'` is used on the FE — correct given the auth model.
- **Loading/error UX:** spot-checks of `DashboardPage.tsx`, `ReportsPage.tsx`, `JudgePage.tsx` all use `result.ok` checks and show a graceful `result.error.message`. No silent swallows found.

## 7. Hono routes that are unused by the FE

A handful of backend routes have no admin UI counterpart — they are reachable only via SDK or scripts:
- `/v1/region/resolve`
- `/v1/agent-card` and `/.well-known/agent-card`
- `/v1/marketplace/plugins/install/start`, `/finish`, `/reset` (only `/install/start` is wired in `MarketplacePage`)

This is fine — they're documented surface for SDK callers — but worth noting that some `marketplace/plugins/install/finish` flows are unreachable from the UI and may be dead code. **Recommendation:** add an integration test or remove.

---

## Priority recommendations

1. **(P0)** Add Zod schemas for the top-10 endpoints. Estimated effort: 1 day. Estimated value: removes the entire class of "silent shape drift" bugs.
2. **(P1)** Mirror Sentry instrumentation into `apiFetchRaw`.
3. **(P1)** Add Sentry fingerprinting to 5xx captures.
4. **(P2)** Sample 4xx captures at 5–10%.
5. **(P2)** Surface a "connected-to-SaaS" banner when the cloud fallback is active.

**Sentry corroboration:** `mushi-mushi-admin` has 5 unresolved issues in the last 14 days. None are P0. The dominant categories — schema drift TypeErrors and AbortError noise — are *exactly* what FE-API-1, FE-API-4, and FE-API-5 would suppress.
