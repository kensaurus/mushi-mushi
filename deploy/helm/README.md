# Mushi Mushi Helm chart

Self-host the Mushi admin + API on any Kubernetes cluster, against your own Postgres.

```bash
# 1. Mirror the latest SQL migrations into the chart
pnpm sync:helm-migrations

# 2. Render to verify what will be applied
helm template mushi ./deploy/helm \
  --set global.database.host=postgres.example.internal \
  --set global.database.port=5432 \
  --set global.database.name=mushi

# 3. Install
helm install mushi ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres.example.internal
```

## What ships

| Resource                         | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `Job/<release>-migrate`          | Pre-install / pre-upgrade hook that applies every SQL migration |
| `ConfigMap/<release>-migrations` | Bundles all `*.sql` from `packages/server/supabase/migrations/` |
| `Deployment/<release>-api`       | Public Edge-style HTTP surface                                  |
| `Deployment/<release>-admin`     | Admin SPA + static assets                                       |
| `Service` + `Ingress`            | TLS-terminated routing                                          |
| `Secret/<release>-secrets`       | Postgres password, JWT secret, Anthropic key (BYOK)             |

## Migrations stay in sync automatically

The chart's migration ConfigMap is rendered from `deploy/helm/migrations/`. That folder is a **mirror** of `packages/server/supabase/migrations/` produced by `scripts/sync-helm-migrations.mjs` — never edit it by hand.

CI runs `pnpm check:helm-migrations` on every PR; a stale chart fails the build with a clear diff message instead of silently shipping a partial schema.

If the chart ever exceeds the 1 MiB ConfigMap budget the sync script warns at ~900 KiB. Current footprint is ~916 KiB across 234 files (verified via `pnpm docs-stats` / `pnpm check:helm-migrations`).

## Multi-region deployment

Deploy one chart per region and pass `global.region` + `global.peerRegions`:

```bash
# Us-east cluster
helm install mushi-us ./deploy/helm \
  --namespace mushi \
  --set global.database.host=postgres-us.internal \
  --set global.region=us \
  --set global.peerRegions="eu,jp"

# Eu-west cluster
helm install mushi-eu ./deploy/helm \
  --namespace mushi \
  --set global.database.host=postgres-eu.internal \
  --set global.region=eu \
  --set global.peerRegions="us,jp"
```

The `global.region` and `global.peerRegions` values inject `MUSHI_CLUSTER_REGION` and `MUSHI_PEER_REGIONS` into the API pod — the edge functions use these to tag reports with a residency label and to route cross-region reads.

For logical replication setup and DNS configuration see [`docs/runbooks/region-routing-replication.md`](../../docs/runbooks/region-routing-replication.md).

> **Note:** Full active/active write replication is not automated — `region_routing` replicates read-only; write routing relies on client-side region stickiness today. See the runbook for the roadmap.

## What is NOT in the chart yet

- Per-release Stripe webhook config (`deploy/helm/templates/stripe-*` PRs welcome).
- Apache AGE bootstrap. Self-hosters who want the AGE backend run the `20260418001200_age_parallel_write.sql` migration _after_ their cluster has the extension installed; the chart applies it idempotently.

## Upgrading

`helm upgrade` re-runs the migrate Job (it's a pre-upgrade hook), so the rolling Deployment never sees a half-migrated schema. If a migration fails, the upgrade aborts before any pods are touched.
