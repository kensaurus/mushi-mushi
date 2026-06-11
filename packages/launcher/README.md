<div align="center">

# mushi-mushi 🐛

**Ship a shake-to-report button. Get AI-classified, deduped, ready-to-fix bug reports.**

One `npx` command. Works with React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular, React Native, Expo, Capacitor, and vanilla JS.

[![npm](https://img.shields.io/npm/v/mushi-mushi?color=cb3837&label=mushi-mushi)](https://www.npmjs.com/package/mushi-mushi)
[![npm downloads](https://img.shields.io/npm/dm/mushi-mushi?color=cb3837&label=downloads)](https://www.npmjs.com/package/mushi-mushi)
[![License](https://img.shields.io/npm/l/mushi-mushi?color=blue)](https://github.com/kensaurus/mushi-mushi/blob/master/LICENSE)
[![Provenance](https://img.shields.io/badge/npm-provenance-8957e5?logo=npm)](https://docs.npmjs.com/generating-provenance-statements)
[![Socket](https://socket.dev/api/badge/npm/package/mushi-mushi)](https://socket.dev/npm/package/mushi-mushi)
[![Node](https://img.shields.io/node/v/mushi-mushi?color=339933&logo=node.js)](https://nodejs.org)

<a href="https://kensaur.us/mushi-mushi/" title="Open the live admin demo">
  <img src="https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/docs/screenshots/report-detail-dark.png" alt="A real user-felt bug inside the Mushi admin — Plan / Do / Check / Act PDCA receipt across the top, the original user description, LLM classification (Confusing UX · Medium · 78% confidence · component = Dashboard/HeroCTA), environment + performance metrics, and a one-click Dispatch-fix CTA." width="860" />
</a>

<sub>↑ a real user report, fully classified and ready to dispatch as a GitHub PR · <a href="https://kensaur.us/mushi-mushi/">open the live demo</a></sub>

</div>

---

## What does it actually do? (60 seconds, no jargon)

Your users open your app, something feels broken — a button that doesn't react, a page that takes forever, a layout that folds in half on their phone — and they leave. Your error tracker stays silent because nothing technically _crashed_.

Mushi adds a small **"shake your phone (or click the bug)"** button. The user taps it, scribbles a note, and Mushi captures everything around the moment: a screenshot, the page they were on, what they were trying to do, and the last few seconds of network and console activity. An AI then reads that report, tags it with severity and category in plain English, groups it with similar reports so you see one row per actual bug, and (optionally) hands it off to another AI that opens a draft pull request with a proposed fix. **A human always reviews and merges** — the loop never bypasses you.

Founders, PMs, designers: see the [60-second tour in the GitHub README](https://github.com/kensaurus/mushi-mushi#read-this-first-if-youre-not-a-developer).

---

## Install in one line

```bash
npx mushi-mushi
```

The wizard detects your framework, installs the right SDK, writes env vars to `.env.local` (with the right prefix — `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, or `VITE_`), and prints the snippet to paste into your app. **Non-destructive**: never overwrites existing env vars, never edits your source.

```tsx
// After the wizard runs (React example):
import { MushiProvider } from '@mushi-mushi/react';

export function App({ children }) {
  return (
    <MushiProvider config={{ projectId: 'proj_xxx', apiKey: 'mushi_xxx' }}>
      {children}
    </MushiProvider>
  );
}
```

That's it. Your users now have a shake-to-report button (or a floating widget). Reports land in [your admin console](https://kensaur.us/mushi-mushi/), classified by an LLM within seconds.

---

## What you get

- **Shake-to-report widget** — Shadow-DOM, zero CSS conflicts. Ships with screenshot, console ring, network ring, route + intent capture, and an offline queue.
- **AI-classified reports** — 2-stage pipeline (Haiku fast-filter → Sonnet deep + vision + RAG) tags each report with category, severity, confidence, and the component path. Stage 2 streams partial results to the admin UI as tokens arrive.
- **Dedup by meaning, not by string** — pgvector knowledge graph collapses duplicate reports across users, routes, and deploys so your queue isn't a noise storm.
- **Bidirectional inventory (v2)** — opt in to `capture: { discoverInventory: true }` and the SDK quietly observes routes, `data-testid`s, and outbound API paths in production. Claude drafts an `inventory.yaml` of user stories + pages + actions for you to accept — most teams will never hand-author one.
- **Five pre-release gates (v2)** — `mushi-mushi/no-dead-handler`, `mushi-mushi/no-mock-leak`, inventory drift, agentic-failure detection, synthetic walk health. One composite GitHub status check via the [Mushi Mushi CI Gate Action](https://github.com/kensaurus/mushi-mushi/tree/master/packages/mcp-ci).
- **Spec-traced fixes (v2.10)** — every dispatched fix carries the inventory `Action` it's meant to repair, the `expected_outcome` contract is rendered into the LLM prompt, a deterministic `validateAgainstSpec` gate fires before the PR opens, and a targeted synthetic probe runs the moment the PR lands.
- **One-click "Dispatch fix"** — agentic orchestrator opens a GitHub PR with a screenshot diff and a Playwright replay. Sandbox-pluggable (`e2b`, `modal`, `cloudflare`, or your own).
- **Standards-first integrator** — W3C `traceparent` end-to-end, Standard Webhooks signing on every outbound delivery, RFC-draft `Idempotency-Key` middleware, OAuth 2.0 Dynamic Client Registration, OTLP/HTTP+JSON BYOK exporter. You bring your own observability stack — Mushi never marks up tokens.
- **Agent-native via MCP + A2A** — MCP Streamable HTTP at `/functions/v1/mcp`, A2A v1.0.0 tasks at `/v1/a2a/tasks` (pull SSE _and_ push notifications), Agent Card discovery, OpenAPI 3.1 spec. Cursor, Claude Code, Copilot, OpenAI Agents SDK, LangGraph, CrewAI all see the same surface.

---

## Who it's for

| You are…                                            | …and this helps because                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A solo dev / small team** shipping a consumer app | You already have Sentry for crashes — but users drop off over _friction_, not exceptions. Mushi captures "this button doesn't do anything". |
| **A PM or designer** living in the admin            | Triage, severity, component ownership, and PR status — all in one dark-mode console. No reading stack traces.                               |
| **An AI-native team** already using Cursor / Claude | MCP tools expose the whole loop to your agent. `get_recent_reports`, `classify`, `dispatch_fix` — the same primitives your teammates use.   |
| **An enterprise** needing SOC 2 + residency         | Region-pinned data (US / EU / JP / SELF), SAML SSO, audit-log ingest, DSAR workflow, HMAC-signed plugin webhooks.                           |

---

## Mushi vs your existing stack

Mushi is a **companion** to Sentry/Datadog, not a replacement. It sees the bugs your crash tracker can't.

| Scenario                                | Sentry / Datadog | **Mushi Mushi** |
| --------------------------------------- | :--------------: | :-------------: |
| Unhandled JS exception                  |        ✅        |       ✅        |
| Button that _looks_ clickable but isn't |        —         |       ✅        |
| 12-second page load, no error thrown    |        —         |       ✅        |
| User can't find the settings panel      |        —         |       ✅        |
| Layout broken on iPad Safari only       |        —         |       ✅        |
| Form submits but data doesn't save      |        ~         |       ✅        |
| Feature silently regressed last deploy  |        ~         |       ✅        |
| LLM-classified + deduped queue          |        —         |       ✅        |
| One-click AI fix → draft GitHub PR      |        —         |       ✅        |

> Already have Sentry? Mushi writes breadcrumbs into your existing Sentry session so you can jump from a crash to the user's own words in one click.

---

## Integrates with

**13 outbound plugins** — Mushi sends signals to whatever your team already lives in:

<table>
  <tr>
    <td align="center" width="110"><b>GitHub</b><br/><sub>Auto-draft PRs<br/>+ Checks API</sub></td>
    <td align="center" width="110"><b>Sentry</b><br/><sub>Breadcrumb bridge<br/>+ session link</sub></td>
    <td align="center" width="110"><b>Slack</b><br/><sub>Block Kit<br/>+ /mushi cmd</sub></td>
    <td align="center" width="110"><b>Jira</b><br/><sub>OAuth 3LO<br/>bidir sync</sub></td>
    <td align="center" width="110"><b>Linear</b><br/><sub>Issue create<br/>+ status sync</sub></td>
    <td align="center" width="110"><b>PagerDuty</b><br/><sub>Severity-scoped<br/>escalation</sub></td>
  </tr>
  <tr>
    <td align="center" width="110"><b>Discord</b><br/><sub>Embed messages<br/>per channel</sub></td>
    <td align="center" width="110"><b>MS Teams</b><br/><sub>Adaptive cards<br/>+ on-call</sub></td>
    <td align="center" width="110"><b>GitHub Issues</b><br/><sub>Labels<br/>+ assignees</sub></td>
    <td align="center" width="110"><b>Bugsnag</b><br/><sub>Mirror + close<br/>on fix merge</sub></td>
    <td align="center" width="110"><b>Rollbar</b><br/><sub>Mirror + resolve<br/>on fix merge</sub></td>
    <td align="center" width="110"><b>Crashlytics</b><br/><sub>Push reports<br/>+ close</sub></td>
  </tr>
  <tr>
    <td align="center" width="110"><b>Zapier</b><br/><sub>Generic<br/>webhook fan-out</sub></td>
    <td align="center" width="110"><b>Cursor Cloud</b><br/><sub>Agentic draft<br/>PR dispatch</sub></td>
    <td align="center" width="110"><b>Cursor</b><br/><sub>via MCP<br/>server</sub></td>
    <td align="center" width="110"><b>Claude Code</b><br/><sub>via MCP<br/>server</sub></td>
    <td align="center" width="110"><b>OpenAI Agents</b><br/><sub>via A2A<br/>tasks</sub></td>
    <td align="center" width="110"><b>LangGraph</b><br/><sub>via A2A<br/>+ MCP</sub></td>
  </tr>
</table>

**11 inbound adapters** — Mushi receives alerts from your existing monitoring and turns them into the same triaged report rows as user-felt bugs:

> Sentry · Datadog · Bugsnag · Rollbar · Firebase Crashlytics · New Relic · Honeycomb · Grafana Loki · AWS CloudWatch · Opsgenie · Firebase Analytics

All of them ship in [`@mushi-mushi/adapters`](https://www.npmjs.com/package/@mushi-mushi/adapters) — drop them into any Node webhook server (Express / Fastify / Hono / serverless function).

---

## Framework support

| Framework                       | Install after wizard (automatic)                  |
| ------------------------------- | ------------------------------------------------- |
| React                           | `@mushi-mushi/react`                              |
| Next.js                         | `@mushi-mushi/react`                              |
| Vue 3 / Nuxt                    | `@mushi-mushi/vue` + `@mushi-mushi/web`           |
| Svelte / SvelteKit              | `@mushi-mushi/svelte` + `@mushi-mushi/web`        |
| Angular 17+                     | `@mushi-mushi/angular` + `@mushi-mushi/web`       |
| React Native / Expo             | `@mushi-mushi/react-native`                       |
| Capacitor / Ionic               | `@mushi-mushi/capacitor`                          |
| Flutter / Dart                  | `pub add mushi_mushi`                             |
| iOS native (Swift)              | Swift Package Manager — early dev                 |
| Android native (Kotlin/Java)    | Gradle `dev.mushimushi:mushi-android` — early dev |
| Node (Express / Fastify / Hono) | `@mushi-mushi/node` (server-side error capture)   |
| Vanilla JS                      | `@mushi-mushi/web`                                |

Prefer to skip the wizard? `npm i @mushi-mushi/react` (or your framework's package) and wire it up by hand.

---

## How the pipeline works

```
User hits widget ──▶ screenshot + console + network + intent
        │
        ▼
  Fast-filter (Haiku)  ──▶  drops spam, keeps signal
        │
        ▼
  Deep classify (Sonnet + vision + RAG)  ──▶  category, severity, component
        │
        ▼
  Dedup (pgvector)  ──▶  groups repeat reports by meaning
        │
        ▼
  Judge (weekly)  ──▶  scores classifier, retrains prompts
        │
        ▼
  "Dispatch fix"  ──▶  agent opens a GitHub PR with Playwright replay + visual diff
```

See the full architecture in the [root README](https://github.com/kensaurus/mushi-mushi#architecture).

---

## 30-second quick start

```bash
# 1. Drop the wizard in (or one of the equivalents below)
npx mushi-mushi

# equivalents:
npm create mushi-mushi
npx @mushi-mushi/cli init
```

<details>
<summary><b>Flags for CI, monorepos, and self-hosted</b></summary>

```bash
npx mushi-mushi --framework next               # skip framework detection
npx mushi-mushi --project-id proj_xxx --api-key mushi_xxx
npx mushi-mushi --skip-install                 # print the install command, don't run it
npx mushi-mushi --skip-test-report             # don't offer to send a test report
npx mushi-mushi --cwd apps/web                 # run inside a monorepo sub-package
npx mushi-mushi --endpoint https://mushi.your-company.com   # self-hosted
npx mushi-mushi -y                             # accept the detected framework
npx mushi-mushi -v                             # print version
npx mushi-mushi --help
```

</details>

<details>
<summary><b>Troubleshooting</b></summary>

- **Wrong framework detected?** Pass `--framework <id>`. Valid values: `next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla`.
- **Monorepo?** `cd` into the package first, or pass `--cwd apps/web`.
- **Stale `npx` cache?** `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive terminal (CI)?** Pass `--yes --project-id proj_xxx --api-key mushi_xxx`. The wizard exits with a clear error instead of hanging.
- **Node version too old?** Requires Node ≥ 18. Upgrade at [nodejs.org](https://nodejs.org/).
- **Full stack traces on error?** `DEBUG=mushi npx mushi-mushi`.

</details>

<details>
<summary><b>Security notes</b></summary>

- Credentials passed via `--api-key` are visible to other users on the same machine via `ps -ef`. Use the interactive prompt on shared hosts.
- `~/.mushirc` (the credentials cache) is written with mode `0o600` on Unix; the CLI also tightens the permissions of any existing file on first load.
- The wizard rejects pasted secrets containing CR/LF/NUL to prevent `.env` injection.
- All prompts validate format: `proj_[A-Za-z0-9_-]{10,}` and `mushi_[A-Za-z0-9_-]{10,}`.
- This release ships with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — verify with `npm audit signatures`.

</details>

<details>
<summary><b>Supply-chain & verification (Socket, Bundlephobia, Snyk)</b></summary>

Mushi is a CLI launcher — it spawns one `npm install` and writes one `.env.local` line. Here's what each scanner shows and why:

| Scanner            | What it shows                                 | What it actually means                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm provenance** | ✅ Signed by `kensaurus/mushi-mushi @ master` | Cryptographic Sigstore attestation — `npm audit signatures` will verify this build came from this exact commit on this exact CI workflow.                                                                                        |
| **Socket.dev**     | Score + a few low-signal alerts               | Alerts are expected and benign: `child_process.spawn` (used to invoke `npm install`), `process.env` (read `DEBUG`, `npm_config_*`), URL strings (printed in help text). All visible in `src/index.ts` — ~150 LOC, easy to audit. |
| **Bundlephobia**   | ❌ EntryPointError                            | **Expected.** This is a CLI (`bin` only — no `main`/`module`/`exports`), so there is no importable bundle to measure. Bundlephobia only works for libraries you `import`.                                                        |
| **Snyk Advisor**   | Health score (lower right after publish)      | Snyk's crawler often lags by 1–2 weeks for new public packages — score corrects itself once it picks up the actual `package.json` (`CONTRIBUTING.md`, `funding`, downloads, repo activity).                                      |

If something looks off to you, [open an issue](https://github.com/kensaurus/mushi-mushi/issues) — the source is 100% public and the CI build is reproducible.

</details>

---

## Power-user CLI

`mushi-mushi` is just the setup wizard. For day-to-day triage install the full CLI:

```bash
npm i -g @mushi-mushi/cli
mushi reports list
mushi reports show <id>
mushi reports triage <id> --status acknowledged --severity high
mushi deploy check          # post-deploy smoke check
mushi status                # live pipeline health
```

For the **v2 inventory + gates** loop the actionable surface is the GitHub Action — drop one job into your repo and it runs Claude's proposer / the gate suite / the discovery digest on every PR:

```yaml
# .github/workflows/mushi-gates.yml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: gates # also: propose · discover-api · discovery-status · auth-bootstrap
```

The same commands are exposed as MCP tools through [`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp), so Cursor / Claude Code / Copilot can drive the v2 loop without you ever opening a terminal.

Or skip the CLI entirely and drive it from your AI agent via [`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp):

```json
{ "mcpServers": { "mushi": { "command": "npx", "args": ["-y", "@mushi-mushi/mcp"] } } }
```

---

## Links

- 🌐 **[Live admin demo](https://kensaur.us/mushi-mushi/)** — click around a real dataset
- 📦 **[GitHub](https://github.com/kensaurus/mushi-mushi)** — source, architecture, self-hosting
- 📚 **[Docs](https://github.com/kensaurus/mushi-mushi#readme)** — quickstart, concepts, API reference
- 🐛 **[Report a bug](https://github.com/kensaurus/mushi-mushi/issues)** — eat your own dogfood

## License

MIT © [Kenji Sakuramoto](https://github.com/kensaurus). Backend packages (`@mushi-mushi/server`, `agents`, `verify`) are [BSL 1.1](https://github.com/kensaurus/mushi-mushi/blob/master/packages/server/LICENSE) — converts to Apache 2.0 on April 15, 2029.


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 43 edge functions · 234 SQL migrations · 13 outbound plugins · 11 inbound adapters. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
