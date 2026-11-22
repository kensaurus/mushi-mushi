# Mushi Mushi Helm chart

> **Experimental.** Nobody has run this chart end to end yet. The supported
> self-host path is your own Supabase project + `mushi selfhost up`
> ([`docs/SELF_HOSTED.md`](../../docs/SELF_HOSTED.md)).

Runs the Mushi Mushi edge functions and admin console on Kubernetes. It does
**not** run Supabase: the functions need a Supabase API (Auth, PostgREST,
Storage) at `global.supabaseUrl`, whose Postgres is `global.database.*`. That
can be a hosted Supabase project or the [supabase/docker](https://github.com/supabase/supabase/tree/master/docker) stack.

Images come from GHCR, published by
[`publish-selfhost-images.yml`](../../.github/workflows/publish-selfhost-images.yml)
on release tags and manual dispatch:

| Image | Contents |
| --- | --- |
| `ghcr.io/kensaurus/mushi-mushi-edge` | `supabase/edge-runtime` with every function and a router (`deploy/edge/main`) |
| `ghcr.io/kensaurus/mushi-mushi-admin` | The console on nginx `:3000`. Built without a Supabase URL, so it asks for the URL and anon key on first open. Bake them in with your own build (`deploy/Dockerfile.admin` build args). |

```bash
# 1. Mirror the latest SQL migrations into the chart
pnpm sync:helm-migrations

# 2. Render to verify what will be applied
helm template mushi ./deploy/helm \
  --set global.supabaseUrl=https://supabase.example.internal \
  --set global.database.host=postgres.example.internal \
  --set secrets.internalCallerSecret=$(openssl rand -hex 32)

# 3. Install (pin an image tag in production)
helm install mushi ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.image.tag=<version> \
  --set global.supabaseUrl=https://supabase.example.internal \
  --set global.database.host=postgres.example.internal \
  --set secrets.internalCallerSecret=<secret> \
  --set secrets.supabaseServiceRoleKey=<service role JWT> \
  --set secrets.postgresPassword=<password>
```

`global.supabaseUrl` and `secrets.internalCallerSecret` are required. The
migrate Job writes them into `mushi_runtime_config`, so pg_cron calls your
functions instead of Mushi Mushi Cloud. An LLM key (`secrets.anthropicApiKey`
or `secrets.openaiApiKey`) is optional: without one, reports get rule-based
triage only.

## What ships

| Resource                         | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `Job/<release>-migrate`          | Pre-install / pre-upgrade hook that applies new SQL migrations (ledger in `supabase_migrations.schema_migrations`) and sets `mushi_runtime_config` |
| `ConfigMap/<release>-migrations-YYYYMM` | One per month: the `*.sql` from `packages/server/supabase/migrations/` |
| `Deployment/<release>-api`       | Public Edge-style HTTP surface                                  |
| `Deployment/<release>-admin`     | Admin SPA + static assets                                       |
| `Service` + `Ingress`            | TLS-terminated routing                                          |
| `Secret/<release>-secrets`       | Postgres password, JWT secret, internal caller secret, optional Anthropic / OpenAI key |

## Migrations stay in sync automatically

The chart's migration ConfigMaps are rendered from `deploy/helm/migrations/`. That folder is a **mirror** of `packages/server/supabase/migrations/` produced by `scripts/sync-helm-migrations.mjs` — never edit it by hand.

CI runs `pnpm check:helm-migrations` on every PR; a stale chart fails the build with a clear diff message instead of silently shipping a partial schema.

The Kubernetes API caps one ConfigMap at 1 MiB, and the full migration set is larger than that, so the chart writes one ConfigMap per calendar month (`<release>-migrations-YYYYMM`, from the first six digits of each migration timestamp) and the migrate Job mounts them all into one `/migrations` directory through a projected volume. `pnpm check:helm-migrations` fails if any single month passes 900 KiB; split that month further in `templates/_helpers.tpl` if it ever does. Run it for the live file count and the largest shard.

## Multi-region deployment

Deploy one chart per region and pass `global.region` + `global.peerRegions`:

```bash
# Us-east cluster
helm install mushi-us ./deploy/helm \
  --namespace mushi \
  --set global.database.host=postgres-us.internal \
  --set global.region=us \
  --set-string 'global.peerRegions=eu\,jp'

# Eu-west cluster
helm install mushi-eu ./deploy/helm \
  --namespace mushi \
  --set global.database.host=postgres-eu.internal \
  --set global.region=eu \
  --set-string 'global.peerRegions=us\,jp'
```

The `global.region` and `global.peerRegions` values inject `MUSHI_CLUSTER_REGION` and `MUSHI_PEER_REGIONS` into the API pod — the edge functions use these to tag reports with a residency label and to route cross-region reads.

For logical replication setup and DNS configuration see [`docs/runbooks/region-routing-replication.md`](../../docs/runbooks/region-routing-replication.md).

> **Note:** Full active/active write replication is not automated — `region_routing` replicates read-only; write routing relies on client-side region stickiness today. See the runbook for the roadmap.

## What is NOT in the chart yet

- Per-release Stripe webhook config (`deploy/helm/templates/stripe-*` PRs welcome).
- Apache AGE bootstrap. Self-hosters who want the AGE backend run the `20260418001200_age_parallel_write.sql` migration _after_ their cluster has the extension installed; the chart applies it idempotently.

## Upgrading

`helm upgrade` re-runs the migrate Job (it's a pre-upgrade hook), so the rolling Deployment never sees a half-migrated schema. If a migration fails, the upgrade aborts before any pods are touched.
