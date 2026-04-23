# Full-PDCA dogfood suite

End-to-end Playwright suite that exercises every stage of the Mushi
Mushi pipeline (Plan → Plan/dedup → Do → Check → Act → Health) against
a real Supabase + Edge Functions stack. Each stage is a separate
`test()`, so the failure line in the report points at the exact rung
that broke.

## Prereqs

Run these in three separate terminals before `pnpm e2e`:

```bash
# 1. Local Supabase (Postgres + Edge Runtime)
cd packages/server && supabase start
pnpm --filter @mushi-mushi/server supabase:serve      # edge functions

# 2. Mushi Mushi admin console
pnpm --filter @mushi-mushi/admin dev

# 3. Dogfood app (glot.it) — or a preview URL via MUSHI_DOGFOOD_URL
cd ../glot.it && pnpm dev
```

### One-time seed for a fresh `supabase start`

The suite POSTs to `POST /v1/reports` with a fixed project/API-key pair
that must exist in the local DB. Seed them once per cold stack:

```bash
docker exec supabase_db_server psql -U postgres -d postgres <<'SQL'
insert into projects (id, name, slug)
values ('542b34e0-019e-41fe-b900-7b637717bb86', 'glot.it local', 'glotit-local')
on conflict (id) do nothing;

insert into project_api_keys (project_id, key_hash, label, scopes, is_active)
values (
  '542b34e0-019e-41fe-b900-7b637717bb86',
  'c5a1f379b2bae2f16ef7496a5f1b91c1226be22b50ad60d1c3cd29a7abaa1e79',
  'glotit-dev', array['report:write']::text[], true
) on conflict do nothing;
SQL
```

The `key_hash` above is `sha256('mushi_glotit520f2a00ed694bcbb176b254c9f258c6')` — the
default dogfood API key. Override via `MUSHI_API_KEY` + reseed if you
rotate it.

## Environment

| Var                         | Default                                      | Purpose                                                            |
|-----------------------------|----------------------------------------------|--------------------------------------------------------------------|
| `MUSHI_DOGFOOD_URL`         | `http://localhost:3000`                      | Dogfood app under test (only used by tests that drive the widget)  |
| `MUSHI_ADMIN_URL`           | `http://localhost:6464`                      | Admin console URL                                                  |
| `SUPABASE_URL`              | `http://localhost:54321`                     | Local Supabase stack                                               |
| `SUPABASE_SERVICE_ROLE_KEY` | —                                            | Service-role read of `reports` / `fix_attempts` (Plan/Do/Act need) |
| `MUSHI_API_URL`             | `${SUPABASE_URL}/functions/v1/api`           | Override to a deployed API for preview-env testing                 |
| `MUSHI_PROJECT_ID`          | `542b34e0-019e-41fe-b900-7b637717bb86`       | Project to ingest against                                          |
| `MUSHI_API_KEY`             | `mushi_glotit520f2a00ed694bcbb176b254c9f258c6` | API key for `POST /v1/reports`                                     |
| `MUSHI_ADMIN_JWT`           | —                                            | JWT for `/v1/admin/*` calls (Do / Check / Health need this)        |
| `MUSHI_ADMIN_EMAIL`         | falls back to `TEST_USER_EMAIL`              | Login identity for the admin-polish suite (`byok-no-flash`, `dynamic-title`, `favicon-badge`) |
| `MUSHI_ADMIN_PASSWORD`      | falls back to `TEST_USER_PASSWORD`           | Paired password; both vars are consumed by `admin-polish.helpers.ts` |
| `E2E_LIVE_GITHUB`           | unset (mock mode)                            | Set `1` to hit real GitHub in the Act stage                        |

## Run it

```bash
pnpm --filter @mushi-mushi/e2e-dogfood e2e              # headless
pnpm --filter @mushi-mushi/e2e-dogfood test:ui          # Playwright UI
pnpm --filter @mushi-mushi/e2e-dogfood e2e --grep Plan  # single stage
```

> `pnpm --filter … test` is intentionally a no-op (echoes a nudge) — it
> keeps `pnpm -r test` from spawning Playwright browsers in every CI
> matrix cell. The real entry is `pnpm … e2e`.

## What each stage gates on

