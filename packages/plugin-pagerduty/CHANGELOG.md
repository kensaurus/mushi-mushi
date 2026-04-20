# @mushi-mushi/plugin-pagerduty

## 0.2.1

### Patch Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

- Updated dependencies [fc5c58e]
  - @mushi-mushi/plugin-sdk@0.2.1

## 0.2.0

### Minor Changes

- 7567cee: Plugin marketplace — initial public release.
  - **@mushi-mushi/plugin-sdk**: framework-agnostic plugin runtime with HMAC signature verification, replay protection (delivery-ID dedup), in-memory dedup store, and Express + Hono middleware adapters. Plugin authors register one async function per event name (or a wildcard `'*'` handler) and the SDK handles signature checks, JSON parsing, timeouts, and structured error responses.
  - **@mushi-mushi/plugin-linear**: official Linear adapter — turns `report.created` events into Linear issues with project + label routing.
  - **@mushi-mushi/plugin-pagerduty**: official PagerDuty adapter — escalates `report.dedup_grouped` and severity-tagged events into incidents on the configured service.
  - **@mushi-mushi/plugin-zapier**: official Zapier adapter — exposes Mushi events as a Zapier-compatible webhook source so non-engineers can route reports anywhere Zapier reaches.

### Patch Changes

- Updated dependencies [7567cee]
  - @mushi-mushi/plugin-sdk@0.2.0
