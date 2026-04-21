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
mushi status                         # project overview
mushi reports list                   # recent reports
mushi reports show <id>              # one report
mushi reports triage <id> --status acknowledged --severity high
mushi deploy check                   # edge-function health probe
mushi index <path>                   # walk a local repo and feed RAG
mushi test                           # submit a test report end-to-end
mushi config endpoint https://...    # set API endpoint (https:// required outside localhost)
```

## Security notes

- `~/.mushirc` is written with mode `0o600` on Unix. Legacy configs with looser permissions are tightened on load.
- `--endpoint` values are parsed through `new URL()` and required to use `https://` except for `localhost` / `127.0.0.1` / `*.local`.
- The `--api-key` flag leaks into `ps -ef` — prefer the interactive prompt on shared machines.
- Full stack traces on error: `DEBUG=mushi mushi init`.

## License

MIT
