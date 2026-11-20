# 0064. One-command Docker install on Supabase's own self-host kit

Status: Accepted (owner, delegated to the lead, 2026-11-19). Date: 2026-11-19

Related: `deploy/selfhost/` (install.sh, mushi.sh, smoke.sh,
docker-compose.mushi.yml, caddy/), `deploy/Dockerfile.migrate`,
`deploy/admin-runtime-config.sh`, `.github/workflows/publish-selfhost-images.yml`,
`apps/docs/content/self-hosting/docker-compose.mdx`, [0063](0063-reach-first-free-plan-and-free-self-host.md)
(free self-host), [0034](0034-verifiably-local-mode.md) (local-only, Proposed).

## Who decided

The owner, 2026-11-19, before posting Mushi Mushi to r/selfhosted: "make mushi
unbeatable to download" and "dont wait on me - please do everything". The lead
chose the approach below on that delegation, on top of the self-host work that
landed the same day in #1168.

## Context

After #1168, `deploy/docker-compose.yml` ran the migrations on an empty
Postgres and answered on a clean machine, but it called itself experimental
and listed its gaps: no Realtime (the console's live updates need a reload),
no Studio, no email, the console's backend baked in at build time (one image
per domain), images built on the user's machine from a clone, and no
backup, update or HTTPS story beyond Caddy's own TLS. Self-hosters expect a
published multi-arch image, one install command, generated secrets, closed
sign-up and loopback-only ports.

## Decision

1. **Layer on Supabase's self-host kit, pinned by tag** (`self-hosted/v0.8.4`),
   unchanged. `deploy/selfhost/docker-compose.mushi.yml` is added through
   `COMPOSE_FILE`; the kit brings Realtime, Studio, the pooler, the gateway,
   key generation and its own `update.sh`.
2. **Reuse #1168's images and migrator.** `functions` runs
   `mushi-mushi-edge` (its router accepts the kit gateway's stripped paths;
   the kit's command keeps the runtime on 9000). A new `mushi-mushi-migrate`
   image bakes the migrations and runs the same `deploy/db/migrate.sh`, so
   the install needs no clone. `mushi-mushi-admin` writes `/runtime-config.js`
   at start from `MUSHI_PUBLIC_URL` and the anon key; without them the baked
   build stays (the from-source compose is unchanged). The console reads it
   before its build-time values (`apps/admin/src/lib/env.ts`).
3. **One origin.** A Caddy service serves the console at `/` and the kit's
   gateway at `/*/v1/`, on `127.0.0.1:3000` until `mushi.sh https <domain>`
   switches it to the domain with automatic TLS.
4. **Safe by default:** every secret generated, sign-up closed with the first
   admin created by the installer, every published port on loopback.
5. **Release gate, not PR gate.** Per the CI cost rules, images build only on
   release tags and dispatch. The `smoke` job installs from scratch with the
   new images (`deploy/selfhost/smoke.sh`: sign-in, project, key, report
   classified, sign-up closed, loopback only) before `publish` pushes
   amd64 and arm64 images.
6. **Operator-owned local models:** only the server-wide `OPENAI_BASE_URL` may
   be a private `http://` address (`MUSHI_ALLOW_PRIVATE_LLM_BASE_URL=true`);
   `MUSHI_OPENAI_MODEL_MAP` renames model ids. Per-key base URLs stay
   https-only (SSRF).

## Rejected

- **Growing `deploy/docker-compose.yml` into the full Supabase stack.** We
  would re-implement Realtime, Studio, the gateway and upgrades, and drift
  from Supabase's tested set every month. It stays as the from-source path.
- **Renaming the kit's `supabase-*` containers.** The kit's scripts
  (`utils/db-passwd.sh`) and log pipeline use them; one kit per Docker host.
- **`pg_dump` backups.** Restoring the `auth` and `storage` schemas owned by
  `supabase_admin` is fragile; a cold copy of the data folder (about 10 s
  down) always restores.
- **A PR-time install test.** It would run on most PRs; the release-time
  smoke job catches the same breakage before anything ships.

## Consequences

- Two Docker paths, with different jobs: the installer for running Mushi
  Mushi, the repo's compose file for building it from source.
- Updating Supabase's services is the kit's `update.sh`; Mushi's update is
  `sh mushi.sh update`.
- The GHCR packages must be public for the installer to pull them (BL-223).
