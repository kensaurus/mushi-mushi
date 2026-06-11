# @mushi-mushi/cli

CLI for Mushi Mushi — set up the SDK in one command, then triage reports and monitor the pipeline from your terminal.

## One-command setup

```bash
npx @mushi-mushi/cli init
# equivalently:
npx mushi-mushi
```

The wizard:

1. Detects your framework (Next.js, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, or vanilla JS) from `package.json` and config files.
2. Picks the right SDK package (`@mushi-mushi/react`, `@mushi-mushi/vue`, etc.) plus `@mushi-mushi/web` when the framework SDK is API-only.
3. Detects your package manager (npm / pnpm / yarn / bun) from your lockfile and installs with that — `shell: false`, with Windows `.cmd` shim resolution.
4. Writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` (with the right framework prefix — `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`) to `.env.local` (or `.env`).
5. Warns you if `.env.local` isn't in `.gitignore` (covers `.env*.local`, `*.local`, etc.).
6. Prints the framework-specific provider snippet to copy-paste.
7. Offers to **send a real test report** so you see your first classified bug in the console immediately. Opt out via `--skip-test-report`.

It never silently overwrites existing env vars or modifies application code. Pasted credentials are sanitized (stripped of quotes / CR / LF / NUL) and validated against `^proj_[A-Za-z0-9_-]{10,}$` / `^mushi_[A-Za-z0-9_-]{10,}$` before anything is written to disk.

### Flags

```bash
mushi init --framework next                             # skip framework detection
mushi init --project-id proj_xxx --api-key mushi_xxx    # skip credential prompts
mushi init --skip-install                               # print the install command instead
mushi init --skip-test-report                           # don't offer to send a test report
mushi init --cwd apps/web                               # run in a sub-package of a monorepo
mushi init --endpoint https://mushi.your-company.com    # self-hosted Mushi API
mushi init -y                                           # accept the detected framework
```

Non-interactive use (CI): pass `--yes --project-id proj_xxx --api-key mushi_xxx` or the wizard exits with a clear error instead of hanging on a prompt.

Stale-version hint: the wizard checks the npm registry (2s timeout) and prints a one-line upgrade nudge if a newer stable is published. Opt out with `MUSHI_NO_UPDATE_CHECK=1`.

Monorepo awareness: if you run the wizard at a workspace root with no framework dep, it scans `apps/*`, `packages/*`, `examples/*` and tells you which sub-package you probably meant (`mushi init --cwd apps/web`).

## Install globally

```bash
npm install -g @mushi-mushi/cli
mushi --help
mushi --version
```

## Other commands

```bash
mushi login --api-key mushi_xxx     # store credentials in ~/.mushirc (mode 0o600)
mushi connect --api-key mushi_xxx --project-id <uuid> --endpoint <url> --wait
                                     # one-shot wiring: ~/.mushirc + .env.local + .cursor/mcp.json + heartbeat wait
mushi upgrade                        # bump installed @mushi-mushi/* packages to latest stable
mushi status                         # project overview
mushi reports list                   # recent reports
mushi reports show <id>              # one report
mushi reports triage <id> --status acknowledged --severity high
mushi deploy check                   # edge-function health probe
mushi index <path>                   # walk a local repo and feed RAG
mushi test                           # submit a test report end-to-end
mushi migrate                        # suggest the most relevant migration guide
mushi migrate --json                 # machine-readable JSON for CI
mushi config endpoint https://...    # set API endpoint (https:// required outside localhost)
mushi sourcemaps upload --release <ver> --dir <dist>   # upload .js.map / .css.map (sha256-idempotent)
```

### `mushi connect`

Non-interactive equivalent of `mushi init` for agents and scripts — wires a
repo to an existing project in one shot:

1. Saves credentials to `~/.mushirc` (mode `0o600`).
2. Merges `MUSHI_*` / framework-prefixed env vars into `.env.local` —
   existing keys are never overwritten (skip with `--no-env`).
3. Writes the `@mushi-mushi/mcp` server block into `.cursor/mcp.json` and
   ensures that file is gitignored, since it embeds the API key (skip with
   `--no-ide`).
4. With `--wait`, polls `GET /v1/sync/ingest-setup` every 3 s until the SDK
   heartbeat (or first report) lands, up to `--wait-timeout <sec>`
   (default 120). Rejected credentials (401/403/404) fail fast instead of
   polling out the timeout.

```bash
# Recommended: pass the key via env so it stays out of shell history
MUSHI_API_KEY=mushi_xxx mushi connect --project-id <uuid> \
  --endpoint https://<ref>.supabase.co/functions/v1/api --wait
mushi connect --api-key mushi_xxx --project-id <uuid> --endpoint <url> --no-ide --json
```

Exits non-zero when `--wait` times out or credentials are rejected, so it
composes in setup scripts and CI.

### `mushi upgrade`

Reads `package.json`, checks the npm registry for each installed
`@mushi-mushi/*` package, and runs the right install command for your package
manager (npm / pnpm / yarn / bun) to bump them to the latest stable release.

```bash
mushi upgrade               # plan + install
mushi upgrade --dry-run     # print the install command without running it
mushi upgrade --json        # machine-readable plan + result
mushi upgrade --cwd ../app  # target another repo
```

Pre-release versions are never auto-selected, registry versions are validated
against strict semver before being interpolated into the install command, and
non-registry specifiers (`workspace:`, `file:`, git URLs, dist-tags) are left
untouched. Legacy `@mushi-mushi/react` installs get a migration note pointing
at `@mushi-mushi/web`.

### `mushi sourcemaps upload`

Recursively scans `--dir` for `.js.map` and `.css.map` files and uploads them
under the given `--release`. Each file is hashed (sha256) and skipped if the
server already has it for that release, so the command is safe to run from
every CI build without churning storage.

```bash
mushi sourcemaps upload --release 1.4.2 --dir ./dist
mushi sourcemaps upload --release "$GITHUB_SHA" --dir ./build --dry-run
mushi sourcemaps upload --release "$GITHUB_SHA" --dir ./build --silent
```

Requires `MUSHI_API_ENDPOINT` and `MUSHI_API_KEY` (or pass `--endpoint` /
`--api-key`). Exits non-zero on any upload failure so CI gates fail fast.

### `mushi migrate`

Reads `package.json` (deps + devDeps + peerDeps) and prints links to the
matching guides on the docs site. Detects:

- **In-transition shapes** — Capacitor + React Native side-by-side, Cordova
  (or `cordova-ios`/`cordova-android`), Create React App.
- **Competitor SDKs** — Instabug / Luciq, Shake, LogRocket Feedback,
  BugHerd, Pendo Feedback.

Exits non-zero when nothing matches, so it composes in shell scripts:

```bash
mushi migrate || echo "no migration suggestions for this project"
```

Only `published` guides ever surface — `draft` entries are filtered out so
the CLI never points users at a 404. This safety property is unit-pinned in
`packages/cli/src/migrate.test.ts` (positive control + negative control +
real-catalog regression guard).

### `mushi doctor`

Checks CLI and SDK health.  Without flags it verifies local config and endpoint
reachability only.

```bash
mushi doctor                  # local checks only
mushi doctor --server         # + calls /preflight on the backend (all 4 dispatch checks)
mushi doctor --ingest         # + calls /v1/sync/ingest-setup (API key → heartbeat → first report)
mushi doctor --json           # machine-readable JSON output (exits 1 if any check fails)
```

Local checks performed:

| Check | What it verifies |
|---|---|
| CLI config | `~/.mushirc` exists, `projectId` and `apiKey` fields are present |
| Endpoint reachability | `GET /v1/sdk/config?project_id=...` returns 200 |
| SDK install | `@mushi-mushi/web` or framework-specific SDK is in `node_modules` |

With `--server`, also calls `GET /v1/admin/projects/:id/preflight` (same 4 checks
the admin console dispatch popover uses) and merges the results.  The four
server checks (`key` values returned by the endpoint):

| `key` | What it verifies |
|---|---|
| `github` | A GitHub repo URL is linked (`project_repos.repo_url` or `project_settings.codebase_repo_url`) |
| `codebase` | Codebase indexing is enabled AND `pgvector` has at least one non-tombstoned file AND `last_indexed_at` is set |
| `anthropic` | A BYOK Anthropic key is stored in Supabase Vault (`project_settings.byok_anthropic_key_ref`) |
| `autofix` | The autofix toggle is ON (`project_settings.autofix_enabled = true`) |

`--server` requires `adminOrApiKey` credentials — set `MUSHI_API_KEY` to an
admin key (not a public SDK key).

With `--ingest`, also calls `GET /v1/sync/ingest-setup` (authenticated with the
SDK API key) and reports each **required ingest step** — project exists, active
API key, SDK heartbeat, at least one ingested report — plus a
`Last SDK heartbeat` diagnostic with the timestamp and endpoint host. This is
the same payload `mushi connect --wait` polls, so a failing step here tells you
exactly why the banner isn't showing up.

### `mushi reset <projectId>`

Archives a project and wipes its test data so the full onboarding flow can be
re-run.  Useful for development and QA.

```bash
mushi reset proj_xxx --confirm   # required flag prevents accidental wipes
```

Wipes: `fix_attempts`, `project_codebase_files`, `reports`, `fix_dispatch_jobs`.
Sets `projects.archived_at`.  **Irreversible.**

### `mushi fixes tail --report-id <id>`

Streams dispatch events for a report in real-time via SSE.  Pairs with
`mushi doctor --server` for headless debugging without opening the admin console.

```bash
mushi fixes tail --report-id 11111111-2222-3333-4444-555555555555
```

Exits automatically when the job reaches a terminal status (`completed`,
`failed`, `cancelled`, `skipped`).

## Security notes

- `~/.mushirc` is written with mode `0o600` on Unix. Legacy configs with looser permissions are tightened on load.
- `--endpoint` values are parsed through `new URL()` and required to use `https://` except for `localhost` / `127.0.0.1` / `*.local`.
- The `--api-key` flag leaks into `ps -ef` — prefer the interactive prompt on shared machines.
- Full stack traces on error: `DEBUG=mushi mushi init`.

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 43 edge functions · 234 SQL migrations · 13 outbound plugins · 11 inbound adapters. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
