# Data residency

The Mushi Mushi cloud runs three regional Supabase projects:

| Region | Hostname                          | Notes                          |
| ------ | --------------------------------- | ------------------------------ |
| `us`   | `api.us.mushimushi.dev`           | Default; legacy catalog of record. |
| `eu`   | `api.eu.mushimushi.dev`           | Frankfurt — GDPR-resident.     |
| `jp`   | `api.jp.mushimushi.dev`           | Tokyo — APPI-resident.         |
| `self` | (operator-defined)                | Self-hosted; no redirect.      |

## How routing works

1. SDK calls go to whatever `apiEndpoint` was configured (legacy `dxptn…` is fine).
2. The gateway runs `regionRouter` middleware on every `/v1/*` path.
3. If the project's `region_routing.region` differs from `MUSHI_CLUSTER_REGION`,
   the middleware returns `307` with `Location` pointing at the correct
   regional host. SDK ≥ v0.8.0 follows the redirect once and caches the new
   base URL in `localStorage` for 24h.
4. Project data never touches the wrong cluster — the redirect happens
   *before* `apiKeyAuth` runs.

## Deploying a new region

Each regional Supabase project is its own deploy target with its own DB. The
schema, Edge Functions, and cron jobs are identical; only environment
variables differ.

```bash
# Set the region marker on the cluster
supabase secrets set MUSHI_CLUSTER_REGION=eu --project-ref <eu-project-ref>

# Mark the region in Postgres for stable_cache helpers
psql "$DB_URL" -c "ALTER DATABASE postgres SET app.settings.cluster_region = 'eu';"
```

## Pinning a customer project

Customers self-serve from the admin Compliance → Data residency panel. The
`PUT /v1/admin/residency/:projectId` endpoint enforces:

- Region must be one of `us | eu | jp | self`.
- A project that already has a non-null `data_residency_region` cannot be
  flipped at runtime — returns `409 REGION_LOCKED`. Migration between
  regions requires an export+restore handled by support.

## Catalog of record

The legacy US cluster owns the global `region_routing` table. All other
clusters replicate it via Supabase Logical Replication. New project
creation always inserts the row on the US cluster first; the trigger on
`projects.data_residency_region` keeps `region_routing` in sync.
