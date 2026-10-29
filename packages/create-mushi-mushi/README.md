# create-mushi-mushi

> **Your AI wrote it. Mushi tells you why it broke.**

Adds [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) to the app you
already have, so when a user says something is broken you get the likely cause
in plain English and a fix prompt for your AI editor. One command finds your
framework, installs the right SDK and writes your keys. It can also start a
small Vue, Svelte or Node app with Mushi Mushi already in it (`--template`).

You need Node.js 20 or newer and a free Mushi Mushi account (the wizard opens
a browser sign-in).

```bash
npm create mushi-mushi
# or
pnpm create mushi-mushi
yarn create mushi-mushi
bun create mushi-mushi
```

Docs: [the setup wizard](https://kensaur.us/mushi-mushi/docs/sdks/launcher) (same wizard as `npx mushi-mushi`)

## What it does

1. **Finds your framework:** Next.js, React (Vite or Create React App), Remix, Astro, Solid, Vue, Nuxt, Svelte, SvelteKit, Angular, Expo, React Native, Capacitor, Express, Fastify, Hono, or plain JavaScript.
2. **Picks the right SDK:** `@mushi-mushi/react`, `@mushi-mushi/vue`, `@mushi-mushi/svelte`, `@mushi-mushi/angular`, `@mushi-mushi/react-native`, `@mushi-mushi/capacitor` or `@mushi-mushi/web` for apps, and `@mushi-mushi/node` for Express, Fastify and Hono servers.
3. **Uses your package manager:** `npm`, `pnpm`, `yarn` or `bun`, based on your lockfile.
4. **Writes your keys:** into `.env.local` (or your existing `.env`), with the prefix your framework needs, for example `VITE_MUSHI_PROJECT_ID` or `NEXT_PUBLIC_MUSHI_API_KEY`. Servers, Remix and bare React Native get plain `MUSHI_PROJECT_ID` and `MUSHI_API_KEY`.
5. **Checks `.gitignore`:** warns you if that env file is not ignored, so you don't commit it.
6. **Prints the setup code** for your framework, ready to paste.
7. **Offers to send a test report** at the end, so you see your first diagnosed bug right away.

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
npm create mushi-mushi -- --project-id <project-uuid> --api-key mushi_xxx
npm create mushi-mushi -- --skip-install
npm create mushi-mushi -- --skip-test-report
npm create mushi-mushi -- --audit          # health-check an existing install instead
npm create mushi-mushi -- --cwd apps/web
npm create mushi-mushi -- --endpoint https://mushi.your-company.com
npm create mushi-mushi -- --template vue [dir]
npm create mushi-mushi -- -y
npm create mushi-mushi -- --version
npm create mushi-mushi -- --help
```

> `npm create` and `pnpm create` need the `--` separator before flags. Yarn 1 and Bun do not.

## Equivalent commands

```bash
npx mushi-mushi               # shorter
npx @mushi-mushi/cli init     # scoped name
```

## Troubleshooting

- **Wrong framework detected?** Pass `--framework <id>` explicitly. Valid IDs: `next, react, cra, remix, astro, solid, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, express, fastify, hono, vanilla`.
- **Running in a monorepo?** `cd` into the package you want Mushi in first, or pass `--cwd apps/web`.
- **`npx` cache serving an old version?** Run `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive shell (CI, or an AI agent's terminal)?** Pass `--yes`. The wizard then prints the sign-in URL (no browser opens) and picks the project by your app's name. On CI with no one to sign in, also pass `--project-id` and `--api-key`.
- **Key pasted with quotes/whitespace?** The wizard strips them, then checks the format: the API key starts with `mushi_` or `mush_pk_` followed by 10 or more characters, and the project ID is a UUID (or `proj_` followed by 10 or more characters).

## Security

- Credentials accepted via `--api-key` flag leak into `ps -ef`. Prefer the interactive prompt on dev machines; on CI, pass them via the environment and an explicit `--api-key "$MUSHI_API_KEY"` at the boundary.
- The `~/.config/mushi/config.json` credentials cache is written with mode `0o600` (owner read/write only) on Unix. Legacy `~/.mushirc` auto-migrates on first load.
- All env-file writes strip CR/LF/NUL from secrets to prevent accidental `.env` injection.

## Links

- [Console](https://kensaur.us/mushi-mushi/)
- [GitHub](https://github.com/kensaurus/mushi-mushi)
- [Docs](https://kensaur.us/mushi-mushi/docs/sdks/launcher)
- [Report a bug](https://github.com/kensaurus/mushi-mushi/issues)

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
