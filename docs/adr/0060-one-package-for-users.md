# 0060. One package for users: `mushi-mushi`

Status: Accepted 2026-11-13 (owner): "why are there so many mushi package -
cant you make it single? its confusing users - all the weird naming and bunch
of packages."
Date: 2026-11-13

Related: `packages/launcher` (npm name `mushi-mushi`), its `tsup.config.ts`,
`packages/cli/src/detect.ts` (`FRAMEWORKS`, `isMushiSdkPackage`),
`packages/cli/src/upgrade.ts`, `packages/cli/src/doctor.ts`,
`_shared/sdk-upgrade-plan.ts` (`UPGRADEABLE_PACKAGES`, `UMBRELLA_PATHS`),
`_shared/sdk-health.ts`, `_shared/sdk-repo-scan.ts`,
`scripts/check-package-types.mjs`, `scripts/check-install-size.mjs`,
`.changeset/config.json`.

## Context

The npm org published 33 packages. A user adding Mushi Mushi to a React app
installed `@mushi-mushi/react` (which pulled `@mushi-mushi/web` and
`@mushi-mushi/core`), ran `npx mushi-mushi` (a launcher for
`@mushi-mushi/cli`), and could also find `create-mushi-mushi` (a second
launcher for the same CLI), 13 `plugin-*` packages, `plugin-sdk`, `adapters`
and the `inventory-*` packages. Nothing said which ones were for them.

Constraints that shaped the design:

- **Peer auto-install.** `@mushi-mushi/react`, `vue`, `svelte`, `angular` and
  `react-native` each list their framework as a REQUIRED peer, and npm 7+
  installs required peers. A package that depended on all the adapters would
  install React, Vue, Svelte and Angular into every app.
- **No new package names.** npm publishing is OIDC trusted publishing
  (`release.yml`); CI cannot publish a name npm has never seen. The umbrella
  has to be a name already published from this repo: `mushi-mushi`.
- **Native registration.** `@mushi-mushi/capacitor` ships iOS and Android code
  that Capacitor registers only from a top-level app dependency.
  `@mushi-mushi/react-native` relies on Metro's package-exports support for
  its subpaths. Neither can live behind a subpath of another package.
- **`npx` size.** `npx mushi-mushi` downloads everything `mushi-mushi`
  depends on, on every cold start.

## Decision

`mushi-mushi` is the one package users install. `npm install mushi-mushi`,
then import from a subpath; `npx mushi-mushi` still runs the setup wizard.

| Import | Ships |
|---|---|
| `mushi-mushi`, `mushi-mushi/web` | `@mushi-mushi/web` (the browser SDK) |
| `mushi-mushi/react`, `/vue`, `/svelte`, `/angular` | the framework adapters |
| `mushi-mushi/node`, `/node/express`, `/node/fastify`, `/node/hono` | `@mushi-mushi/node` |
| `mushi-mushi/core` | `@mushi-mushi/core` (types, API client) |
| `mushi-mushi/headless`, `/i18n`, `/otel`, `/test-utils` | the `@mushi-mushi/web` subpaths |

- **Dependencies** are only `@mushi-mushi/cli` (for the bin),
  `@mushi-mushi/core`, `@mushi-mushi/web` and `@mushi-mushi/node`; none has a
  required peer. The web, node and core subpaths are one-line re-exports of
  those packages, so an app that also has `@mushi-mushi/web` (directly or
  through an old adapter) shares one SDK instance. The SDK keeps reporting
  `@mushi-mushi/web` as its package identity.
- **The four adapters are devDependencies, bundled into their entry** at build
  time (tsup `noExternal` + `dts.resolve`), with `@mushi-mushi/core`,
  `@mushi-mushi/web` and every framework external. The adapters keep their own
  builds; the umbrella reuses them. The React entry gets its `'use client'`
  banner back (bundling drops the adapter's own).
- **Frameworks are optional peers** (`peerDependenciesMeta.optional`): react,
  react-dom, vue, svelte, @angular/core, express, fastify, hono and
  @opentelemetry/api. `mushi-mushi` never installs a framework the app does not
  use.
- **The bin moved to `src/bin.ts` → `dist/bin.js`**, so importing the package
  never starts the wizard.
- **ESM and CJS for every subpath**, with `.d.ts`/`.d.cts` and a
  `typesVersions` entry each; `check-package-types.mjs` checks the tarball
  under the `strict` profile.
- **React Native and Capacitor stay scoped** (`@mushi-mushi/react-native`,
  `@mushi-mushi/capacitor`). The wizard installs them itself on those
  platforms, so a user never types a scoped name.
- **Versioning:** `mushi-mushi` is in the changesets `linked` group with core,
  web and react. Its first umbrella release takes the group's version (1.35.0
  when web or core bump in the same release), not 0.9.0.
