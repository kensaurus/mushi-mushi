# mushi-mushi (launcher)

Source: https://kensaur.us/mushi-mushi/docs/sdks/launcher

---
title: 'mushi-mushi (launcher)'
description: npx mushi-mushi detects your framework, installs the matching @mushi-mushi SDK, writes your project ID and API key to .env.local, and prints the snippet.
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

The wizard reads the dependencies in your `package.json` first, in this
order, and takes the first match:

| Framework (`--framework` id) | Detected from |
| --- | --- |
| Next.js (`next`) | `next` dependency |
| Nuxt (`nuxt`) | `nuxt` dependency |
| SvelteKit (`sveltekit`) | `@sveltejs/kit` dependency |
| Angular (`angular`) | `@angular/core` dependency |
| Expo (`expo`) | `expo` dependency |
| React Native (`react-native`) | `react-native` dependency without Expo |
| Remix (`remix`) | `@remix-run/react`, `@remix-run/node` or `@remix-run/serve` |
| Astro (`astro`) | `astro` dependency |
| Solid (`solid`) | `solid-js` or `@solidjs/start` |
| Capacitor (`capacitor`) | `@capacitor/core` (with `react` it is treated as React) |
| Svelte (`svelte`) | `svelte` dependency |
| Vue (`vue`) | `vue` dependency |
| Create React App (`cra`) | `react-scripts` dependency |
| React (`react`) | `react` dependency |
| Express, Fastify, Hono (`express`, `fastify`, `hono`) | the server framework's dependency |
| Vanilla (`vanilla`) | fallback |

With no matching dependency it falls back to config files
(`next.config.*`, `nuxt.config.*`, `svelte.config.js`, `angular.json`,
`remix.config.*`, `astro.config.*`). Pass `--framework ` to skip
detection.

The package manager is detected from the lockfile (`bun.lockb` or
`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`). Env-var
prefixes are chosen by framework: `NEXT_PUBLIC_…`, `NUXT_PUBLIC_…`,
`EXPO_PUBLIC_…`, `REACT_APP_…` (Create React App), `PUBLIC_…` (Astro) and
`VITE_…` for the other browser frameworks. Server frameworks, bare React
Native and Remix get plain `MUSHI_…` names.

## Idempotent

Running the wizard a second time is safe:

- Existing `MUSHI_*` env vars are never overwritten.
- The snippet is reprinted, but no extra dependency installs run if the
  SDK is already present.
- A pre-flight check warns if `.env.local` isn't gitignored, so secrets
  don't accidentally end up in source control.

## When to use the launcher vs the CLI directly

Use **the launcher** when you want one command to give a teammate
("`npx mushi-mushi` and you're done"). Any other command is forwarded to
`@mushi-mushi/cli`, so `npx mushi-mushi setup --ide cursor` or
`npx mushi-mushi reports list` works without a global install.

Install **`@mushi-mushi/cli`** globally (`npm install -g @mushi-mushi/cli`)
when you use it every day and want the short `mushi` command — e.g.
`mushi reports list`, `mushi reports triage `, or the `mushi migrate`
migration helper.
