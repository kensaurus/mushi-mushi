# Contributing to Mushi Mushi

Thanks for wanting to help. Here's everything you need to get started.

## Prerequisites

- **Node.js >= 22** (see `.node-version`)
- **pnpm >= 10** — install with `corepack enable`

## Setup

```bash
git clone https://github.com/kensaurus/mushi-mushi.git
cd mushi-mushi
pnpm install
pnpm build
```

## Development

```bash
pnpm dev          # Start all dev servers (admin on :6464)
pnpm test         # Run Vitest across all packages
pnpm typecheck    # TypeScript checks
pnpm lint         # ESLint
pnpm format       # Prettier
```

Ad-hoc screenshots captured during UI reviews can live temporarily at the repo
root, but root-level `*.png` files are intentionally ignored. Canonical
screenshots that should be versioned belong under `docs/screenshots/`.

### Working on a single package

```bash
cd packages/core
pnpm dev          # Watch mode
pnpm test         # Tests for this package only
```

## Project Structure

```
packages/
  core/          Types, API client, offline queue (MIT)
  web/           Browser SDK — widget, capture (MIT)
  react/         React bindings (MIT)
  vue/           Vue 3 plugin (MIT)
  svelte/        Svelte SDK (MIT)
  angular/       Angular SDK (MIT)
  react-native/  React Native SDK (MIT)
  cli/           CLI tool (MIT)
  mcp/           MCP server for coding agents (MIT)
  server/        Supabase Edge Functions (BSL)
  agents/        Agentic fix pipeline (BSL)
  verify/        Fix verification (BSL)
apps/
  admin/         Admin dashboard (React + Tailwind)
  docs/          Documentation site (planned)
tooling/
  eslint-config/ Shared ESLint flat config
  tsconfig/      Shared TypeScript configs
```

## Making Changes

1. Create a feature branch from `master`
2. Make your changes
3. Add tests for new functionality
4. Run `pnpm typecheck && pnpm lint && pnpm test` to verify
5. Create a changeset if your change affects published packages:
   ```bash
   pnpm changeset
   ```
6. Open a pull request

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning. If your PR modifies a published package (`core`, `web`, `react`, `vue`, `svelte`, `angular`, `react-native`, `cli`, `mcp`), add a changeset:

```bash
pnpm changeset
```

Select the affected packages, the semver bump type, and write a summary. The changeset file gets committed with your PR.

## Release flow

Releases are fully automated. Maintainers don't run `npm publish` by hand.

1. PRs land on `master` with one or more changeset files in `.changeset/`.
2. `release.yml` runs on every push to `master`. It opens (or updates) a `chore: version packages` PR that bumps every affected `package.json`, rolls up the changelogs, and deletes the consumed changesets.
3. Merging that "Version Packages" PR re-fires `release.yml`. The publish step authenticates to npm via **OpenID Connect (OIDC) Trusted Publishers** — no long-lived `NPM_TOKEN` is exchanged — and every tarball ships with a **Sigstore provenance attestation** uploaded to the public transparency log.

If GitHub's anti-loop protection suppresses the auto re-fire (the squash merge can be attributed to `github-actions[bot]`), trigger the workflow manually: **Actions → release → Run workflow → master**.

### Known CI/CD quirks and their automatic safeguards

A handful of GitHub-Actions × Changesets edge cases have caused release-pipeline stalls in the past. Each is now caught automatically — keep these in mind when you see the symptom:

