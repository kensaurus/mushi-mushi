# Deployment runbook (maintainers)

How Mushi Mushi ships to production. This is the operator-facing companion to the
public summary at [`apps/docs/content/operating/deployment.mdx`](../apps/docs/content/operating/deployment.mdx).

There are **four independent pipelines**. A change to one never blocks the others.
**Database migrations are manual** and are never run by CI.

| Pipeline | Workflow | Trigger | Target |
| --- | --- | --- | --- |
| npm SDK packages | `.github/workflows/release.yml` | Merge Changesets version PR to `master` (usually a manual dispatch) | npm registry |
| Edge Functions | `.github/workflows/deploy-edge-functions.yml` | Push to `master` touching `packages/server/supabase/functions/**` | Supabase Edge |
| Admin console SPA | `.github/workflows/deploy-admin.yml` | Push to `master` touching `apps/admin/**` | S3 + CloudFront |
| Docs site | `.github/workflows/deploy-docs.yml` | Push to `master` touching `apps/docs/**` | S3 + CloudFront |
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
   merges attributed to `github-actions[bot]` usually suppress the `push` trigger:
   ```bash
   gh workflow run release.yml --ref master
   ```

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

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFRONT_DISTRIBUTION_ID`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`,
`SENTRY_AUTH_TOKEN`.

---

## 4. Docs site

`deploy-docs.yml` builds the Nextra static export (`basePath /mushi-mushi/docs`)
and syncs it to the same S3 bucket under the `mushi-mushi/docs` prefix. The
CloudFront Functions for clean-URL routing are created on first run and updated
idempotently on every subsequent run.

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

---

## Pre-release checklist

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green locally.
- [ ] `pnpm check:publish-readiness` and `pnpm check:changeset-orphans` pass.
- [ ] A changeset exists for every modified published package.
- [ ] Any new/changed SQL migration has been applied to the target project and
      verified.
- [ ] `pnpm changelog:check` is in sync.
