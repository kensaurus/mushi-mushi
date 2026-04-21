# create-mushi-mushi

## 0.5.0

### Minor Changes

- 18572f7: **Security + UX hardening sweep for the installer trio.**

  Security:
  - `~/.mushirc` is now written with mode `0o600` on Unix. On load, existing files written with looser permissions are proactively chmod'd down so upgrading users are not exposed to other local users on a shared box.
  - Package-manager install no longer uses `shell: true`. We resolve the platform-specific executable (`npm.cmd` on Windows, `npm` elsewhere) and spawn with `shell: false`, closing the door on future shell-metacharacter injection if arbitrary arg forwarding is ever added.
  - Credentials pasted into the wizard are sanitized (stripped of surrounding quotes, whitespace, and CR/LF/NUL) and validated against `^proj_[A-Za-z0-9_-]{10,}$` / `^mushi_[A-Za-z0-9_-]{10,}$` before they're written to disk. Prevents `.env` injection via newlines in a pasted secret.
  - `--endpoint` URLs now require `https://` except for localhost / `.local` / link-local addresses. Typo'd `http://` endpoints are rejected instead of silently exfiltrating the API key.
  - All three published packages now declare `publishConfig.provenance: true` (belt-and-suspenders with the existing `NPM_CONFIG_PROVENANCE=true` in CI) so the npm page shows the verified-publisher badge on every release.
  - New `.github/workflows/security.yml` runs CodeQL (security-extended) + `pnpm audit --prod --audit-level=high` on every PR and weekly via cron.

  UX:
  - `mushi --version` now reports the real package version instead of the stale hardcoded `0.3.0`.
  - Launcher & create-mushi-mushi gained `--version`, `--cwd`, `--endpoint`, `--skip-test-report`, and a non-TTY bail-out that errors clearly instead of hanging on `@clack/prompts` in CI.
  - End-of-wizard "Send a test report now?" prompt closes the loop: the user sees their first classified bug in the console without leaving the terminal.
  - `.gitignore` detection now covers the common patterns (`.env*.local`, `.env.*.local`, `*.local`, `*.env*`) so the "not gitignored" warning stops crying wolf.
  - Monorepo / sub-package support via `--cwd <path>` forwarded from the shims.
  - Error handler on the shims now hints at `DEBUG=mushi` for stack traces and links to the issue tracker.
  - Dead `writeFileSync(readFileSync(...))` round-trip in `writeEnvFile` removed.

  Housekeeping:
  - `funding` field (`https://github.com/sponsors/kensaurus`) added to all three packages.
  - New `./version` subpath export on `@mushi-mushi/cli`.
  - Shared `FRAMEWORK_IDS` / `isFrameworkId` exported from `@mushi-mushi/cli/detect` so the three-file duplicate of the framework list no longer has to be kept in sync.
  - Integration tests for the shims (`--help`, `--version`, unknown framework, unknown flag, non-TTY bail-out) and permission-mode tests for `~/.mushirc`.

### Patch Changes

- Updated dependencies [18572f7]
  - @mushi-mushi/cli@0.5.0

## 0.4.0

### Minor Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

### Patch Changes

- Updated dependencies [fc5c58e]
  - @mushi-mushi/cli@0.4.0
