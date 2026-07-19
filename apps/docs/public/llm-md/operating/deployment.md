# Deployment & releases

Source: https://kensaur.us/mushi-mushi/docs/operating/deployment

---
title: Deployment & releases
---

# Deployment & releases

A public summary of how Mushi ships. The full maintainer runbook lives in the
repo at [`docs/DEPLOYMENT.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/DEPLOYMENT.md).

  Maintainers only. App developers integrating the SDK never need to run any of
  this — install from npm and follow the [Quickstart](/quickstart).

## Four independent pipelines

| Pipeline | Trigger | Target |
| --- | --- | --- |
| npm SDK packages | Merge the Changesets version PR to `master` (often a manual `release.yml` dispatch) | npm registry |
| Edge Functions | Push to `master` touching `packages/server/supabase/functions/**` | Supabase Edge (Deno) |
| Admin console SPA | Push to `master` touching `apps/admin/**` | S3 + CloudFront |
| Docs site | Push to `master` touching `apps/docs/**` | S3 + CloudFront |
| DB migrations | **Manual** — `supabase db push` | Postgres |

## npm SDK release (Changesets + OIDC)

The SDK packages (`core`, `web`, `react`, `vue`, `svelte`, `angular`,
`react-native`, `capacitor`, `cli`, `mcp`, `node`, plugins, …) publish through
[Changesets](https://github.com/changesets/changesets) with **OIDC Trusted
Publishers** and Sigstore provenance — no long-lived npm token in the hot path.

### Add a changeset on your PR

Any PR that modifies a published package must include a changeset:

```bash
pnpm changeset
```

Pick the affected packages and the semver bump, then commit the generated
`.changeset/*.md` file with your PR.

### Merge to `master`

`release.yml` opens (or updates) a **"chore: version packages"** PR that bumps
versions, rolls up changelogs, and deletes consumed changesets.

### Merge the version PR

This is what publishes to npm. The publish job runs on **Node 24** (npm ≥ 11.5.1
for the OIDC handshake), verifies every published tarball contains no
`workspace:*` specifiers, and audits package signatures.

### Dispatch the release if it does not auto-start

Squash-merges attributed to `github-actions[bot]` usually suppress the `push`
trigger, so a manual dispatch is the normal path:

```bash
gh workflow run release.yml --ref master
```

  **Brand-new packages** need a one-time bootstrap publish (no provenance) so the
  package exists on the registry before a Trusted Publisher rule can be attached.
  See the repo runbook for the `pnpm bootstrap:new-package` flow.

## Edge Functions, admin & docs

These three deploy automatically on a path-filtered push to `master` — they do
not wait on the npm release. Self-hosters reuse the same scripts; see
[Self-hosting → Edge Functions](/self-hosting/edge-functions) and
[Self-hosting → Admin SPA](/self-hosting/admin-spa).

## Database migrations

Migrations are **never** run by CI. A maintainer applies them deliberately:

```bash
supabase db push
```

Run this **before** deploying any edge function or SDK release that depends on
the new schema, so the live backend is never behind the code that calls it.
