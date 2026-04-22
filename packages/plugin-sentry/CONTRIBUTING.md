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
