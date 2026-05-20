# Handover — npm Trusted-Publisher bootstrap (2026-05-05)

The v2 release on master shipped 11/15 packages successfully. **Four
packages are still missing from the npm registry** and need a one-time
manual bootstrap because npm's Trusted-Publisher (OIDC) flow can't
publish a package's first version. This is a known and documented
limitation — not a bug in our release pipeline.

> Confirmed by the npm CLI maintainers in
> [npm/cli#8544](https://github.com/npm/cli/issues/8544):
> *"We determined to not have 'first publish' available to limit scope
> in our MVP, but are evaluating options for the next step."*

## What's stuck

| Package | Local version | On npm registry | Why it failed |
|---|---|---|---|
| `@mushi-mushi/inventory-schema` | `0.2.0` | ❌ never published | New package — no Trusted Publisher rule possible until first publish |
| `@mushi-mushi/inventory-auth-runner` | `0.1.0` | ❌ never published | Same |
| `eslint-plugin-mushi-mushi` | `0.2.0` | ❌ never published | Same |
| `@mushi-mushi/mcp-ci` | `0.3.0` (local) → `0.2.2` (npm) | ⚠ stuck at 0.2.2 | Already exists, but the Trusted-Publisher rule on npmjs.com isn't configured for this package yet |

The 11 successful packages (e.g. `@mushi-mushi/core`, `mushi-mushi`,
`@mushi-mushi/web`) all already had Trusted-Publisher rules configured
on npmjs.com from previous releases, so OIDC published them cleanly with
Sigstore provenance.

## Recovery — 3 steps, ~15 min

### Step 1 — Bootstrap-publish the 3 brand-new packages

Use a one-time npm token that has permission to **create** packages in
the `@mushi-mushi` scope. The repo's existing `NPM_TOKEN` GitHub secret
is a Granular Access Token (GAT) which can only be granted to packages
that already exist — it can't create new ones in a scope. Generate a
fresh token specifically for this bootstrap:

1. https://www.npmjs.com/settings/<your-user>/tokens → **Generate New
   Token** → choose **Classic Token** → type **Automation** → 7-day
   expiry. Classic Automation tokens have scope-level publish/create
   permission. (You can also use a Granular token with explicit
   `Read and write` + `Selected scopes: @mushi-mushi` plus a
   `Selected packages` allowlist that includes `eslint-plugin-mushi-mushi`,
   but the Classic path is faster for a one-shot.)

2. Run the bootstrap script locally — defaults to dry-run, so it shows
   what would happen first:

   ```bash
   pnpm install
   node scripts/bootstrap-publish-new-packages.mjs
   ```

   You should see:
   ```
   bootstrap mode: dry-run (pass --for-real to publish)
     @mushi-mushi/inventory-schema@0.2.0       NOT on registry — will publish
     @mushi-mushi/inventory-auth-runner@0.1.0  NOT on registry — will publish
     eslint-plugin-mushi-mushi@0.2.0           NOT on registry — will publish
   ```

3. Re-run with `--for-real` and the token in env:

   ```bash
   NPM_TOKEN=npm_… node scripts/bootstrap-publish-new-packages.mjs --for-real
   ```

   The script:
   - builds the full workspace (`pnpm -w build`) so dist artefacts are
     fresh,
   - skips any package that's already on the registry (idempotent),
   - publishes each missing package with `--access public
     --provenance=false`. Provenance is intentionally off because this
     bootstrap path doesn't use OIDC; subsequent publishes from
     `release.yml` will get provenance automatically.

4. **Revoke the bootstrap token** immediately after the script finishes:
   https://www.npmjs.com/settings/<your-user>/tokens → revoke. The
   ongoing release pipeline doesn't need it.

### Step 2 — Configure Trusted-Publisher rules on npmjs.com

For each of the four packages (3 newly-bootstrapped + the existing
`mcp-ci`), open the package's settings page and add a Trusted Publisher
rule:

- https://www.npmjs.com/package/@mushi-mushi/inventory-schema/access
- https://www.npmjs.com/package/@mushi-mushi/inventory-auth-runner/access
- https://www.npmjs.com/package/eslint-plugin-mushi-mushi/access
- https://www.npmjs.com/package/@mushi-mushi/mcp-ci/access

In the **Trusted Publisher** section choose **GitHub Actions** and fill:

| Field | Value |
|---|---|
| Organization or user | `kensaurus` |
| Repository | `mushi-mushi` |
| Workflow filename | `release.yml` |
| Environment | (leave blank) |

(If you ever rename the publish workflow, every TP rule has to be
updated — npm doesn't follow filename changes.)

### Step 3 — Re-run the release for `@mushi-mushi/mcp-ci`

`@mushi-mushi/mcp-ci` already has its `0.3.0` version in `package.json`
locally, but `0.3.0` is not on the registry. The release workflow's
changeset state thinks the version is "done" because the version-bump PR
already merged. To re-publish, the cleanest path is:

1. After Step 2 confirms the TP rule for `@mushi-mushi/mcp-ci` is live,
2. Manually dispatch the release workflow:

   ```bash
   gh workflow run release.yml --ref master
   ```

   The Changesets action sees that `0.3.0` is not on the registry,
   re-attempts the publish, OIDC trusts the new TP rule, and the package
   ships with provenance.

   If the manual dispatch doesn't pick `mcp-ci` up (Changesets sometimes
   considers the bump "consumed"), bump the version explicitly via a
   tiny patch changeset:

   ```bash
   pnpm changeset
   # select @mushi-mushi/mcp-ci, patch, summary "Re-publish 0.3.x"
   ```

   Merge the resulting "chore: version packages" PR and the release
   workflow will then publish `mcp-ci@0.3.1` (or whatever the patch
   bump produces) cleanly.

## How we prevented this from happening twice

- `scripts/bootstrap-publish-new-packages.mjs` makes the bootstrap a
  one-line operation per release that introduces a new public package.
- The TP UI flow is documented above so future maintainers don't have
  to reverse-engineer it.
- Future releases use the regular `release.yml` (changesets +
  OIDC + provenance) — once the TP rule is in place per package the
  pipeline is fully automated.

## Related debugging

The Supabase Edge Function deploy regression that landed on the same
release (`inventory-crawler` + `synthetic-monitor` HTTP 400) was a
separate issue, fully fixed in PR #85
(`fix(server): unbreak inventory-crawler + synthetic-monitor edge
deploys`). See `scripts/check-edge-fn-imports.mjs` for the regression
guard.

## Credentials hygiene

The agent transcript that drove this debug session printed the contents
of `.env` (`GITHUB_TOKEN` + `NPM_TOKEN`). Treat both as compromised:

- https://github.com/settings/tokens — revoke the GitHub PAT, regenerate
  if needed.
- https://www.npmjs.com/settings/<your-user>/tokens — revoke the npm
  token. (The CI publish path uses the secret stored in GitHub, not the
  token in `.env`, so revoking the local one only affects local CLI use.)