| Symptom | Root cause | Automatic safeguard |
| --- | --- | --- |
| The `Build & Test` required check never registers on the `chore: version packages` PR — the PR stays "Required check missing" forever | `changeset-release/master` is pushed by `github-actions[bot]`. GitHub silently drops the downstream `pull_request` event to prevent bot loops (observed on PR #45, #102, #124). | `ci.yml` now also triggers on `push` to `changeset-release/master`, so `Build & Test` reports against the head commit directly. No empty-commit nudge needed. |
| Release workflow fails with `No commits between master and changeset-release/master` after merging a PR with a new changeset. | A `.changeset/*.md` file whose YAML frontmatter only targets packages listed in `.changeset/config.json#ignore` (e.g. `@mushi-mushi/server`, `@mushi-mushi/admin`). `changeset version` produces no bumps, the version PR is empty, the next push errors (PR #102 / #121, 2026-05-19). | `pnpm check:changeset-orphans` runs in both `ci.yml` and `release.yml`. PR CI fails with an actionable message naming the orphan file *before* it can reach master. If you legitimately need to record an internal-only change, omit the changeset entirely — the diff lives in git history. |
| Release workflow's `Audit signatures of installed dependencies` step fails with `npm ETARGET / No matching version found for @mushi-mushi/<pkg>@<ver>` seconds after the publish step succeeded. | npm's registry CDN can take up to ~30s to propagate a freshly-published manifest. The audit step shells out to `npm install` against the just-published version and races the CDN (observed 2026-05-20, run 26149167393). | The audit step retries with exponential backoff (1, 2, 4, 8, 16, 32s — 63s total) before failing. Sigstore signatures are written at publish time, so a one-off audit failure never indicates a corrupted package — `pnpm view <pkg> version` is the ground truth. |
| Push to `master` after merging a PR doesn't fire the `Release` workflow. | Same anti-loop protection: when a squash merge is attributed to `github-actions[bot]`, GitHub may suppress the downstream `push` trigger. Sporadic — observed twice in the last 60 days. | `release.yml` keeps `workflow_dispatch` as the manual fallback. Recovery: **Actions → Release → Run workflow → master**. The `Build & Verify` job re-runs identically to the auto-fired path. |

### Adding a brand-new publishable package

Trusted Publisher bindings are configured **per package** on `npmjs.com` and require the package to already exist on the registry. New packages therefore need a one-time bootstrap before OIDC can take over.

1. Add the package under `packages/<name>/` with a real `version`, `files`, `publishConfig.access: "public"`, `LICENSE`, and the standard fields enforced by `pnpm check:publish-readiness`.
2. Build it locally: `pnpm install && pnpm -r build`.
3. Mint a short-lived granular access token at `https://www.npmjs.com/settings/<your-user>/tokens/granular-access-tokens/new` — **Bypass 2FA: ON**, **Read and write: All packages**, **Expiration: 7 days**.
4. Bootstrap-publish:
   ```bash
   NPM_TOKEN=npm_xxx pnpm bootstrap:new-package
   ```
   The script auto-detects which workspace packages are missing on npm and publishes them via `pnpm publish --no-provenance` (so `workspace:^` specifiers get rewritten to real semver in the tarball).
5. The script prints one URL per freshly-published package. Open each, click **GitHub Actions** under "Trusted Publisher", confirm the auto-filled fields (`<owner>` / `<repo>` / `release.yml`), and tap your security key.
6. Revoke the bootstrap token at `https://www.npmjs.com/settings/<your-user>/tokens`.

From the next changeset bump onward, that package publishes through the normal `release.yml` flow with full OIDC provenance — same as the rest.

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Prettier** formats everything — run `pnpm format` before committing
- **ESLint** catches bugs — `pnpm lint` must pass
- **No default exports** in library packages — use named exports
- **Dual ESM/CJS** builds via tsup for all SDK packages

## Commit Messages

Use conventional commits:

```
feat(core): add batch report submission
fix(web): prevent widget from opening during screenshot
docs(react): update provider usage example
chore: bump dependencies
```

## Tests

- **Framework:** Vitest
- **Location:** Co-located with source (`src/foo.test.ts`)
- **Coverage:** Required for `core`, `web`, `react` — encouraged for all packages

## License

- SDK packages are MIT — your contributions will be MIT-licensed
- Server/agents/verify are BSL 1.1 — contributions to those packages fall under BSL

## Questions?

Open an issue or start a discussion. We're happy to help.
