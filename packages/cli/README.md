# @mushi-mushi/cli

CLI for Mushi Mushi — set up the SDK in one command, then triage reports and monitor the pipeline from your terminal.

## One-command setup

```bash
npx @mushi-mushi/cli init
# or, equivalently:
npx mushi-mushi init
```

The wizard:

1. Detects your framework (Next.js, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, or vanilla JS) from `package.json` and config files.
2. Picks the right SDK package (`@mushi-mushi/react`, `@mushi-mushi/vue`, etc.) plus `@mushi-mushi/web` when the framework SDK is API-only.
3. Detects your package manager (npm / pnpm / yarn / bun) from your lockfile and installs with that.
4. Writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` (with the right framework prefix — `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`) to `.env.local` (or `.env`).
5. Warns you if `.env.local` isn't in `.gitignore`.
6. Prints the framework-specific provider snippet to copy-paste.

It never silently overwrites existing env vars or modifies application code.

### Flags

```bash
mushi init --framework next         # skip framework detection
mushi init --project-id proj_xxx --api-key mushi_xxx  # skip credential prompts
mushi init --skip-install           # print the install command instead of running it
mushi init -y                       # accept the detected framework without confirmation
```

## Install globally

```bash
npm install -g @mushi-mushi/cli
mushi --help
```

## Other commands

```bash
mushi login --api-key mushi_xxx     # store credentials in ~/.mushirc
mushi status                         # project overview
mushi reports list                   # recent reports
mushi reports show <id>              # one report
mushi reports triage <id> --status acknowledged --severity high
mushi deploy check                   # edge-function health probe
mushi index <path>                   # walk a local repo and feed RAG
mushi test                           # submit a test report end-to-end
```

## License

MIT