- **Everything that reads a host's SDK recognises the umbrella** next to the
  old names: the wizard (installs `mushi-mushi`, writes `mushi-mushi/<framework>`
  imports), `mushi upgrade` and `mushi doctor`, the console upgrade PR
  (`computeBumpPlan` bumps `mushi-mushi`), `sdk-versions-cron` (tracks its
  latest version), SDK health, the repo scan and the observation guard. A
  scoped SDK in an upgrade PR gets a pointer to its `mushi-mushi/<name>` path,
  not a migration.
- **`mushi-mushi` below 1.0 is the old setup command, not the SDK.** Hosts
  that keep `mushi-mushi@^0.8` as a devDependency to run the wizard have no SDK
  from it. Detection, SDK health, `mushi doctor`, `mushi upgrade` and the
  console upgrade PR ignore it (`isUmbrellaLauncherOnly` on the server,
  `isLauncherOnly` in the CLI). Bumping it to 1.x would add the whole SDK to an
  app that never imports it.
- **The old packages keep working and keep getting updates.** Nothing is
  removed or deprecated. Their READMEs say
  the same code ships in `mushi-mushi`. Self-host packages' descriptions start
  "Self-host only:" and internal ones "Internal to Mushi Mushi: install
  `mushi-mushi` instead."

### `create-mushi-mushi` is not deprecated

It runs the same setup wizard as `npx mushi-mushi`, but it also scaffolds Vue,
Svelte and Node starter apps with `--template`, which `npx mushi-mushi` does
not. An `npm deprecate` warning would tell people to stop using the only
command that does that. Its description and README now say "use
`npx mushi-mushi`" for adding Mushi Mushi to an existing app.

*Superseded by Phase 1b:* `--template` moved into `npx mushi-mushi`, so this
reason no longer holds. Whether to deprecate it is now the owner's choice; see
Phase 1b.

