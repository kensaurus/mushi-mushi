# @mushi-mushi/cli

> **Your AI wrote it. Mushi tells you why it broke.**

Set up the Mushi SDK, wire Cursor MCP, and review bugs from your terminal.

Positioning and product overview: [docs site](https://github.com/kensaurus/mushi-mushi/blob/master/apps/docs/content/quickstart/index.mdx) · [VISION.md](https://github.com/kensaurus/mushi-mushi/blob/master/VISION.md)

## Quick start

```bash
npx @mushi-mushi/cli init
```

## Console ↔ CLI loop

Before pasting credentials, create a project in the admin console:

| Environment | Console base | Override |
| --- | --- | --- |
| Hosted | `https://kensaur.us/mushi-mushi/admin` | — |
| Local monorepo | `http://localhost:6464` (after `pnpm dev`) | auto-probed |
| Custom | Set `MUSHI_CONSOLE_URL` | wins over heuristics |

**Where to find credentials:**

- **Project ID** — UUID from the success panel after **Create**, or Projects → UUID chip
- **API key** — **Setup → Verify → Generate API key** (`report:write`). Not Settings → BYOK

The wizard opens `/onboarding?tab=steps&setup=cli` when you choose "No — open the console to create one."

Full walkthrough: [CLI ↔ console loop](https://github.com/kensaurus/mushi-mushi/blob/master/apps/docs/content/quickstart/cli-console-loop.mdx) on the docs site.

## Command cheat sheet

| Command | Purpose |
| --- | --- |
| `mushi init` / `npx mushi-mushi` | SDK wizard: framework detect, install, `.env.local`, optional test report |
| `mushi connect` | Non-interactive: config + env + Cursor MCP + optional `--wait` heartbeat |
| `mushi login` | Save credentials to `~/.config/mushi/config.json` |
| `mushi setup` | Wire Cursor/Claude MCP only (reads saved config — run `login` first) |
| `mushi nudge` | Phase-tuned `Mushi.init()` snippet (`alpha` / `beta` / `ga`) |
| `mushi doctor` | Local + optional server preflight checks |

## One-command setup

```bash
npx @mushi-mushi/cli init
# equivalently:
npx mushi-mushi
```

The wizard:

1. **Prerequisite step** (unless flags/config already present): open console to create a project, paste existing credentials, or exit to run `mushi login` first.
2. Detects your framework (Next.js, Remix, Astro, Nuxt, SvelteKit, Angular, Expo, Capacitor, Create React App, Solid/SolidStart, plain React/Vue/Svelte, Express/Fastify/Hono, or vanilla JS) from `package.json` and config files — and writes the correct client env-var prefix for each (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_`, or bare `MUSHI_*`).
3. Calls **`GET /v1/sync/whoami`** to verify Project ID + API key before installing anything.
4. Picks the right SDK package (`@mushi-mushi/react`, `@mushi-mushi/vue`, etc.) plus `@mushi-mushi/web` when the framework SDK is API-only.
5. Detects your package manager (npm / pnpm / yarn / bun) from your lockfile and installs with that — `shell: false`, with Windows `.cmd` shim resolution.
6. Writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` (with the right framework prefix — `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`) to `.env.local` (or `.env`).
7. Warns you if `.env.local` isn't in `.gitignore` (covers `.env*.local`, `*.local`, etc.).
8. Prints the framework-specific provider snippet to copy-paste.
9. Offers to **send a real test report** so you see your first classified bug in the console immediately. Opt out via `--skip-test-report`.
10. Optionally runs **`mushi connect --write-env --wire-ide --wait`** for Cursor MCP + heartbeat proof.

It never silently overwrites existing env vars or modifies application code. Pasted credentials are sanitized (stripped of quotes / CR / LF / NUL) and validated before anything is written to disk:

- Project ID: UUID (`xxxxxxxx-xxxx-…`) or future `proj_` + 10+ alphanumeric chars
- API key: `mushi_` or `mush_pk_` + 10+ alphanumeric chars

### Flags

```bash
mushi init --framework next                                              # skip framework detection
mushi init --project-id bdafa28d-b153-482f-bd4f-42981f3fd3a4 --api-key mushi_xxx  # skip prompts
mushi init --skip-install                                                # print the install command instead
mushi init --skip-test-report                                            # don't offer to send a test report
mushi init --cwd apps/web                                                # run in a sub-package of a monorepo
mushi init --endpoint https://mushi.your-company.com                     # self-hosted Mushi API
mushi init -y                                                            # accept the detected framework
```

Non-interactive use (CI): pass `--yes --project-id <uuid> --api-key mushi_xxx` or the wizard exits with a clear error instead of hanging on a prompt.

Stale-version hint: the wizard checks the npm registry (2s timeout) and prints a one-line upgrade nudge if a newer stable is published. Opt out with `MUSHI_NO_UPDATE_CHECK=1`.

Monorepo awareness: if you run the wizard at a workspace root with no framework dep, it scans `apps/*`, `packages/*`, `examples/*` and tells you which sub-package you probably meant (`mushi init --cwd apps/web`).

Console URL resolution: `MUSHI_CONSOLE_URL` → saved `consoleUrl` in config → localhost `:6464` probe → mushi-mushi monorepo heuristic → hosted default. Saved on successful `mushi login`.

### Browser sign-in reliability

Device auth (RFC 8628) uses a stable per-machine `client_id` stored in
`~/.config/mushi/config.json`. Starting a new login on the same machine supersedes
any older pending approval for that id.

During token polling the CLI retries **429** and **408** responses automatically.
If saved credentials exist, re-running the wizard validates them with
`GET /v1/sync/whoami` before reinstalling.

The browser approval page waits until the CLI actually claims the token (not
just when you click Approve). Full flow + troubleshooting:
[CLI ↔ console loop](https://kensaur.us/mushi-mushi/docs/quickstart/cli-console-loop).

## Install globally

```bash
npm install -g @mushi-mushi/cli
mushi --help
mushi --version
```

## Other commands

```bash
mushi login --api-key mushi_xxx     # store credentials in ~/.config/mushi/config.json (mode 0o600)
mushi setup                         # wire Cursor MCP from saved config (not SDK install)
mushi connect --project-id <uuid> --endpoint <url> --write-env --wire-ide --wait
                                     # one-shot wiring: config + .env.local + .cursor/mcp.json + heartbeat wait
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

Non-interactive wiring for agents and scripts — connects a repo to an existing project:

1. Saves credentials to `~/.config/mushi/config.json` (mode `0o600`).
2. Merges `MUSHI_*` / framework-prefixed env vars into `.env.local` —
   existing keys are never overwritten (skip with `--no-env`; explicit with `--write-env`).
3. Writes the `@mushi-mushi/mcp` server block into `.cursor/mcp.json` and
   ensures that file is gitignored, since it embeds the API key (skip with
   `--no-ide`; explicit with `--wire-ide`).
4. With `--wait`, polls `GET /v1/sync/ingest-setup` every 3 s until the SDK
   heartbeat (or first report) lands, up to `--wait-timeout <sec>`
   (default 120). Rejected credentials (401/403/404) fail fast instead of
   polling out the timeout.

```bash
# Recommended: pass the key via env so it stays out of shell history
MUSHI_API_KEY=mushi_xxx mushi connect --project-id <uuid> \
  --endpoint https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api \
  --write-env --wire-ide --wait
mushi connect --api-key mushi_xxx --project-id <uuid> --endpoint <url> --no-ide --json
```

Exits non-zero when `--wait` times out or credentials are rejected, so it
composes in setup scripts and CI.

### `mushi setup`

Writes IDE MCP config from `~/.config/mushi/config.json` — run `mushi login` first.
Does **not** install SDK packages or write app env vars (use `mushi init` for that).

```bash
mushi setup                         # wire Cursor (default)
mushi setup --ide claude            # Claude Code / Desktop
mushi setup --all-projects          # one MCP server entry per accessible project
```

### `mushi upgrade`

Reads `package.json`, checks the npm registry for each installed
`@mushi-mushi/*` package, and runs the right install command for your package
manager (npm / pnpm / yarn / bun) to bump them to the latest stable release.

**Console equivalent:** **Connect & Update → Create Upgrade PR** opens a GitHub
draft PR for the linked repo (backed by `sdk-upgrade-worker`). Use the CLI for
local bumps; use the PR flow when you want review + CI on the dependency change.

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

### `mushi completion`

Prints a tab-completion script for bash, zsh, or fish, generated from the
CLI's live command tree — so it never drifts as commands are added.

```bash
eval "$(mushi completion bash)"                      # try it for the current session
mushi completion bash >> ~/.bashrc                   # bash: persist across sessions
mushi completion zsh > "${fpath[1]}/_mushi"           # zsh: needs a dir already on $fpath
mushi completion fish > ~/.config/fish/completions/mushi.fish
```

### `mushi doctor`

Checks CLI and SDK health. **Ingest and dispatch (server) checks run by
default** — pass `--no-server` / `--no-ingest` to limit it to local checks.

```bash
mushi doctor                  # local + ingest + dispatch readiness (the full picture)
mushi doctor --no-server      # skip the dispatch-readiness /preflight checks
mushi doctor --no-ingest      # skip the ingest-setup checks (SDK heartbeat, first report)
mushi doctor --fix            # apply safe local fixes, then re-run and report the post-fix state
mushi doctor --json           # machine-readable JSON output (exits 1 if any check fails)
mushi doctor --qa-stories     # also flag enabled QA stories with setup issues (needs server creds)
mushi doctor --host-app       # also verify host-app wiring (env vars, Cursor MCP, Capacitor notes)
```

`--fix` writes any missing `.env.local` lines and wires the Cursor MCP config
(via `mushi connect`), then re-runs every check so the printed result and exit
code reflect the post-fix state rather than the stale pre-fix failures.

### `mushi nudge`

Generate a ready-to-paste `Mushi.init()` snippet tuned for your release phase
(proactive triggers, cooldowns, feature-request card, beta-mode UI).

```bash
mushi nudge --phase beta              # default phase
mushi nudge --phase alpha --explain   # + human-readable summary of the preset
mushi nudge --phase ga --max 2 --cooldown 24 --dwell 5 --welcome 10
```

| Flag | Meaning |
|------|---------|
| `--phase <alpha\|beta\|ga>` | Release phase preset (default `beta`) |
| `--explain` | Print a human-readable summary of what the preset does |
| `--max <n>` | Override `maxProactivePerSession` (≥ 1) |
| `--cooldown <hours>` | Override `dismissCooldownHours` (≥ 0) |
| `--dwell <minutes>` | Override page-dwell threshold (`0` disables) |
| `--welcome <seconds>` | Override first-session welcome delay (`0` disables) |

Local checks performed:

| Check | What it verifies |
|---|---|
| CLI config | `~/.config/mushi/config.json` exists, `projectId` and `apiKey` fields are present |
| Endpoint reachability | `GET /v1/sdk/config?project_id=...` returns 200 |
| SDK install | `@mushi-mushi/web` or framework-specific SDK is in `node_modules` |

The dispatch-readiness checks (on by default; skip with `--no-server`) call
`GET /v1/admin/projects/:id/preflight` (the same 4 checks the admin console
dispatch popover uses) and merge the results.  The four server checks (`key`
values returned by the endpoint):

| `key` | What it verifies |
|---|---|
| `github` | A GitHub repo URL is linked (`project_repos.repo_url` or `project_settings.codebase_repo_url`) |
| `codebase` | Codebase indexing is enabled AND `pgvector` has at least one non-tombstoned file AND `last_indexed_at` is set |
| `anthropic` | A BYOK Anthropic key is stored in Supabase Vault (`project_settings.byok_anthropic_key_ref`) |
| `autofix` | The autofix toggle is ON (`project_settings.autofix_enabled = true`) |

The dispatch-readiness checks require `adminOrApiKey` credentials — set
`MUSHI_API_KEY` to an admin key (not a public SDK key). If you only have an SDK
key, pass `--no-server` to skip them.

The ingest checks (on by default; skip with `--no-ingest`) call
`GET /v1/sync/ingest-setup` (authenticated with the SDK API key) and report each
**required ingest step** — project exists, active API key, SDK heartbeat, at
least one ingested report — plus a `Last SDK heartbeat` diagnostic with the
timestamp and endpoint host. This is the same payload `mushi connect --wait`
polls, so a failing step here tells you exactly why the banner isn't showing up.

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

### `mushi fixes merge <fixId>`

Squash-merge (or merge/rebase) the fix PR on GitHub and run the same post-merge
bookkeeping as the admin console: `merged_at`, report → **Fixed**, reporter
notification, `fix.applied` webhooks.

```bash
mushi fixes merge 75199dde-f726-404a-b5f7-be17bf7a3a46
mushi fixes merge <fixId> --method squash    # default
mushi fixes merge <fixId> --method merge
mushi fixes merge <fixId> --method rebase
mushi fixes merge <fixId> --json
```

Requires an admin API key with `mcp:write` scope and a connected GitHub App or PAT.
Draft PRs are auto-readied via GraphQL before merge.

### `mushi fixes refresh-ci <fixId>`

Pull the latest GitHub Actions check-run status on demand (same as **Refresh CI
status** in the console). Useful when webhooks drop or you just pushed to the PR
branch.

```bash
mushi fixes refresh-ci <fixId>
mushi fixes refresh-ci <fixId> --json
```

---

## QA coverage & TDD

```bash
mushi stories map --url https://your-app.com --wait
mushi tdd gen <storyId> --mode review
mushi tdd pending
mushi tdd approve <qaStoryId>
mushi tdd improve
mushi qa stories
mushi qa runs <storyId>
mushi qa run <storyId>
mushi audit
```

---

## Skill pipelines

```bash
mushi skills list [--category workflow] [--search "fix"]
mushi skills show workflow-fix-and-ship
mushi skills sync

mushi pipeline start <reportId> --skill workflow-fix-and-ship [--mode cloud|handoff]
mushi pipeline watch <runId-or-prefix>
mushi pipeline checkin <runId-or-prefix> --step 0 --status passed
```

---

## Integrations & BYOK

```bash
mushi integrations list
mushi integrations test slack|sentry|github
mushi keys list
MUSHI_BYOK_KEY=sk-ant-... mushi keys add --provider anthropic --label "Backup"
mushi slack status
mushi slack test
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `MUSHI_API_KEY` | Admin or ingest API key (prefer env over `--api-key` flag) |
| `MUSHI_API_ENDPOINT` | API base URL (defaults to Mushi Cloud when unset) |
| `MUSHI_PROJECT_ID` | Project UUID |
| `MUSHI_CONSOLE_URL` | Admin console base for hints + browser opens |
| `MUSHI_BYOK_KEY` | BYOK key for `mushi keys add` (keeps key out of shell history) |
| `MUSHI_NO_UPDATE_CHECK=1` | Skip npm registry version nudge in `mushi init` |

Config file: `~/.config/mushi/config.json` (Unix mode `0o600`; legacy `~/.mushirc` auto-migrates).

## Security notes

- `~/.config/mushi/config.json` is written with mode `0o600` on Unix. Legacy configs with looser permissions are tightened on load.
- `--endpoint` values are parsed through `new URL()` and required to use `https://` except for `localhost` / `127.0.0.1` / `*.local`.
- The `--api-key` flag leaks into `ps -ef` — prefer the interactive prompt on shared machines.
- Full stack traces on error: `MUSHI_DEBUG=1 mushi init`.

## Programmatic imports

The CLI is also importable for tooling (used by `create-mushi-mushi`):

| Subpath | Exports |
| --- | --- |
| `@mushi-mushi/cli/init` | `runInit`, `InitOptions` |
| `@mushi-mushi/cli/detect` | Framework / package-manager detection |
| `@mushi-mushi/cli/version` | `MUSHI_CLI_VERSION` |

## License

MIT

<!-- mushi-readme-stats-footer -->
<sub>Monorepo scale (July 2026): 51 edge functions · 323 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
