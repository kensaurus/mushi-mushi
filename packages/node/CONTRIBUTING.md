<!--
  AUTO-SYNCED from repo root by scripts/sync-community-files.mjs.
  Do not edit here — edit the canonical file at the repository root and
  re-run `node scripts/sync-community-files.mjs` (pre-commit hook does this
  automatically).
-->

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
  docs/          Documentation site (Nextra — apps/docs)
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

### Documentation (docs-as-code)

If your PR changes **user-visible SDK or CLI behavior**, update docs in the **same PR**:

| Surface | When to update |
| --- | --- |
| `packages/*/README.md` | npm-facing install/API/config changes for that package |
| `apps/docs/content/**/*.mdx` | Long-form guides, quickstarts, admin console docs |
| Root `README.md` | Marketing stats only when counts change — run `pnpm check:docs-stats` |

Guardrails (run locally before pushing):

```bash
pnpm check:docs-stats          # root README stat badges
pnpm check:sdk-version-matrix  # apps/docs/content/sdks/index.mdx versions
pnpm check:internal-doc-links  # dead /foo links in MDX
pnpm check:bundle-docs         # @mushi-mushi/web size-limit vs README
pnpm gen:llms-txt              # regenerate apps/docs/public/llms.txt after nav changes
```

README changes on npm packages only appear on [npmjs.com](https://www.npmjs.com) after the next **Changesets publish**.

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
