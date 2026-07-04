# Deployment runbook (maintainers)

How Mushi Mushi ships to production. This is the operator-facing companion to the
public summary at [`apps/docs/content/operating/deployment.mdx`](../apps/docs/content/operating/deployment.mdx).

There are **four deploy pipelines** plus a **manual DB migration** step. A change to one deploy pipeline never blocks the others.
**Database migrations are manual** and are never run by CI.

| Pipeline | Workflow | Trigger | Target |
| --- | --- | --- | --- |
| npm SDK packages | `.github/workflows/release.yml` | Merge Changesets version PR to `master` (usually a manual dispatch) | npm registry |
| Edge Functions | `.github/workflows/deploy-edge-functions.yml` | Push to `master` touching `packages/server/supabase/functions/**` | Supabase Edge |
| Admin console SPA | `.github/workflows/deploy-admin.yml` | Push to `master` touching `apps/admin/**` | S3 + CloudFront |
| Docs site | `.github/workflows/deploy-docs.yml` | Push to `master` touching `apps/docs/**` | S3 + CloudFront |
| Hosted MCP proxy | `.github/workflows/deploy-hosted-mcp.yml` | Push touching hosted MCP assets | CloudFront (`/hosted-mcp/`) |
| Testers portal | `.github/workflows/deploy-testers.yml` | Push touching `apps/testers/**` | S3 + CloudFront |
| DB migrations | — (no workflow) | Manual `supabase db push` | Postgres |

---

## 1. npm SDK release (Changesets + OIDC)

Published packages: `core`, `web`, `react`, `vue`, `svelte`, `angular`,
`react-native`, `capacitor`, `cli`, `mcp`, `node`, `launcher`, and the `plugin-*`
constellation. Ignored (never published): `server`, `admin`, `docs`, `agents`,
`verify`, `brand`, `testers`, `e2e-dogfood`.

Authentication is **OIDC Trusted Publishers** + Sigstore provenance
(`NPM_CONFIG_PROVENANCE=true`). `NPM_TOKEN` is only used to bootstrap brand-new
packages (see §1.3).

### 1.1 Routine release

1. **On the feature PR**, add a changeset for every modified published package:
   ```bash
   pnpm changeset
   ```
   Commit the generated `.changeset/*.md` file. CI's `check:changeset-orphans`
   fails a changeset that targets only ignored packages.
2. **Merge to `master`.** `release.yml` opens/updates a **"chore: version
   packages"** PR on `changeset-release/master` that bumps versions, rolls up
   per-package changelogs, and deletes consumed changesets.
3. **Wait for CI on the version PR.** If checks don't appear (bot-branch
   suppression), push an empty commit to `changeset-release/master`. If
   `check:sdk-version-matrix` fails, run `pnpm gen:sdk-version-matrix` on that
   branch and commit `apps/docs/content/sdks/index.mdx`.
4. **Merge the version PR.** This is what publishes to npm.
5. **Dispatch the release if it does not auto-start within ~2 minutes** — squash
   merges attributed to `github-actions[bot]` usually suppress the `push` trigger;
   version-PR squash commits that include `[skip ci]` suppress it too:
   ```bash
   gh workflow run release.yml --ref master
   ```
6. **If the version PR shows "Required status check Build & Test is expected"**,
   push an empty commit to `changeset-release/master` with a user/PAT token (the
   bot branch does not trigger CI), wait for green, then merge.

> **Post-release incident log (Jun 2026):** Critical SDK fixes shipped after the
> pipeline release (`cli@0.22.1`, `web@1.21.1`, `react-native@0.20.1`) — env merge,
> rewards listener idempotency, RN i18n types, Teams SSRF guards. Full write-up:
> [`docs/audit-2026-06-23/post-release-critical-fixes.md`](./audit-2026-06-23/post-release-critical-fixes.md).

### 1.2 What the publish job enforces

- **Node 24** (npm ≥ 11.5.1) — required for the OIDC Trusted Publisher handshake.
  Node 22 / npm 10 returns a misleading `404` when the OIDC exchange fails.
- `node scripts/check-publish-readiness.mjs` — every publishable `package.json`
  has `files` (incl. README + LICENSE), `exports`/`types`, `engines`,
  `repository.directory`, and `publishConfig.access: public`.
- `pnpm release` = `sync:community-files` → `turbo run build` → `check:publish`
  (`check-workspace-protocol.mjs` + `check-packed-tarballs.mjs`) →
  `check:migration-catalog` → `changeset publish`.