| Stage       | Needs                                                       | Skip reason if missing                                |
|-------------|-------------------------------------------------------------|-------------------------------------------------------|
| Plan        | Seeded project + API key                                    | — (always runs)                                       |
| Plan/dedup  | `ANTHROPIC_API_KEY` on the functions runtime                | Classifier did not advance past `new` / `submitted`   |
| Do          | `MUSHI_ADMIN_JWT`                                           | Missing admin JWT                                     |
| Check       | `MUSHI_ADMIN_JWT` + judge-batch pipeline                    | Missing admin JWT                                     |
| Act         | A `fix_attempts` row from Do                                | Do did not dispatch                                   |
| Health      | `MUSHI_ADMIN_JWT`                                           | Missing admin JWT                                     |

## Admin polish suite

In addition to the core PDCA stages, the suite ships a set of admin-
console polish specs that regression-guard the Wave S / Wave T UX
passes. They all log in via `loginToAdmin()` in
`admin-polish.helpers.ts` (falls back to `TEST_USER_EMAIL` /
`TEST_USER_PASSWORD` when the dedicated `MUSHI_ADMIN_*` vars are unset)
and stub their server payloads so they can run without a live DB.

| Spec                              | What it protects                                                                                     |
|-----------------------------------|------------------------------------------------------------------------------------------------------|
| `byok-no-flash.spec.ts`           | BYOK "Test" button never flashes the table between SWR revalidations                                 |
| `dynamic-title.spec.ts`           | `<title>` re-counts live (pending reports / in-flight fixes) and the freshness pill pulses on load   |
| `favicon-badge.spec.ts`           | Tab favicon shows an unread dot when new reports land while the tab is backgrounded                  |
| `reports-bulk-undo.spec.ts`       | **Wave T.2** — bulk dismiss writes a mutation row and the `Undo` toast round-trips through `/undo`   |
| `staged-realtime-banner.spec.ts`  | **Wave T.3** — the "N new rows · Apply · Discard" banner renders and announces via `aria-live`       |
| `chart-annotations.spec.ts`       | **Wave T.5** — `<ChartAnnotations>` overlay renders a dot per `chart-events` row and filters by kind |
| `dead-buttons.spec.ts`            | **Wave T** — sweeps 16 Advanced routes for `data-hero-primary` / `data-inbox-primary` / `data-tabbed-sub-nav-tab` CTAs and asserts none land on the 404 fallback |
| `user-story-triage.spec.ts`       | **Wave T** — end-to-end user story: submits via glot.it → opens in admin `/reports` → asserts the `PdcaReceiptStrip` → dispatches → triggers judge-batch → lands on `/repo`. Uses REST-auth + localStorage injection (`injectAdminSession`) to skip the login form, so the spec proves the **real** UI path without owning a login helper |
| `full-pdca.spec.ts`               | Backend **contract** — POSTs directly to `/v1/reports` then inspects DB state via `SUPABASE_SERVICE_ROLE_KEY`. Skipped locally when the service key isn't present (intentional: the key shouldn't live in `.env.local`); hits the hosted project when exported ad-hoc |

## Running the whole suite against a hosted Supabase

Most Wave T specs (`dead-buttons`, `user-story-triage`, the admin-polish
set) only need `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` +
`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`, all of which already live in
`apps/admin/.env` and the root `.env.local`. For an end-to-end sweep
against the hosted project while the dev servers run on `:6464` (admin)
and `:3000` (glot.it):

```bash
# Load env (key = value spacing + CRLF tolerant)
set -a
source <(grep -v '^#' .env              | sed 's/ *= */=/')
source <(grep -v '^#' .env.local        | sed 's/ *= */=/')
source <(grep -v '^#' apps/admin/.env   | sed 's/ *= */=/')
set +a

# Glot.it is served under /glot-it/ in dev, so override the default:
export MUSHI_DOGFOOD_URL="http://localhost:3000/glot-it"
export MUSHI_ADMIN_URL="http://localhost:6464"
export MUSHI_API_URL="$VITE_API_URL"

pnpm --filter @mushi-mushi/e2e-dogfood e2e
```

Expected result against a healthy stack: **29 passed / 6 skipped / 0
failed** in ~2 min. The 6 skips are all in `full-pdca.spec.ts` —
see the row above. Per-run evidence gets written to
`docs/audit-2026-04-23/localhost-playwright-run.md` when run as part of
a PDCA sweep.

## What happens when it fails

Traces, screenshots, and videos are retained under
`playwright-report/` and `test-results/` on failure. Re-run with
`--trace on` locally to capture them on passing runs too.
