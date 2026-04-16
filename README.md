# Mushi Mushi 虫虫

[![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=%40mushi-mushi%2Freact&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://typescriptlang.org)
[![CI](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml/badge.svg)](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/kensaurus/mushi-mushi/issues)

> **User-felt bug intelligence.** The bugs your monitoring misses — caught, classified, and fixed.

---

## What is this?

Monitoring tools catch crashes. But they can't see:

- A button that *looks* clickable but does nothing
- A checkout flow that confuses every new user
- A page that takes 12 seconds to load but never errors
- A layout that breaks on one specific Android phone

**These are user-felt bugs.** They don't trigger alerts. Users just leave.

Mushi Mushi is a small SDK you drop into your app. Users shake their phone (or click a button) to report friction. The SDK captures everything — screenshot, console logs, network requests, device info — and an AI pipeline classifies, deduplicates, and triages the report. Optionally, coding agents can auto-generate fix PRs.

---

## User Journey

```
                    ┌──────────────────────┐
                    │   User feels friction │
                    │   "this button broke" │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Shakes phone / clicks│
                    │  the report button    │
                    └──────────┬───────────┘
                               │
              ┌────────────────▼────────────────┐
              │         SDK auto-captures:       │
              │  screenshot · console · network  │
              │  device info · user description  │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │     Stage 1: Fast Filter         │
              │  Haiku extracts key facts,       │
              │  blocks spam, detects regressions │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │     Stage 2: Deep Analysis       │
              │  Sonnet classifies severity,     │
              │  reads screenshot via vision,    │
              │  pulls code context via RAG      │
              └────────────────┬────────────────┘
                               │
         ┌─────────────────────▼─────────────────────┐
         │    Knowledge Graph + Dedup + Ontology      │
         │  Groups related bugs · Tracks regressions  │
         │  Natural language queries across all data   │
         └─────────────────────┬─────────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │        Admin Dashboard           │
              │  + Slack / Jira / Linear / PD    │
              │  + optional agentic auto-fix     │
              └─────────────────────────────────┘
```

---

## Quick Start

### React

```bash
npm install @mushi-mushi/react
```

```tsx
import { MushiProvider } from '@mushi-mushi/react'

function App() {
  return (
    <MushiProvider config={{ projectId: 'proj_xxx', apiKey: 'mushi_xxx' }}>
      <YourApp />
    </MushiProvider>
  )
}
```

### Other Frameworks

<details>
<summary><b>Vue 3</b> (API-only — add <code>@mushi-mushi/web</code> for widget UI)</summary>

```ts
// Error capture + API reporting (no widget)
import { MushiPlugin } from '@mushi-mushi/vue'
app.use(MushiPlugin, { projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

// To also get the widget UI, add @mushi-mushi/web:
import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```
</details>

<details>
<summary><b>Svelte / SvelteKit</b> (API-only — add <code>@mushi-mushi/web</code> for widget UI)</summary>

```ts
// Error capture + API reporting (no widget)
import { initMushi } from '@mushi-mushi/svelte'
initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

// To also get the widget UI, add @mushi-mushi/web:
import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```
</details>

<details>
<summary><b>Angular</b> (API-only — add <code>@mushi-mushi/web</code> for widget UI)</summary>

```ts
// Error capture + API reporting (no widget)
import { provideMushi } from '@mushi-mushi/angular'
bootstrapApplication(AppComponent, {
  providers: [provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })]
})

// To also get the widget UI, add @mushi-mushi/web:
import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```
</details>

<details>
<summary><b>React Native</b></summary>

```tsx
import { MushiProvider } from '@mushi-mushi/react-native'
<MushiProvider projectId="proj_xxx" apiKey="mushi_xxx">
  <App />
</MushiProvider>
```
</details>

<details>
<summary><b>Vanilla JS / any framework</b></summary>

```ts
import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```
</details>

<details>
<summary><b>iOS</b> (Swift Package Manager — early development, API may change)</summary>

```swift
// Package.swift
.package(url: "https://github.com/kensaurus/mushi-mushi.git", from: "0.1.0")

// In your app
import Mushi
Mushi.configure(projectId: "proj_xxx", apiKey: "mushi_xxx")
```
See [`packages/ios`](./packages/ios) for full setup.
</details>

<details>
<summary><b>Android</b> (Maven — early development, API may change)</summary>

```kotlin
// build.gradle.kts
dependencies {
    implementation("dev.mushimushi:mushi-android:0.1.0")
}

// In your Application class
Mushi.init(context = this, config = MushiConfig(projectId = "proj_xxx", apiKey = "mushi_xxx"))
```
See [`packages/android`](./packages/android) for full setup.
</details>

> Want a runnable example? Check [`examples/react-demo`](./examples/react-demo) — a minimal Vite + React app with test buttons for dead clicks, thrown errors, failed API calls, and console errors.

---

## What it catches vs. traditional monitoring

| Scenario | Sentry/Datadog | Mushi Mushi |
|----------|:-:|:-:|
| Button doesn't respond | - | ✓ |
| Page loads in 12s, no error | - | ✓ |
| User can't find settings | - | ✓ |
| Layout breaks on iPad Safari | - | ✓ |
| Form submits but data doesn't save | ~ | ✓ |
| Feature regressed since last deploy | ~ | ✓ |
| Unhandled exception | ✓ | ✓ |

Mushi Mushi is designed as a **companion** to your existing monitoring, not a replacement.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Your App                            │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │  react   │ │   vue    │ │  svelte  │ │    angular    │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘   │
│       └─────────┬──┴────────────┘               │            │
│            ┌────▼─────┐                         │            │
│            │   web    │◄────────────────────────┘            │
│            │ (widget) │  Shadow DOM widget + capture         │
│            └────┬─────┘                                      │
│            ┌────▼─────┐                                      │
│            │   core   │  Types, API client, offline queue    │
│            └────┬─────┘                                      │
└─────────────────┼────────────────────────────────────────────┘
                  │ HTTPS
┌─────────────────▼────────────────────────────────────────────┐
│              Supabase Edge Functions                         │
│                                                              │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │   API     │  │ fast-filter  │  │  classify-report      │ │
│  │  (Hono)   │  │  (Haiku)     │  │  (Sonnet + Vision)    │ │
│  └───────────┘  └──────────────┘  └───────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Knowledge Graph · RAG · NL Queries · Dedup · Ontology  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  judge-batch  │  │  gen-synth   │  │ intel-report      │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│                                                              │
│                    PostgreSQL (Supabase)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Packages

### Pick the SDK for your framework

> **Most developers only need one package.** Install the one that matches your framework — it pulls in `core` and `web` automatically.

| Install | Framework | What you get | npm |
|---------|-----------|-------------|-----|
| `npm i @mushi-mushi/react` | **React / Next.js** | `<MushiProvider>`, `useMushi()` hook, `<MushiErrorBoundary>` — drop-in for any React app | [![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react) |
| `npm i @mushi-mushi/vue` | **Vue 3 / Nuxt** | `MushiPlugin` for `app.use()`, `useMushi()` composable, error handler — API-only (no widget UI, use `@mushi-mushi/web` for the widget) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/vue?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/vue) |
| `npm i @mushi-mushi/svelte` | **Svelte / SvelteKit** | `initMushi()`, SvelteKit error hook, report submission — API-only (no widget UI, use `@mushi-mushi/web` for the widget) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/svelte?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/svelte) |
| `npm i @mushi-mushi/angular` | **Angular 17+** | `provideMushi()` factory, injectable `MushiService`, error handler — API-only (no widget UI, use `@mushi-mushi/web` for the widget) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/angular?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/angular) |
| `npm i @mushi-mushi/react-native` | **React Native / Expo** | Shake-to-report, bottom sheet widget, navigation capture, offline queue | [![npm](https://img.shields.io/npm/v/@mushi-mushi/react-native?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react-native) |
| `npm i @mushi-mushi/web` | **Vanilla JS / any framework** | Framework-agnostic browser SDK — Shadow DOM widget, screenshot, console/network capture | [![npm](https://img.shields.io/npm/v/@mushi-mushi/web?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/web) |

### Internal packages (you probably don't need these directly)

| Package | npm | Purpose |
|---------|-----|---------|
| [`@mushi-mushi/core`](./packages/core) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/core?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/core) | Shared engine — types, API client, PII scrubber, offline queue, rate limiter, structured logger. Auto-installed as a dependency. |
| [`@mushi-mushi/cli`](./packages/cli) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/cli?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/cli) | CLI for project setup, report listing, and triage. Install globally: `npm i -g @mushi-mushi/cli` |
| [`@mushi-mushi/mcp`](./packages/mcp) | [![npm](https://img.shields.io/npm/v/@mushi-mushi/mcp?label=&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/mcp) | MCP server — lets AI coding agents (Cursor, Copilot, Claude) read and triage bug reports |

### Native mobile SDKs (early development)

| Package | Distribution | Status |
|---------|--------------|--------|
| [`packages/ios`](./packages/ios) | Swift Package Manager | Early development — API may change |
| [`packages/android`](./packages/android) | Maven (`dev.mushimushi:mushi-android`) | Early development — API may change |

### Backend ([BSL 1.1](./packages/server/LICENSE) → Apache 2.0 in 2029)

| Package | Purpose | Status |
|---------|---------|--------|
| `@mushi-mushi/server` | Supabase Edge Functions — 2-stage LLM classification pipeline, knowledge graph, enterprise scaffolding | Working classification pipeline; fix execution requires external agent |
| `@mushi-mushi/agents` | Agentic fix pipeline — orchestrator + GitHub PR creation work; Claude Code and Codex adapters are **stubs** (awaiting API access); generic MCP adapter works with external server | Partial |
| `@mushi-mushi/verify` | Playwright-based fix verification — screenshot visual diff works; step interpreter is proof-of-concept | Proof-of-concept |

---

## Connecting to the Backend

### Option A: Hosted

1. Sign up at **[kensaur.us/mushi-mushi](https://kensaur.us/mushi-mushi/)** (the admin console)
2. Create a project → get your `projectId` and `apiKey`
3. Drop the SDK into your app (see Quick Start above)

### Option B: Self-hosted

> See [SELF_HOSTED.md](./SELF_HOSTED.md) for the recommended Supabase CLI deployment.
>
> **Security note:** Internal edge functions (`judge-batch`, `intelligence-report`, `generate-synthetic`) authenticate via the `SUPABASE_SERVICE_ROLE_KEY`. Never expose these functions without `--no-verify-jwt` in production. Only the public `api` function should be exposed to the internet; the others should be invoked server-side via cron or admin tooling with the service role key.

### Option C: Docker Compose

```bash
cd deploy
cp .env.example .env   # fill in ANTHROPIC_API_KEY, Supabase credentials
docker compose up -d
```

**Kubernetes (Helm):** *(incomplete — missing ConfigMap for migrations)*
```bash
helm install mushimushi deploy/helm/ \
  --set secrets.anthropicApiKey=sk-ant-...
```

### Option D: Supabase project (manual)

```bash
cd packages/server/supabase
npx supabase db push                              # run migrations
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy api --no-verify-jwt
npx supabase functions deploy fast-filter --no-verify-jwt
npx supabase functions deploy classify-report --no-verify-jwt
```

Then point the SDK to your Supabase function URL:

```ts
MushiProvider config={{
  projectId: 'proj_xxx',
  apiKey: 'mushi_xxx',
  apiEndpoint: 'https://your-project.supabase.co/functions/v1/api'
}}
```

---

## Key Features

**For developers**
- Shadow DOM widget (won't break your CSS)
- Screenshot with user annotations
- Console + network log capture
- Offline queue (syncs when back online)
- Proactive triggers: rage click, error spike, slow page detection

**For teams**
- 2-stage LLM classification (fast filter → deep analysis)
- Knowledge graph linking bugs ↔ components ↔ pages ↔ versions
- Auto-dedup and grouping
- Natural language queries ("critical checkout bugs this week")
- Weekly intelligence reports

**For enterprise** *(schema + API scaffolding — not yet production-ready)*
- SSO (SAML 2.0, OIDC) — config CRUD only, no OAuth/SAML flow
- Audit logs — event recording works, no UI dashboard yet
- Jira, Linear, GitHub Issues, PagerDuty integrations — webhook dispatch only, no bidirectional sync
- Plugin system for custom hooks — registration + execution order, limited hook points
- Data retention policies — configurable per-project, archival cron not yet implemented
- Self-hosted deployment — see [SELF_HOSTED.md](./SELF_HOSTED.md)

---

## Known Limitations

**Screenshot capture** uses canvas/SVG `foreignObject` serialization. This approach does not work with cross-origin iframes, tainted `<canvas>` elements, or pages with strict Content Security Policies. Consider it best-effort — it works well on most single-origin SPAs but will produce incomplete captures on pages with third-party embeds.

**Streaming LLM reasoning** is not yet implemented. The admin console shows classification results after completion, not in real-time. All API calls are request/response.

**Enterprise features** (SSO, audit logs, integrations, plugins) have schema and API scaffolding but are not production-ready. SSO stores config but does not implement OAuth/SAML flows. Audit logs record events but have no dedicated query UI. Integrations are webhook-dispatch only (no bidirectional sync). Built-in plugins are stub implementations.

**Fix verification** (`@mushi-mushi/verify`) performs screenshot visual diff via Playwright and pixelmatch, but the reproduction step interpreter is a proof-of-concept — it handles navigation and click steps but skips most type/fill interactions.

**Fix agent sandbox** (`packages/agents/src/sandbox.ts`) generates a security spec document describing the intended container constraints (gVisor, network isolation, resource limits). It does **not** enforce these constraints at runtime. The fix agent runs with the permissions of the host process. Implement your own container isolation if deploying fix agents in production.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| SDKs | TypeScript, tsup (dual ESM/CJS), tree-shakeable |
| Backend | Supabase Edge Functions (Deno), Hono |
| AI | Claude Haiku (fast filter), Claude Sonnet (deep analysis + vision) |
| Database | PostgreSQL via Supabase, pgvector for embeddings |
| Admin UI | React 19, Tailwind CSS, Vite |
| Monorepo | pnpm workspaces, Turborepo, Changesets |
| CI/CD | GitHub Actions |
| Deploy | Docker Compose, Helm chart, or Supabase hosted |

---

## Development

```bash
git clone https://github.com/kensaurus/mushi-mushi.git
cd mushi-mushi
pnpm install
pnpm build
```

### Admin Console

The admin console works out of the box — no `.env` needed. It auto-connects to Mushi Mushi Cloud:

```bash
cd apps/admin
pnpm dev    # → http://localhost:6464 — sign up and start using
```

To self-host with your own Supabase project, copy `.env.example` and fill in your credentials:

```bash
cp apps/admin/.env.example apps/admin/.env   # fill in your Supabase URL + anon key
```

### Backend / Edge Functions

For backend development, copy the root `.env.example` and fill in API keys:

```bash
cp .env.example .env   # fill in Supabase + LLM provider keys
```

Requires Node.js >= 22 and pnpm >= 10.

| Command | |
|---------|---|
| `pnpm build` | Build all packages |
| `pnpm test` | Run tests (Vitest) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm lint` | Lint |
| `pnpm format` | Format with Prettier |
| `pnpm changeset` | Create a changeset for versioning |
| `pnpm release` | Build + publish to npm |

### Project structure

```
packages/
  core/            Shared types, API client, offline queue
  web/             Browser SDK — widget, screenshot, capture
  react/           React Provider + hooks + ErrorBoundary
  react-native/    React Native SDK
  vue/             Vue 3 plugin
  svelte/          Svelte SDK
  angular/         Angular SDK
  ios/             Native iOS SDK (Swift, early dev)
  android/         Native Android SDK (Kotlin, early dev)
  cli/             CLI tool
  mcp/             MCP server for coding agents
  server/          Supabase Edge Functions + migrations
  agents/          Agentic fix pipeline
  verify/          Fix verification
apps/
  admin/           Admin console (React + Tailwind)
  docs/            Documentation site (stub — coming soon)
examples/
  react-demo/      Runnable Vite + React demo app
deploy/            Docker Compose + Helm chart
tooling/           Shared ESLint + TypeScript configs
```

---

## Contributing

Issues and PRs welcome. To get started:

```bash
pnpm install && pnpm dev
```

See individual package READMEs for package-specific setup.

---

## License

- **SDK packages** (core, web, react, vue, svelte, angular, react-native, cli, mcp): [MIT](./LICENSE)
- **Server, agents, verify**: [BSL 1.1](./packages/server/LICENSE) — converts to Apache 2.0 on April 15, 2029