No owner step is needed for this change. `npm deprecate` needs the owner's own
npm login (CI's OIDC token can publish but not deprecate); Phase 2 lists the
commands for the packages it folds.

## Skills: one source (amendment, 2026-11-13)

Owner: "make the skills in a single package too and remove obsolete ones too
please". The agent skills had the same problem as the packages. There were
four copies: `skills/` (what `npx skills add kensaurus/mushi-mushi`
installs), an older `.cursor/skills/` set that had drifted from it since June,
a `mushi-triage` skill that only the Cursor plugin had, and a Claude Code plugin
with no skills at all.

- **`skills/` is the only hand-edited copy.** Seven skills:
  - `mushi-mushi` (router);
  - `mushi-setup`;
  - `mushi-triage` (moved from the Cursor plugin);
  - `mushi-debug`, which absorbs `mushi-health`. A pass/fail health check is
    debugging's first step, and the two shared most of their commands;
  - `mushi-test`, which absorbs `mushi-integration`. Its end-to-end smoke test
    is the same capture → diagnose → map → generate → run → improve loop;
  - `mushi-sdk-upgrade` (moved from `.cursor/skills`, now covers this ADR's
    umbrella and its 0.x launcher rule);
  - `mushi-check-live-app`.

  The merged skills keep both trigger sets. `.cursor/skills/` was deleted.
  The skills CLI never read it.
- **Both plugins ship the same skills, generated.** `scripts/sync-skills.mjs`
  writes `packages/cursor-plugin/skills/*` and `plugins/mushi-debugger/skills/*`,
  each `SKILL.md` with a GENERATED notice after its frontmatter, and rewrites
  the Cursor manifest's `skills` list. `pnpm check:skills` runs in the
  pre-commit hook and the CI build job, and also holds the Connect pages'
  `CONNECT_SKILLS.skillNames` to `skills/`.
- **The Claude Code plugin keeps its name, `mushi-debugger`.** Renaming would
  break existing installs. Its description now says it includes the skills
  (1.1.0). Claude Code scans a plugin's `skills/` folder on its own, so the
  manifest needs no `skills` field. `.claude-plugin/marketplace.json` must not
  declare one either: the skills CLI reads skill paths declared there and
  would list every skill twice. skill-sync only reads `skills/` at a repo's
  root, so the plugin copies are not synced twice either.
- No npm package ships these files, so the change needs no changeset.

## Phase 1b: ESLint rules and templates fold in

Accepted 2026-11-13 (owner): "i still see a bunch of others on npmjs?". The
owner's npm profile still listed three names: `mushi-mushi`,
`create-mushi-mushi` and `eslint-plugin-mushi-mushi`.

- **`mushi-mushi/eslint`.** The ESLint rules ship as a subpath of the umbrella:
  `import mushi from 'mushi-mushi/eslint'`, then `mushi.configs.recommended`
  in a flat config (`import { recommended } from 'mushi-mushi/eslint'` is the
  same object). The workspace package `eslint-plugin-mushi-mushi` is a
  devDependency of the umbrella and is bundled into that one entry (tsup
  `noExternal` + `dts.resolve`, like the framework adapters). `eslint` stays
  external and is an optional peer (`>=8`). There is a single entry, not an
  extra `/eslint/recommended` one: with `splitting: false` a second entry
  would bundle a second plugin object, and ESLint rejects a config that
  registers two objects under one plugin name.
- **`eslint-plugin-mushi-mushi` is private.** CI stops publishing it; 0.3.7 is
  its last version. It stays a workspace package because `apps/admin`,
  `apps/docs`, `apps/testers`, `packages/web`, `packages/react-native`,
  `packages/mcp-ci` and `packages/marketing-ui` lint with it through
  `workspace:` (all devDependencies, so changesets accepts it in `ignore`).
  It left the unscoped allowlist in `check-publish-readiness.mjs` and the
  bootstrap list. Rule IDs stay `mushi-mushi/*`, so the `dead_handler` and
  `mock_leak` gates in `@mushi-mushi/mcp-ci` read the same ESLint report.
- **Flat config only.** A legacy `.eslintrc` (`"plugins": ["mushi-mushi"]`)
  loads a plugin by its package name, `eslint-plugin-mushi-mushi`, so it
  cannot load the subpath. Legacy users stay on 0.3.7 until they move to flat
  config.
- **`--template` moved into the CLI.** The Vue, Svelte and Node starters live
  in `packages/cli/templates/` (`template.ts`), and `--template <id> [dir]` is
  a wizard flag: `npx mushi-mushi --template vue my-app`. Both unscoped bins
  call `runWizardBin` from `@mushi-mushi/cli/wizard-bin` and keep only their
  name, version and usage lines. The starters depend on
  `"mushi-mushi": "^1.35.0"` and import `mushi-mushi/vue`, `/svelte` and
  `/node` (they used the scoped packages), so a new app shows the same
  install the docs give. They carry the same CLI and keyring weight as any
  `mushi-mushi` app (see Consequences).
- **`create-mushi-mushi` is an alias.** It forwards every argument to the same
  code, so `npm create mushi-mushi` keeps working, including the `mushi`
  subcommands. A bare word that is not a command (`npm create mushi-mushi my-app`,
  the common form) still runs the wizard, after one hint line: "To start a new
  app instead: npx mushi-mushi --template <vue|svelte|node> my-app". The bin
  starts the `mushi` CLI with `MUSHI_WIZARD_PROBE=1`; the CLI checks the word
  against its own registered commands and exits 64 for an unknown one, so no
  command list is kept in the bins. Its description and README say "Same as npx mushi-mushi." It
  stays published.

### Owner steps (need the owner's own npm login)

CI's OIDC token can publish but cannot deprecate or unpublish.

1. Deprecate the ESLint plugin, then optionally unpublish it:

   ```bash
   npm deprecate eslint-plugin-mushi-mushi "Moved into mushi-mushi: import mushi from 'mushi-mushi/eslint'"
   npm unpublish eslint-plugin-mushi-mushi --force
   ```

   npm allows the unpublish: it has under 300 downloads a week (21), no
   dependents on npm and one owner. A deprecated package still shows on the
   profile; only the unpublish removes it. The unpublish breaks anyone still
   installing it (legacy `.eslintrc` users), and npm blocks republishing the
   name for 24 hours. Its only known users are this repo's apps, which use
   `workspace:`.
2. Optionally deprecate `create-mushi-mushi`:

   ```bash
   npm deprecate create-mushi-mushi "Same wizard as npx mushi-mushi. npm create mushi-mushi keeps working."
   ```

   It has about 440 downloads a week, so npm will not unpublish it. The
   trade-off: npm prints the deprecation warning on every
   `npm create mushi-mushi`, a command that keeps working and that the docs
   may still show. Leaving it undeprecated keeps it on the profile as a
   third name, now described as an alias.
3. Nothing to do for `@kensaurus/cursor-kenji` (671 downloads a week): npm
   will not unpublish it, and it is already deprecated.

### Measured

Measured 2026-11-13 with `pnpm pack` on Linux:

- **`mushi-mushi/eslint`** adds 128.3 kB unpacked to the umbrella:
  `eslint.js` 60.8 kB, `eslint.cjs` 61.8 kB, and `eslint.d.ts` and
  `eslint.d.cts` 2.9 kB each.
- **The `mushi-mushi` tarball** is now 54.8 kB packed and 225.2 kB unpacked
  (64 files). That includes the README rewrite. The budget went to 60 kB
  packed and 235 kB unpacked.
- **The `@mushi-mushi/cli` tarball** is 281.7 kB packed and 1,041.4 kB
  unpacked (57 files) with the starters. The budget went to 285 kB packed and
  1,050 kB unpacked.
- **The `create-mushi-mushi` tarball** is 2.4 kB packed.
- **`npx mushi-mushi` cold start:** the two tarballs are 36 kB larger packed
  than the Phase 1 figures (31.2 and 269.1 kB). Part of that is not Phase 1b:
  the README rewrite, and the CHANGELOG entries from the version PR both
  tarballs ship. The Phase 1b part is the ESLint entry (128.3 kB unpacked)
  and the 21 small starter files. The packed share of each was not measured
  separately.

## Phase 2 (not done in this change)

Bring the npm org down to about 12 published packages:

- Fold the 13 `plugin-*` packages into `@mushi-mushi/plugin-sdk` subpaths
  (`@mushi-mushi/plugin-sdk/slack`, …).
- Fold `inventory-schema` and `inventory-auth-runner` into the CLI, and
  `mcp-ci` into the mcp package.
- ~~Move `--template` into the wizard (`npx mushi-mushi --template vue`), then
  `create-mushi-mushi` can become a pure alias.~~ Done in Phase 1b.
- Stop publishing the folded packages (mark them
  private), then deprecate them on npm with the owner's login:
  `npm deprecate @mushi-mushi/plugin-<name>@"*" "Moved to @mushi-mushi/plugin-sdk/<name>."`,
  and the same for each folded package.

Each fold needs its own ADR amendment: self-hosters import those names today.

## Consequences

- **Measured 2026-11-13** (`pnpm pack`, Linux): the `mushi-mushi` tarball is
  31.2 kB packed, 110.1 kB unpacked, 60 files (budgeted in
  `check-install-size.mjs`).
- **`npx mushi-mushi` downloads more.** With its new dependencies the cold
  start is about 1,767 kB packed (cli 272.9, core 397.5, web 978.7, node 86.4,
  umbrella 31.2), up from about 300 kB (launcher + cli). `@mushi-mushi/web` is
  most of it, mainly source maps.
- **An app install of `mushi-mushi`** is about 14.0 MB of node_modules with
  npm on Linux. 6.1 MB of that is `@napi-rs/keyring`, the CLI's optional
  keychain dependency, which now lands in apps too (dev-time only, never in
  the app's bundle). Making the CLI a lazy `npx` call instead of a dependency
  would remove both costs; that would change how the bin works, so it is not
  part of this change.
- `create-mushi-mushi` stays published. Since Phase 1b it is an alias of
  `npx mushi-mushi`, not the only starter-app scaffolder.

## Rejected

- **A new package name** (`@mushi-mushi/sdk`, `mushi`): OIDC trusted
  publishing cannot create a name, and `mushi-mushi` is already the name users
  type for `npx`.
- **`mushi-mushi` depending on the adapter packages:** npm 7+ would install
  each adapter's required framework peer into every app.
- **Making the adapters' framework peers optional and depending on them:**
  changes four published packages' contracts and still installs four extra
  packages per app.
- **Folding React Native and Capacitor in:** Capacitor registers native code
  only from a top-level dependency; React Native subpaths depend on Metro's
  exports support.
- **Deprecating the scoped SDKs now:** every existing app would get a warning
  for a package that keeps working.
