# create-mushi-mushi

> **Your AI wrote it. Mushi tells you why it broke.**

Add Mushi to the app you already have in one command, or scaffold a Vue, Svelte
or Node starter with `--template`.

> One-line setup for the [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) bug-reporting SDK: a user's report arrives as a plain-English diagnosis and a paste-ready fix in your editor.

```bash
npm create mushi-mushi
# or
pnpm create mushi-mushi
yarn create mushi-mushi
bun create mushi-mushi
```

## What it does

1. **Detects your framework** — Next.js, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, or vanilla JS.
2. **Picks the right SDK** — `@mushi-mushi/react`, `@mushi-mushi/vue`, `@mushi-mushi/svelte`, `@mushi-mushi/angular`, `@mushi-mushi/react-native`, `@mushi-mushi/capacitor`, or `@mushi-mushi/web`.
3. **Detects your package manager** — uses `npm`, `pnpm`, `yarn`, or `bun` based on your lockfile.
4. **Writes env vars** — framework-prefixed keys (e.g. `VITE_MUSHI_PROJECT_ID` / `NEXT_PUBLIC_MUSHI_API_KEY`) land in `.env.local`.
5. **Warns about `.gitignore`** — won't ship secrets if your env file isn't ignored.
6. **Prints the provider snippet** — framework-specific code to paste in.
7. **Sends a test report** (opt-in) — closes the loop so you see your first classified bug immediately.

By default it wires Mushi into an **existing** project, so run it from that project's root. To start from nothing, use a starter template instead.

## Starter templates

`--template` scaffolds a minimal starter app with Mushi already wired, instead of running the wizard:

```bash
npm create mushi-mushi -- --template vue           # into ./mushi-vue-app
npm create mushi-mushi -- --template svelte my-app # into ./my-app
npm create mushi-mushi -- --template node          # into ./mushi-node-app
```

Valid templates: `vue`, `svelte`, `node`. The target directory must not exist yet. Then:

```bash
cd mushi-vue-app
npm install
npx mushi-mushi   # browser sign-in, writes your env vars
npm run dev       # npm start for the node starter
```

## Flags

```bash
npm create mushi-mushi -- --framework next
npm create mushi-mushi -- --project-id proj_xxx --api-key mushi_xxx
npm create mushi-mushi -- --skip-install
npm create mushi-mushi -- --skip-test-report
npm create mushi-mushi -- --cwd apps/web
npm create mushi-mushi -- --endpoint https://mushi.your-company.com
npm create mushi-mushi -- --template vue [dir]
npm create mushi-mushi -- -y
npm create mushi-mushi -- --help
```

> `npm create` and `pnpm create` need the `--` separator before flags. Yarn 1 and Bun do not.

## Equivalent commands

```bash
npx mushi-mushi               # shorter
npx @mushi-mushi/cli init     # scoped name
```

## Troubleshooting

- **Wrong framework detected?** Pass `--framework <id>` explicitly. Valid IDs: `next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla`.
- **Running in a monorepo?** `cd` into the package you want Mushi in first, or pass `--cwd apps/web`.
- **`npx` cache serving an old version?** Run `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive (CI)?** Pass all of `--yes`, `--project-id`, and `--api-key`. The wizard exits with a clear error otherwise.
- **Key pasted with quotes/whitespace?** The wizard strips them, but still validates against `mushi_[A-Za-z0-9_-]{10,}` / `proj_[A-Za-z0-9_-]{10,}`.

## Security

- Credentials accepted via `--api-key` flag leak into `ps -ef`. Prefer the interactive prompt on dev machines; on CI, pass them via the environment and an explicit `--api-key "$MUSHI_API_KEY"` at the boundary.
- The `~/.config/mushi/config.json` credentials cache is written with mode `0o600` (owner read/write only) on Unix. Legacy `~/.mushirc` auto-migrates on first load.
- All env-file writes strip CR/LF/NUL from secrets to prevent accidental `.env` injection.

## Links

- [Console](https://kensaur.us/mushi-mushi/)
- [GitHub](https://github.com/kensaurus/mushi-mushi)
- [Docs](https://github.com/kensaurus/mushi-mushi#readme)
- [Report a bug](https://github.com/kensaurus/mushi-mushi/issues)

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 59 edge functions · 360 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
