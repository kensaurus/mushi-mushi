# mushi-mushi (launcher)

Source: https://kensaur.us/mushi-mushi/docs/sdks/launcher

---
title: 'mushi-mushi (launcher)'
---

# `mushi-mushi` — the one-command launcher

`npx mushi-mushi` is the single entry point on npm: it auto-detects your
framework, picks the right `@mushi-mushi/*` SDK, writes
`MUSHI_PROJECT_ID` and `MUSHI_API_KEY` into `.env.local`, and prints the
snippet to paste into your app.

## Try it

```bash
npx mushi-mushi
```

Equivalent commands — all three run the same wizard from
[`@mushi-mushi/cli`](/sdks/cli):

```bash
npx mushi-mushi              # the launcher (this package)
npm create mushi-mushi       # via the npm-create convention
npx @mushi-mushi/cli init    # the scoped name
```

## What it detects

| Framework      | Detected from                                       |
| -------------- | --------------------------------------------------- |
| Next.js        | `next.config.*`, `app/` directory                   |
| Nuxt           | `nuxt.config.*`                                     |
| SvelteKit      | `svelte.config.*` + `@sveltejs/kit` dep             |
| Angular        | `angular.json`                                      |
| React (Vite)   | `vite.config.*` + `react` dep                       |
| Vue 3 (Vite)   | `vite.config.*` + `vue@^3` dep                      |
| Svelte (Vite)  | `vite.config.*` + `svelte` dep                      |
| Expo           | `app.json` + `expo` dep                             |
| React Native CLI | `react-native` dep without Expo                   |
| Capacitor      | `capacitor.config.*`                                |
| Vanilla        | fallback                                            |

The package manager is detected from the lockfile (`pnpm-lock.yaml`,
`yarn.lock`, `bun.lockb`, `package-lock.json`). Env-var prefixes are
chosen by framework: `NEXT_PUBLIC_…`, `NUXT_PUBLIC_…`, `VITE_…`,
`EXPO_PUBLIC_…`.

## Idempotent

Running the wizard a second time is safe:

- Existing `MUSHI_*` env vars are never overwritten.
- The snippet is reprinted, but no extra dependency installs run if the
  SDK is already present.
- A pre-flight check warns if `.env.local` isn't gitignored, so secrets
  don't accidentally end up in source control.

## When to use the launcher vs the CLI directly

Use **the launcher** when you want one URL to give a teammate
("`npx mushi-mushi` and you're done").

Use **`@mushi-mushi/cli`** directly if you want to run subcommands
beyond `init` — e.g. `mushi report list`, `mushi triage`, or the
`mushi migrate` migration helper.
