# mushi-mushi

> 🐛 **One-command setup for the [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) bug-reporting + AI triage SDK.**

```bash
npx mushi-mushi
```

That's it. The wizard auto-detects your framework, installs the right SDK package, writes your env vars, and prints the snippet to paste into your app.

## What it does

1. **Detects your framework** — Next.js, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, or vanilla JS — by reading `package.json` and looking for config files.
2. **Picks the right SDK** — installs `@mushi-mushi/react`, `@mushi-mushi/vue`, `@mushi-mushi/svelte`, `@mushi-mushi/angular`, `@mushi-mushi/react-native`, `@mushi-mushi/capacitor`, or `@mushi-mushi/web` depending on what you're using.
3. **Detects your package manager** — uses `pnpm`, `npm`, `yarn`, or `bun` based on your lockfile.
4. **Writes env vars** — `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` go into `.env.local` with the right framework prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, or `VITE_`).
5. **Warns about `.gitignore`** — never commits secrets if `.env.local` isn't ignored.
6. **Prints the integration snippet** — framework-specific provider/init code you can paste straight in.
7. **Sends a test report** (opt-in) — so you see your first classified bug in the console without leaving the wizard.

It is **non-destructive**: never silently overwrites existing env vars and never modifies your application code.

## Flags

```bash
npx mushi-mushi --framework next               # skip framework detection
npx mushi-mushi --project-id proj_xxx --api-key mushi_xxx
npx mushi-mushi --skip-install                 # print install command instead of running it
npx mushi-mushi --skip-test-report             # don't offer to send a test report
npx mushi-mushi --cwd apps/web                 # run in a sub-package of a monorepo
npx mushi-mushi --endpoint https://mushi.your-company.com
npx mushi-mushi -y                             # accept the detected framework without prompting
npx mushi-mushi -v                             # print version
npx mushi-mushi --help
```

## Direct SDK install (skip the wizard)

If you'd rather wire it up yourself, install the framework SDK directly:

| Framework           | Package                                    |
| ------------------- | ------------------------------------------ |
| React               | `@mushi-mushi/react`                       |
| Next.js             | `@mushi-mushi/react`                       |
| Vue 3 / Nuxt        | `@mushi-mushi/vue` + `@mushi-mushi/web`    |
| Svelte / SvelteKit  | `@mushi-mushi/svelte` + `@mushi-mushi/web` |
| Angular             | `@mushi-mushi/angular` + `@mushi-mushi/web`|
| React Native / Expo | `@mushi-mushi/react-native`                |
| Capacitor / Ionic   | `@mushi-mushi/capacitor`                   |
| Vanilla JS          | `@mushi-mushi/web`                         |

## Troubleshooting

- **Wrong framework detected?** Pass `--framework <id>`. Valid: `next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla`.
- **Monorepo?** `cd` into the package first, or pass `--cwd apps/web`.
- **Stale `npx` cache?** `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive terminal (CI)?** Pass `--yes --project-id proj_xxx --api-key mushi_xxx`. The wizard exits with a clear error otherwise — it will not hang.
- **Node version too old?** Requires Node ≥ 18. Upgrade at [nodejs.org](https://nodejs.org/).
- **Want full stack traces on error?** `DEBUG=mushi npx mushi-mushi`.

## Security

- Credentials accepted via `--api-key` flag are visible to other users on the same machine via `ps -ef`. Use the interactive prompt on shared boxes.
- `~/.mushirc` (the CLI credentials cache) is written with mode `0o600` on Unix; the CLI will also tighten the permissions of any existing file on first load.
- The wizard rejects pasted secrets containing CR/LF/NUL to prevent `.env` injection.
- All prompts validate formats: `proj_[A-Za-z0-9_-]{10,}` and `mushi_[A-Za-z0-9_-]{10,}`.

## Other CLI commands

`mushi-mushi` only handles setup. For day-to-day commands install the full CLI:

```bash
npm i -g @mushi-mushi/cli
mushi reports list
mushi reports show <id>
mushi reports triage <id> --status acknowledged --severity high
mushi status
mushi deploy check
```

## Links

- 🌐 [Console](https://kensaur.us/mushi-mushi/) — view and triage reports
- 📦 [GitHub](https://github.com/kensaurus/mushi-mushi)
- 📚 [Docs](https://github.com/kensaurus/mushi-mushi#readme)
- 🐛 [Report a bug](https://github.com/kensaurus/mushi-mushi/issues)

## License

MIT
