---
"@mushi-mushi/cli": minor
"mushi-mushi": minor
"create-mushi-mushi": minor
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
"@mushi-mushi/react": patch
"@mushi-mushi/vue": patch
"@mushi-mushi/svelte": patch
"@mushi-mushi/angular": patch
"@mushi-mushi/react-native": patch
"@mushi-mushi/capacitor": patch
"@mushi-mushi/mcp": patch
"@mushi-mushi/plugin-sdk": patch
"@mushi-mushi/plugin-zapier": patch
"@mushi-mushi/plugin-linear": patch
"@mushi-mushi/plugin-pagerduty": patch
"@mushi-mushi/plugin-sentry": patch
"@mushi-mushi/wasm-classifier": patch
---

**One-command setup wizard + npm discoverability sweep.**

- **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
- **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
- **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
- **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
- **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
- **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.