- **Post-publish:** `verify-published-tarballs.mjs` (no `workspace:*` leaked),
  `npm audit signatures` (with CDN-propagation retry), `changelog:aggregate`
  commit, and `sync-sdk-versions.mjs` (upserts versions into the `sdk_versions`
  table powering console freshness chips).
- **Signature audit flake:** if the job fails on `npm audit signatures` with
  `ETARGET` / "No matching version" immediately after publish, confirm packages
  are live (`npm view @mushi-mushi/cli version`) and GitHub releases exist — the
  failure is often CDN propagation, not a missed publish.

### 1.3 Adding a brand-new publishable package

Trusted Publisher bindings are per-package and require the package to already
exist on the registry, so a new package needs a one-time bootstrap.

1. Add `packages/<name>/` with a real `version`, `files`,
   `publishConfig.access: "public"`, `LICENSE`, and the fields enforced by
   `pnpm check:publish-readiness`.
2. `pnpm install && pnpm -r build`.
3. Mint a short-lived **granular access token** on npmjs.com (Bypass 2FA: ON,
   Read+write: all packages, 7-day expiry).
4. Bootstrap-publish (no provenance, rewrites `workspace:^` → real semver):
   ```bash
   NPM_TOKEN=npm_xxx pnpm bootstrap:new-package
   ```
5. For each printed URL, attach the **GitHub Actions** Trusted Publisher rule
   (`kensaurus/mushi-mushi`, `release.yml`, `master`) and confirm with your
   security key.
6. Revoke the bootstrap token.

From the next bump onward, that package publishes through `release.yml` with full
OIDC provenance.

### Required secrets (npm)

- `NPM_TOKEN` — granular access token, "Bypass 2FA" enabled (bootstrap path only).
- Trusted Publisher rule per package on npmjs.com → `kensaurus/mushi-mushi/.github/workflows/release.yml` on `master`.

---

## 2. Supabase Edge Functions

`deploy-edge-functions.yml` runs on push to `master` touching
`packages/server/supabase/functions/**` (or `config.toml`), and on
`workflow_dispatch` (optionally a single `function_name`). It posts each function
individually to the Supabase Management API via `scripts/deploy-edge-function.mjs`
(the same code path as a local deploy), so one failed function doesn't silently
abort the batch.

### Required secrets (edge functions)

```bash
gh secret set SUPABASE_ACCESS_TOKEN --body "sbp_…" --repo kensaurus/mushi-mushi
gh secret set SUPABASE_PROJECT_REF  --body "dxptnwrhwsqckaftyymj" --repo kensaurus/mushi-mushi
```

Per-function secrets (LLM keys, webhook signing secrets, etc.) are set with
`supabase secrets set` against the project ref, not in the workflow.

---

## 3. Admin console SPA

`deploy-admin.yml` builds the Vite SPA and syncs it to S3 (`kensaur.us-mushi-mushi`,
`ap-northeast-1`) behind CloudFront at `kensaur.us/mushi-mushi/admin`. Immutable
assets get a long cache; HTML is no-cache. Sourcemaps are uploaded to Sentry and
then deleted from `dist` so the public bucket never serves them.

### Required secrets (admin)

`AWS_ROLE_ARN` — GitHub OIDC role (no long-lived IAM keys in this repo):

```
arn:aws:iam::590715976857:role/github-actions-mushi-mushi-deploy
```

Trust: GitHub OIDC provider `token.actions.githubusercontent.com`, audience
`sts.amazonaws.com`, subject `repo:kensaurus/mushi-mushi:*`. Permissions:
customer-managed policy `GitHubActionsS3CloudFrontDeploy` (S3 bucket
`kensaur.us-mushi-mushi`, CloudFront distribution `E246VQ1C9QYZVB`, CloudFront
Functions).

