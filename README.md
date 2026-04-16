# Mushi Mushi 虫虫

[![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=%40mushi-mushi%2Freact&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg)](https://typescriptlang.org)
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

### Backend ([BSL 1.1](./packages/server/LICENSE) → Apache 2.0 in 2029)

| Package | Purpose |
|---------|---------|
| `@mushi-mushi/server` | Supabase Edge Functions — 2-stage LLM pipeline, knowledge graph, enterprise features |
| `@mushi-mushi/agents` | Agentic fix pipeline — Claude Code, Codex, generic MCP adapters for auto-generating PRs |
| `@mushi-mushi/verify` | Playwright-based fix verification with screenshot visual diff |

---

## Connecting to the Backend

### Option A: Hosted (easiest)

1. Sign up at **[kensaur.us/mushi-mushi](https://kensaur.us/mushi-mushi/)** (the admin console)
2. Create a project → get your `projectId` and `apiKey`
3. Drop the SDK into your app (see Quick Start above)

### Option B: Self-hosted

**Docker Compose:**
```bash
cd deploy
cp .env.example .env   # fill in ANTHROPIC_API_KEY, Supabase credentials
docker compose up -d
```

**Kubernetes (Helm):**
```bash
helm install mushimushi deploy/helm/ \
  --set secrets.anthropicApiKey=sk-ant-...
```

### Option C: Supabase project

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

**For enterprise**
- SSO (SAML 2.0, OIDC)
- Audit logs
- Jira, Linear, GitHub Issues, PagerDuty integrations
- Plugin system for custom hooks
- Data retention policies
- Self-hosted deployment

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
  cli/             CLI tool
  mcp/             MCP server for coding agents
  server/          Supabase Edge Functions + migrations
  agents/          Agentic fix pipeline
  verify/          Fix verification
apps/
  admin/           Admin console (React + Tailwind)
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
