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

## What happens when it fails

Traces, screenshots, and videos are retained under
`playwright-report/` and `test-results/` on failure. Re-run with
`--trace on` locally to capture them on passing runs too.