Also required: `CLOUDFRONT_DISTRIBUTION_ID`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_CLOUD_SUPABASE_ANON_KEY` (cloud anon JWT for
`apps/admin/src/lib/env.ts` — CI fails the build if unset), `VITE_SENTRY_DSN`,
`SENTRY_AUTH_TOKEN`.

> **Other repos:** The IAM user `github-actions-deploy` and its access key still
> exist in AWS for other `kensaurus/*` repositories. Only `mushi-mushi` migrated
> to OIDC; deleting the IAM user would break those repos.

One-time setup script (for additional repos): `scripts/setup-aws-github-oidc.mjs`.

---

## 4. Docs site

`deploy-docs.yml` builds the Nextra static export (`basePath /mushi-mushi/docs`)
and syncs it to the same S3 bucket under the `mushi-mushi/docs` prefix. The
CloudFront Functions for clean-URL routing are created on first run and updated
idempotently on every subsequent run.

### Required secrets (docs)

`AWS_ROLE_ARN` (same OIDC role as admin — see §3), `CLOUDFRONT_DISTRIBUTION_ID`.

> The docs build is also a gate in `release.yml` (`pnpm build`). If you change the
> MCP catalog, regenerate the reference and commit it:
> `pnpm gen:mcp-tools-doc && pnpm check:onboarding-drift`.

---

## 5. Database migrations (manual)

Migrations are **never** run by CI. Apply them deliberately, **before** deploying
any edge function or SDK release that depends on the new schema, so the live
backend is never behind the code that calls it:

```bash
supabase db push
```

Verify the change landed (e.g. via the Supabase MCP `list_tables` / `pg_proc`
lookups or a `SET ROLE` smoke test) and check `get_advisors` for new ERROR-level
findings before declaring the deploy done.

**Jul 2026 reliability trio** (CLI auth + SDK config + backend hardening — see
[`docs/operators/sdk-reliability-overhaul.md`](operators/sdk-reliability-overhaul.md)):

| Migration | Purpose |
| --- | --- |
| `20260702090000_cli_auth_two_phase_claim.sql` | Two-phase CLI token claim + `client_id` |
| `20260702100000_request_idempotency_restrict_member_read.sql` | Drop member read on idempotency cache (secret exposure) |
| `20260702110000_scoped_rate_limits_generalize_actor.sql` | Generalize rate-limit actor column (IP-derived IDs) |

---

## 6. Backup, PITR, and data-integrity runbook

### 6.1 Point-in-Time Recovery (PITR)

Supabase Pro projects include **7-day PITR** by default. Verify it is active
before any data-destructive operation (retention sweeps, schema drops, large
deletes):

1. Open **Supabase Dashboard → Project → Settings → Database → Point in Time
   Recovery**.
2. Confirm PITR shows as **Enabled** with a recovery window of ≥ 7 days.
3. If PITR is disabled: upgrade the project to Pro or enable it under Add-ons.

> **D1 gate (SOC 2 retention cron):** The `mushi-soc2-retention-sweep` pg_cron
> job (installed by migration `20260418001300_soc2_readiness.sql`) permanently
> deletes `reports` and `audit_logs` rows according to `project_retention_policies`.
> **PITR must be confirmed active before this cron runs in production.** If PITR
> is not enabled, a runaway retention window could cause irrecoverable data loss
> within a single cron cycle (daily at 03:30 UTC).
>
> To verify the cron is scheduled: `SELECT jobname, schedule FROM cron.job WHERE jobname = 'mushi-soc2-retention-sweep';`
> To unschedule (pause): `SELECT cron.unschedule('mushi-soc2-retention-sweep');`
> To re-schedule after PITR is confirmed: `SELECT cron.schedule('mushi-soc2-retention-sweep', '30 3 * * *', $$SELECT public.mushi_apply_retention();$$);`

### 6.2 Restore procedure (PITR)

To restore to a point in time using Supabase PITR:

1. Open **Dashboard → Settings → Database → Point in Time Recovery**.
2. Choose **Restore to a specific point in time** and select the target
   timestamp (UTC). Allow up to 30 minutes for the restore to complete.
3. After restore, run `supabase db push` to re-apply any migrations that
   were pushed after the restore point (PITR restores data, not new DDL).
4. Verify the restored state with `information_schema` queries or
   `select_advisors(type: 'error')` via the Supabase MCP.

### 6.3 Migration safety policy

- **Never** write `DELETE FROM <table>` or `TRUNCATE <table>` without a
  `WHERE` clause in a migration file. CI enforces this via
  `scripts/check-destructive-migrations.mjs`.
- Run `node scripts/check-destructive-migrations.mjs` before merging any PR that
  touches `packages/server/supabase/migrations/`.
- Confirm PITR window before running any migration that installs a retention
  cron or bulk-deletes data.

---

## Pre-release checklist

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green locally.
- [ ] `pnpm check:publish-readiness` and `pnpm check:changeset-orphans` pass.
- [ ] A changeset exists for every modified published package.
- [ ] Any new/changed SQL migration has been applied to the target project and
      verified.
- [ ] `pnpm changelog:check` is in sync.
- [ ] **If the migration adds a retention cron or bulk delete:** confirm
      PITR is active (§6.1) before enabling the cron in production.
