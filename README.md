<div align="center">

# Mushi Mushi 虫虫

**The user-friction intelligence layer that complements Sentry.**

Sentry sees what your code throws. Mushi sees what your users *feel*.

[![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=%40mushi-mushi%2Freact&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![CI](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml/badge.svg)](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/SDK-MIT-blue.svg)](./LICENSE)
[![Server](https://img.shields.io/badge/server-BSL%201.1-orange.svg)](./packages/server/LICENSE)
[![React 19](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev)
[![TypeScript 6](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://typescriptlang.org)
[![Vite 8](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev)
[![Node ≥22](https://img.shields.io/badge/Node-%E2%89%A522-339933.svg)](https://nodejs.org)
[![pnpm ≥10](https://img.shields.io/badge/pnpm-%E2%89%A510-f69220.svg)](https://pnpm.io)

[Quick start](#quick-start) · [Live admin demo](https://kensaur.us/mushi-mushi/) · [Docs](./apps/docs) · [Self-hosting](./SELF_HOSTED.md) · [Architecture](#architecture)

<a href="https://kensaur.us/mushi-mushi/">
  <img src="./docs/screenshots/report-detail-dark.png" alt="A real classified report inside Mushi Mushi: user description, captured console error, environment, triage thread, and a one-click Dispatch fix button" width="100%" />
</a>

</div>

---

## The gap Mushi Mushi closes

Your existing monitoring is excellent at one thing: **what your code threw**. It cannot see:

- A button that *looks* clickable but does nothing
- A checkout flow that confuses every new user
- A page that takes 12 seconds to load but never errors
- A layout that breaks on one specific Android phone
- A feature that silently regressed two deploys ago

These are **user-felt bugs**. They never trigger an alert. Users just leave.

Mushi Mushi is the missing layer. Drop a small SDK into your app — users press shake-to-report (or click a widget) and Mushi auto-captures screenshot, console, network, device, route, and intent. An LLM-native pipeline (Haiku fast-filter → Sonnet vision + RAG → judge → optional agentic auto-fix) classifies, deduplicates, and turns the friction into actionable bug intelligence — wired into Sentry, Slack, Jira, Linear, and PagerDuty.

| Scenario                              | Sentry / Datadog | **Mushi Mushi** |
| ------------------------------------- | :--------------: | :-------------: |
| Unhandled exception                   |        ✅        |        ✅        |
| Button doesn't respond                |        —         |        ✅        |
| Page loads in 12 s, no error          |        —         |        ✅        |
| User can't find the settings panel    |        —         |        ✅        |
| Layout breaks on iPad Safari          |        —         |        ✅        |
| Form submits but data doesn't save    |        ~         |        ✅        |
| Feature regressed since last deploy   |        ~         |        ✅        |

> Designed as a **companion** to your existing monitoring, not a replacement. Reports stream through to Sentry breadcrumbs and link back to the offending session.

---

## Tour

<table width="100%">
<tr>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/dashboard-dark.png"><img src="./docs/screenshots/dashboard-dark.png" alt="Admin dashboard showing total/new/classified/dismissed counters" /></a>
    <p align="center"><b>Dashboard</b><br/>At-a-glance counters, severity histogram, weekly trend.</p>
  </td>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/reports-dark.png"><img src="./docs/screenshots/reports-dark.png" alt="Reports list filtered by status, category, severity" /></a>
    <p align="center"><b>Reports</b><br/>Triage queue with status / category / severity filters.</p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/graph-dark.png"><img src="./docs/screenshots/graph-dark.png" alt="Knowledge graph linking bug nodes to affected pages" /></a>
    <p align="center"><b>Knowledge graph</b><br/>Bug ↔ component ↔ page ↔ version, traversable in NL.</p>
  </td>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/health-dark.png"><img src="./docs/screenshots/health-dark.png" alt="System health: per-model LLM telemetry, fallback rate, latency p50/p95, cron job status" /></a>
    <p align="center"><b>System health</b><br/>Live LLM telemetry, fallback rate, latency p50/p95, cron status.</p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/marketplace-dark.png"><img src="./docs/screenshots/marketplace-dark.png" alt="Plugin marketplace with PagerDuty Escalation, Linear Sync, Zapier Bridge" /></a>
    <p align="center"><b>Plugin marketplace</b><br/>HMAC-signed webhooks. PagerDuty / Linear / Zapier ship in-tree.</p>
  </td>
  <td width="50%" valign="top">
    <a href="./docs/screenshots/compliance-dark.png"><img src="./docs/screenshots/compliance-dark.png" alt="Compliance dashboard: latest control evidence, data residency, retention policies, DSARs" /></a>
    <p align="center"><b>Compliance</b><br/>SOC 2 evidence pack, data residency pinning, DSAR workflow.</p>
  </td>
</tr>
</table>

---

## Seven capabilities, one platform

1. **User-side capture** — Shadow-DOM widget, screenshot, console + network rings, route + intent, offline queue, rage-click / error-spike / slow-page proactive triggers.
2. **LLM-native classification** — 2-stage pipeline (Haiku fast-filter → Sonnet deep + vision), structured outputs via `response_format`, prompt-cached system instructions, deterministic JSON.
3. **Knowledge graph + dedup** — Bug ↔ component ↔ page ↔ version edges in Postgres + pgvector. Auto-grouping kills duplicate noise.
4. **LLM-as-Judge self-improvement** — Weekly Sonnet judge scores classifier outputs; low-scoring runs feed a fine-tuning queue. OpenAI fallback when Anthropic is degraded.
5. **Agent-agnostic auto-fix** — Orchestrator with `validateResult` gating + GitHub PR creation. Sandbox provider abstraction (`local-noop` for tests, `e2b` for prod, `modal` / `cloudflare` scaffolded). True MCP client adapter (JSON-RPC 2.0 + SEP-1686 Tasks) so Claude Code, Codex, Cursor, or any future agent plugs in.
6. **Multi-repo coordinated PRs** — A bug spanning frontend + backend opens linked PRs (`fix_coordinations` table) so reviewers see the full surface.
7. **Enterprise scaffolding** — SSO config CRUD, audit log ingest, plugin marketplace with HMAC, region-pinned data residency, retention policies, DSAR workflow, Stripe metered billing.

---

## Quick start

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

That's it. Users now have a shake-to-report widget. Reports land in your admin console, classified within seconds.

<details>
<summary><b>Other frameworks</b> — Vue, Svelte, Angular, React Native, Vanilla JS, iOS, Android</summary>

#### Vue 3 / Nuxt
```ts
import { MushiPlugin } from '@mushi-mushi/vue'
app.use(MushiPlugin, { projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

#### Svelte / SvelteKit
```ts
import { initMushi } from '@mushi-mushi/svelte'
initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })

import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

#### Angular 17+
```ts
import { provideMushi } from '@mushi-mushi/angular'
bootstrapApplication(AppComponent, {
  providers: [provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })],
})
```

#### React Native / Expo
```tsx
import { MushiProvider } from '@mushi-mushi/react-native'
<MushiProvider projectId="proj_xxx" apiKey="mushi_xxx">
  <App />
</MushiProvider>
```

#### Vanilla JS / any framework
```ts
import { Mushi } from '@mushi-mushi/web'
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })
```

#### iOS (Swift Package Manager — early dev)
```swift
.package(url: "https://github.com/kensaurus/mushi-mushi.git", from: "0.1.0")

import Mushi
Mushi.configure(projectId: "proj_xxx", apiKey: "mushi_xxx")
```

#### Android (Maven — early dev)
```kotlin
dependencies {
  implementation("dev.mushimushi:mushi-android:0.1.0")
}

Mushi.init(context = this, config = MushiConfig(projectId = "proj_xxx", apiKey = "mushi_xxx"))
```

</details>

> Want a runnable example? Check [`examples/react-demo`](./examples/react-demo) — a minimal Vite + React app with test buttons for dead clicks, thrown errors, failed API calls, and console errors.

---

## Where the project is today

| Wave | Theme                                              | Status |
| :--: | -------------------------------------------------- | :----: |
|  A   | Capture, fast-filter, deep classification, dedup   |   ✅    |
|  B   | Knowledge graph, NL queries, weekly intelligence   |   ✅    |
|  C   | Vision air-gap, RAG codebase indexer, fix dispatch |   ✅    |
|  D   | Marketplace, Cloud + Stripe, multi-repo fixes, hardened LLM I/O | ✅ (v1.0.0 prepping) |

Released today: `v0.8.0`. Next: `v1.0.0` — see [HANDOVER.md](./HANDOVER.md) for the release checklist and the two deferred follow-ups (Node mirror of `sanitize.ts` and the demo video).

### Honest status — what works, what's still partial

| Area                 | Working                                                                                             | Still partial                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Classification       | Haiku fast-filter, Sonnet deep, **vision air-gap closed**, structured outputs, prompt-cached prompts | —                                                              |
| Judge / self-improve | Sonnet judge with **OpenAI fallback** wired                                                          | Auto-promotion of fine-tuning candidates to a training run     |
| Fix orchestrator     | Single + multi-repo, `validateResult` gating, GitHub PR creation, **MCP JSON-RPC 2.0** client       | First-party Claude Code / Codex adapters wait on vendor APIs   |
| Sandbox              | Provider abstraction; `local-noop` (tests) + `e2b` (prod-ready, deny-by-default egress)             | `modal` / `cloudflare` scaffolded but throw `PROVIDER_UNAVAILABLE` |
| Verify               | Screenshot diff via Playwright + pixelmatch                                                          | Step interpreter is proof-of-concept (nav + click only)        |
| Enterprise           | Plugin marketplace + HMAC, audit ingest, region pinning, retention CRUD, Stripe metering            | SSO is config CRUD only — no SAML/OIDC flow yet                |
| Streaming            | Fix-dispatch SSE (CVE-2026-29085-safe sanitization)                                                  | Classification reasoning still arrives whole, not token-stream |

The orchestrator **refuses to run `local-noop` in production** unless you explicitly set `MUSHI_ALLOW_LOCAL_SANDBOX=1`. Pick `e2b` (or implement the `SandboxProvider` interface yourself) before exposing autofix to production traffic.

---

## Architecture

```mermaid
flowchart LR
    subgraph App["Your app"]
        SDK["@mushi-mushi/{react,vue,svelte,angular,react-native,web}<br/>Shadow-DOM widget · screenshot · console · network · offline queue"]
    end

    subgraph Edge["Supabase Edge Functions (Deno + Hono)"]
        API["api"]
        FF["fast-filter<br/>Haiku"]
        CR["classify-report<br/>Sonnet + vision + RAG"]
        JB["judge-batch<br/>Sonnet (OpenAI fallback)"]
        IR["intelligence-report"]
        ORCH["fix-dispatch<br/>SSE"]
    end

    subgraph DB["Postgres + pgvector"]
        REP["reports"]
        KG["knowledge graph"]
        EVAL["judge_evals"]
        FIX["fix_attempts<br/>+ coordinations"]
    end

    subgraph Agents["@mushi-mushi/agents"]
        MO["MCP client (JSON-RPC 2.0)"]
        SBX["Sandbox: local-noop / e2b"]
        GH["GitHub PR creator"]
    end

    SDK -->|HTTPS| API
    API --> FF --> CR
    CR --> KG
    CR --> REP
    KG --> IR
    REP --> JB --> EVAL
    REP --> ORCH --> Agents
    Agents --> GH
```

See [`apps/docs/content/concepts/architecture.mdx`](./apps/docs/content/concepts/architecture.mdx) for the full pipeline.

---

## Packages

> Most developers only install **one** SDK package — it pulls in `core` and `web` automatically.

| Install                            | Framework               | What you get                                                                              |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `npm i @mushi-mushi/react`         | React / Next.js         | `<MushiProvider>`, `useMushi()`, `<MushiErrorBoundary>` — drop-in for any React app       |
| `npm i @mushi-mushi/vue`           | Vue 3 / Nuxt            | `MushiPlugin`, `useMushi()` composable, error handler (pair with `web` for the widget UI) |
| `npm i @mushi-mushi/svelte`        | Svelte / SvelteKit      | `initMushi()`, SvelteKit error hook (pair with `web` for the widget UI)                   |
| `npm i @mushi-mushi/angular`       | Angular 17+             | `provideMushi()`, `MushiService`, error handler (pair with `web` for the widget UI)       |
| `npm i @mushi-mushi/react-native`  | React Native / Expo     | Shake-to-report, bottom-sheet widget, navigation capture, offline queue                   |
| `npm i @mushi-mushi/web`           | Vanilla / any framework | Framework-agnostic SDK — Shadow-DOM widget, screenshot, console + network capture         |

[![@mushi-mushi/react](https://img.shields.io/npm/v/@mushi-mushi/react?label=react&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![@mushi-mushi/vue](https://img.shields.io/npm/v/@mushi-mushi/vue?label=vue&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/vue)
[![@mushi-mushi/svelte](https://img.shields.io/npm/v/@mushi-mushi/svelte?label=svelte&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/svelte)
[![@mushi-mushi/angular](https://img.shields.io/npm/v/@mushi-mushi/angular?label=angular&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/angular)
[![@mushi-mushi/react-native](https://img.shields.io/npm/v/@mushi-mushi/react-native?label=react-native&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react-native)
[![@mushi-mushi/web](https://img.shields.io/npm/v/@mushi-mushi/web?label=web&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/web)
[![@mushi-mushi/cli](https://img.shields.io/npm/v/@mushi-mushi/cli?label=cli&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/cli)
[![@mushi-mushi/mcp](https://img.shields.io/npm/v/@mushi-mushi/mcp?label=mcp&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/mcp)

<details>
<summary><b>Internal & native packages</b></summary>

| Package                               | Purpose                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`@mushi-mushi/core`](./packages/core) | Shared engine — types, API client, PII scrubber, offline queue, rate limiter, structured logger. Auto-installed.       |
| [`@mushi-mushi/cli`](./packages/cli)   | CLI for project setup, report listing, triage. `npm i -g @mushi-mushi/cli`                                              |
| [`@mushi-mushi/mcp`](./packages/mcp)   | MCP server — lets Cursor / Copilot / Claude read and triage bug reports                                                 |
| [`packages/ios`](./packages/ios)       | Native iOS SDK (Swift Package Manager) — early dev                                                                      |
| [`packages/android`](./packages/android) | Native Android SDK (Maven `dev.mushimushi:mushi-android`) — early dev                                                  |

</details>

<details>
<summary><b>Backend packages</b> (BSL 1.1 → Apache 2.0 in 2029)</summary>

| Package                | Purpose                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mushi-mushi/server`  | Edge functions — classification pipeline, knowledge graph, fix dispatch + SSE, RAG indexer, vision air-gap, judge with OpenAI fallback, plugin runtime |
| `@mushi-mushi/agents`  | Agentic fix orchestrator — `validateResult` gating, GitHub PR creation, sandbox abstraction, MCP JSON-RPC 2.0 client                                  |
| `@mushi-mushi/verify`  | Playwright fix verification — screenshot visual diff (proof-of-concept step interpreter)                                                              |

</details>

---

## Connecting to a backend

### A. Hosted (zero-config)

1. Sign up at **[kensaur.us/mushi-mushi](https://kensaur.us/mushi-mushi/)**
2. Create a project → copy your `projectId` and `apiKey`
3. Drop the SDK into your app

### B. Self-hosted

```bash
cd deploy
cp .env.example .env   # ANTHROPIC_API_KEY, Supabase creds
docker compose up -d
```

Or via Supabase CLI directly — see [SELF_HOSTED.md](./SELF_HOSTED.md). A Helm chart lives at `deploy/helm/` (incomplete — missing migrations ConfigMap).

> Internal edge functions (`judge-batch`, `intelligence-report`, `generate-synthetic`) authenticate via `SUPABASE_SERVICE_ROLE_KEY`. Never expose them with `--no-verify-jwt` in production. Only the public `api` function should face the internet.

---

## Monitoring & privacy (this repo's deployment)

The hosted instance reports to two Sentry projects under the [`sakuramoto`](https://sakuramoto.sentry.io) org:

| Project              | What it covers                                                                                                                              | DSN source                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `mushi-mushi-admin`  | Admin console: unhandled errors, React error boundaries, perf traces (10 % sample), errors-only Session Replay (`replaysOnErrorSampleRate: 1.0`, masked text + media) | `VITE_SENTRY_DSN` baked into the build      |
| `mushi-mushi-server` | All eight edge functions: unhandled exceptions + every `log.error()`/`log.fatal()` forwarded via `_shared/sentry.ts`                        | `SENTRY_DSN_SERVER` Supabase secret         |

Privacy & safety:

- `sendDefaultPii: false` on both — no IPs, cookies, or request bodies attached automatically.
- Token-like query params scrubbed in `beforeSend`. `Authorization`, `Cookie`, `*-api-key` headers redacted server-side.
- Sourcemaps uploaded by `@sentry/vite-plugin` during `pnpm build` and **deleted from `dist/` before the S3 sync** — the public bucket never serves them.
- Sentry data scrubbing strips token prefixes (`mushi_*`, `sntryu_*`, JWTs starting with `eyJ`, `ghp_*`, `npm_*`) on top of SDK-side redaction.

> **For SDK consumers and forks:** the published packages **do not initialize Sentry**. The bridge at [`packages/web/src/sentry.ts`](packages/web/src/sentry.ts) only *reads context from your existing Sentry instance* — it never sends data on its own. Self-hosted forks can leave the DSNs unset and the SDKs no-op cleanly.

---

<details>
<summary><b>Repo structure & dev commands</b></summary>

#### Development

```bash
git clone https://github.com/kensaurus/mushi-mushi.git
cd mushi-mushi
pnpm install
pnpm build
```

Requires Node.js ≥ 22 and pnpm ≥ 10.

| Command            |                                                              |
| ------------------ | ------------------------------------------------------------ |
| `pnpm dev`         | Run all dev servers (admin on `:6464`, docs, cloud)          |
| `pnpm build`       | Build all packages                                           |
| `pnpm test`        | Vitest                                                       |
| `pnpm typecheck`   | TypeScript checks                                            |
| `pnpm lint`        | Lint                                                         |
| `pnpm format`      | Prettier                                                     |
| `pnpm changeset`   | Create a changeset                                           |
| `pnpm release`     | Build + publish to npm                                       |

#### Admin console (zero-config)

```bash
cd apps/admin
pnpm dev    # → http://localhost:6464 — auto-connects to Mushi Cloud
```

To self-host with your own Supabase project, copy `apps/admin/.env.example` and fill in your URL + anon key.

#### Backend / edge functions

```bash
cp .env.example .env   # Supabase + LLM provider keys
cd packages/server/supabase
npx supabase db push
npx supabase functions deploy api --no-verify-jwt
```

#### Repo layout

```
packages/
  core, web, react, vue, svelte, angular, react-native   # SDKs (MIT)
  ios, android                                            # Native SDKs (early dev)
  cli, mcp                                                # Tooling
  server, agents, verify                                  # Backend (BSL 1.1)
  plugin-{sdk,zapier,linear,pagerduty}                    # Plugin marketplace
apps/
  admin    # React 19 + Tailwind 4 + Vite 8 (dark-only by design)
  docs     # Nextra v4 documentation site
  cloud    # Next.js 15 marketing landing + Stripe billing
examples/
  react-demo
deploy/    # Docker Compose + Helm chart
tooling/   # Shared ESLint + TypeScript configs
```

</details>

---

## Contributing

Issues and PRs welcome. To get started: `pnpm install && pnpm dev`. See individual package READMEs for package-specific setup, and [HANDOVER.md](./HANDOVER.md) for the current state of play.

## License

- **SDK packages** (core, web, react, vue, svelte, angular, react-native, cli, mcp): [MIT](./LICENSE)
- **Server, agents, verify**: [BSL 1.1](./packages/server/LICENSE) — converts to Apache 2.0 on April 15, 2029
