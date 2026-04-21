# API Route Audit — 2026-04-21

Wave T audit of `packages/server/supabase/functions/api/index.ts` against
front-end consumers in `apps/admin/src/**`. Goal: zero advertised-but-missing
endpoints, zero unreachable handlers, every JWT-gated route accounted for.

## Method

1. Grep every `app.<method>('/v1/admin/...')` registration in `index.ts`.
2. Grep every `apiFetch[Raw]?(... '/v1/admin/...')` consumer in `apps/admin/src`.
3. Normalize path params (`:id`, `:projectId`, `:keyId` → `:param`) so route
   shape — not param naming — is the matching key.
4. Cross-reference. Routes with no consumer are candidates for triage:
   wire / gate / delete.

The structural matching also runs on every commit via
`packages/server/src/__tests__/manifest-contract.test.ts` (Wave T deliverable),
which guarantees every endpoint advertised by `/v1/admin/auth/manifest` is a
real registered route.

## Manifest contract (P0 — fixed in Wave S)

The auth manifest at `app.get('/v1/admin/auth/manifest')` advertises an OAuth-style
discovery doc consumed by external A2A agents. Two endpoints were advertised
without a Hono route, returning 404 to any conforming client:

| Endpoint                                      | Status before | Status after Wave S          | Test                          |
| --------------------------------------------- | ------------- | ---------------------------- | ----------------------------- |
| `POST /v1/admin/auth/token`                   | 404 (missing) | Implemented (refresh + introspect) | Contract test enforces parity |
| `POST /v1/admin/projects/:id/keys/rotate`     | 404 (missing) | Implemented (atomic-ish rotate)    | Contract test enforces parity |

A `vitest` regression check now scans the manifest body and asserts every
URL it advertises has a matching `app.<method>(...)` registration. If anyone
adds a new advertised endpoint without wiring it, CI fails.

## Orphan candidates (no front-end consumer found)

These admin routes exist server-side but are not called from any
`apps/admin/src/**` source file. Each has been triaged with a target
disposition. Marked **KEEP** when the route is exercised by the SDK,
external scripts, or a deliberate background job.

| Route                                              | Decision     | Reason                                                                                       |
| -------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `POST /v1/admin/codebase/upload`                   | **KEEP**     | Consumed by `scripts/embed-repo.ts` (RAG one-shot) + future SDK packagers, not the admin UI. |
| `GET  /v1/admin/synthetic`                         | WIRE         | Pair with the synthetic generator card on `/prompt-lab`; currently only POST is consumed.    |
| `GET  /v1/admin/plugins/dispatch-log`              | WIRE         | Surface in `/marketplace` plugin detail drawer for debugging plugin executions.              |
| `GET  /v1/admin/storage` / `GET /v1/admin/storage/usage` | WIRE   | Drive the usage chart on `/storage`; UI currently shows config but not actual bytes.         |
| `GET  /v1/admin/compliance/retention`              | WIRE         | List view on `/compliance` reads only project-scoped variant; surface global default too.    |
| `GET  /v1/admin/compliance/evidence`               | WIRE         | Power the SOC2 evidence panel on `/compliance` (currently only refresh is wired).            |
| `GET  /v1/admin/health/cron`                       | **KEEP**     | Polled internally by `IntegrationHealthDot` via the platform endpoint; standalone is admin-only debug. |
| `GET  /v1/admin/anti-gaming/events`                | WIRE         | Power the events tab on `/anti-gaming` (devices tab is wired, events tab isn't).             |
| `POST /v1/admin/storage/:projectId/health`         | WIRE         | Replace the placeholder "Test" button on the storage panel with a real probe.                |
| `GET  /v1/admin/residency`                         | WIRE         | Surface on `/compliance` — needed for multi-region tenants to confirm pinning.               |

Wiring is queued for Wave U (each pairs with a list/table polish on the
target page). None are deleted because all have valid backend behaviour
worth surfacing — the gap is the UI affordance.

## Routes verified used (sample)

This is a partial map — full ingestion of every consumer is not the point;
the point is that the contract test catches regressions. Spot-check examples:

- `/v1/admin/dashboard` ← `apps/admin/src/pages/DashboardPage.tsx`
- `/v1/admin/setup` ← `apps/admin/src/lib/useSetupStatus.ts`
- `/v1/admin/fixes` (+ `/dispatches`, `/summary`, `/:id/timeline`) ← `apps/admin/src/pages/FixesPage.tsx`
- `/v1/admin/reports`, `/reports/bulk`, `/reports/:id` ← `apps/admin/src/pages/ReportsPage.tsx`
- `/v1/admin/judge*` ← `apps/admin/src/pages/JudgePage.tsx`
- `/v1/admin/byok*` ← `apps/admin/src/components/settings/ByokPanel.tsx`
- `/v1/admin/integrations*` ← `apps/admin/src/pages/IntegrationsPage.tsx`

## Defensive guarantees added in Wave T

1. **Manifest contract test** — `packages/server/src/__tests__/manifest-contract.test.ts`.
   Runs in `pnpm test`. Asserts every URL advertised by the auth manifest
   resolves to a registered Hono route. Today: 4 tests, 4 passing.
2. **`mushi/no-empty-onclick` ESLint rule** — `tooling/eslint-config/rules/no-empty-onclick.js`.
   Flags `onClick={() => {}}`, `onClick={noop}`, `onClick={()=>null}` and
   the `onSubmit` equivalents. Verified by lint-fixture on a synthetic
   offender, then run clean against `apps/admin/src/**`.
3. This audit document — kept dated so future drift is comparable.

## Next step

Wave U paths:

- Wire each WIRE-marked endpoint to a UI affordance + add `ResultChip` /
  skeleton parity at the same time so the user gets feedback the moment
  the backend responds.
- Re-run the manifest contract test on every server PR.
- Re-run ESLint on every UI PR (already runs in pre-commit hooks via
  Husky configured at the repo root).
