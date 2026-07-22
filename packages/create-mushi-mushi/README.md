# create-mushi-mushi

> **Your AI wrote it. Mushi tells you why it broke.**

Scaffold a new app with Mushi pre-wired.


> One-line setup for the [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) bug-reporting + AI triage SDK.

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

This is a **scaffold for existing projects** — it does not generate a new app from scratch. Run it from the project root of an existing app.

## Flags

```bash
npm create mushi-mushi -- --framework next
npm create mushi-mushi -- --project-id proj_xxx --api-key mushi_xxx
npm create mushi-mushi -- --skip-install
npm create mushi-mushi -- --skip-test-report
npm create mushi-mushi -- --cwd apps/web
npm create mushi-mushi -- --endpoint https://mushi.your-company.com
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

<sub>Monorepo scale (July 2026): 55 edge functions · 327 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
