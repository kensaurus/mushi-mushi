# 0063. Self-host with Docker on Supabase's own self-host kit

Status: Accepted (owner, delegated to the lead, 2026-11-19). Date: 2026-11-19

Related: `deploy/selfhost/` (install.sh, mushi.sh, docker-compose.mushi.yml,
the three image Dockerfiles), `.github/workflows/selfhost-images.yml`,
`apps/docs/content/self-hosting/docker-compose.mdx`,
`packages/server/supabase/migrations/20261119100000_hosted_schema_parity.sql`,
[0034](0034-verifiably-local-mode.md) (local-only, still Proposed).

## Who decided

The owner, 2026-11-19, before posting Mushi Mushi to r/selfhosted: "you are
given full permission to enhance mushi to be better and prod ready and
self-hosted ready". The lead chose the approach below on that delegation.

## Context

The old `deploy/docker-compose.yml` could not run Mushi Mushi. Measured on a
fresh machine on 2026-11-19:

- It served one function (`api`) with plain `deno serve`; the pipeline calls
  78 functions through `${SUPABASE_URL}/functions/v1/<name>`.
- `SUPABASE_URL` pointed at PostgREST, not a gateway, so supabase-js and every
  inter-function call failed.
- The migrations were mounted over Postgres's init folder, which skipped the
  image's own role and schema setup. Replayed properly, 6 migrations still
  failed on an empty database, and 24 columns used by the code existed only
  on the hosted database.
- The console's `VITE_*` values were passed at runtime (they are fixed at
  build), so it fell back to the hosted project; the nginx port did not match.
- Secrets defaulted to `mushimushi` and a known JWT secret, and Postgres,
  Auth and REST were published on every interface. No image was published.

## Decision

1. **Build on Supabase's self-host kit, pinned by tag** (`self-hosted/v0.8.4`),
   unchanged, instead of keeping our own copy of Supabase's services. Mushi
   adds one compose file layered through `COMPOSE_FILE`. The kit brings the
   gateway, the edge-runtime router, secret generation and its own updater.
2. **Three images**, multi-arch on GHCR, tagged `latest` and `sha-<commit>`:
   `mushi-functions` (edge runtime plus every function), `mushi-migrate`
   (applies migrations on every start, recorded in
   `supabase_migrations.schema_migrations` like the Supabase CLI, then points
   `mushi_runtime_config` at the internal gateway) and `mushi-admin` (the
   console with a same-origin proxy to the API, configured at container start
   through `/runtime-config.js`).
3. **Safe by default:** every secret generated at install, sign-up closed with
   the first admin created by the installer, every published port on
   127.0.0.1, HTTPS through an optional Caddy layer, hosted plan caps lifted
   (`MUSHI_PLAN_LIMITS=off`) because the self-hoster pays their own model
   provider.
4. **Fresh-database parity is CI-enforced.** `selfhost-images.yml` installs
   from scratch on every PR that touches the server, the console or
   `deploy/selfhost`, so a migration that only works on the hosted database
   fails before merge. Hosted-only objects that a migration cannot create are
   in `deploy/selfhost/sql/00-hosted-compat.sql`.
5. **Operator-owned local models:** only the server-wide `OPENAI_BASE_URL` may
   be a private `http://` address (`MUSHI_ALLOW_PRIVATE_LLM_BASE_URL=true`);
   `MUSHI_OPENAI_MODEL_MAP` renames model ids. Per-key base URLs stay
   https-only (SSRF).

## Rejected

- **Fixing our own compose of Supabase services.** We would re-implement the
  gateway routes, the function router, Realtime, key generation and upgrades,
  and drift from Supabase with every release.
- **Renaming the kit's `supabase-*` containers.** The kit's own scripts
  (`utils/db-passwd.sh`) and log pipeline use those names; the cost is that
  one Docker host runs one copy of the kit.
- **`pg_dump` backups.** Restoring Supabase-managed schemas (`auth`,
  `storage`) owned by `supabase_admin` is fragile; a cold copy of the data
  folder (about 10 s of downtime) always restores.
- **Building the console per domain.** One image with runtime config serves
  every domain and keeps the image public and reproducible.

## Consequences

- Helm (`deploy/helm/`) is not on this path yet: it has no Auth, REST,
  Storage or Realtime and references unpublished images (BL-216).
- Updating Supabase's own services is the kit's `update.sh`; Mushi's update
  is `sh mushi.sh update`.
- A hosted-only schema change now fails CI's fresh install; add a migration
  (or, for objects the platform creates, the compat file) in the same PR.
