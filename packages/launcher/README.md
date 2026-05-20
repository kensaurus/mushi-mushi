<div align="center">

# mushi-mushi 🐛

**Software's missing Darwin moment — catch bugs, name them, teach every future developer to never make the same mistake.**

`npx mushi-mushi` · React · Next.js · Vue · Nuxt · Svelte · Angular · React Native · Expo · Capacitor · Vanilla JS

[![npm](https://img.shields.io/npm/v/mushi-mushi?color=cb3837&label=mushi-mushi)](https://www.npmjs.com/package/mushi-mushi)
[![npm downloads](https://img.shields.io/npm/dm/mushi-mushi?color=cb3837&label=downloads)](https://www.npmjs.com/package/mushi-mushi)
[![License](https://img.shields.io/npm/l/mushi-mushi?color=blue)](https://github.com/kensaurus/mushi-mushi/blob/master/LICENSE)
[![Provenance](https://img.shields.io/badge/npm-provenance-8957e5?logo=npm)](https://docs.npmjs.com/generating-provenance-statements)
[![Socket](https://socket.dev/api/badge/npm/package/mushi-mushi)](https://socket.dev/npm/package/mushi-mushi)
[![Node](https://img.shields.io/node/v/mushi-mushi?color=339933&logo=node.js)](https://nodejs.org)

<a href="https://kensaur.us/mushi-mushi/" title="Open the live admin demo">
  <img src="https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/docs/screenshots/report-detail-dark.png" alt="A real user-felt bug inside the Mushi admin — Plan / Do / Check / Act PDCA receipt across the top, the original user description, LLM classification (Confusing UX · Medium · 78% confidence · component = Dashboard/HeroCTA), environment + performance metrics, and a one-click Dispatch-fix CTA." width="860" />
</a>

<sub>↑ a real user report, classified and encoded as institutional memory · <a href="https://kensaur.us/mushi-mushi/">open the live demo</a></sub>

</div>

---

## Why evolution? (The 60-second idea behind this tool)

Every living thing on Earth shares one invisible superpower: **when it fails, the lesson gets inherited**. A bacterium that dies from an antibiotic passes that encoded resistance to its descendants. An aviation fleet that crashes encodes the root cause into a mandatory checklist every pilot learns on day one. The lesson doesn't evaporate — it becomes part of the substrate.

Software development has never had this. A bug is reported, fixed, and forgotten. The developer who filed the ticket moves on. The lesson lives in a Jira comment that nobody reads. Six months later, a new teammate joins, hits the same class of mistake, and the cycle resets. Every team is, perpetually, generation zero.

**Mushi is the missing layer.** It gives every reported bug a permanent home: captured → clustered with similar bugs by meaning → promoted to a named learning rule → injected into the next PR review and the next AI agent run — so neither you nor your AI can repeat the same class of mistake twice. The more bugs it absorbs, the richer the lesson library becomes. It gets better by failing. That's not a metaphor — it's the technical architecture.

> *"Cumulative selection is the key to all of evolution. Each improvement, however slight, is retained and passed on."*
> — Richard Dawkins, *Climbing Mount Improbable* (1996, p. 74)

> *"Every failure is data. Aviation's NTSB turns every crash into institutional memory — software has no equivalent layer."*
> — Matthew Syed, *Black Box Thinking* (2015, p. 9)

> *"Innovations emerge as a consequence of trial-and-error and then become encoded in heuristics and practical knowhow."*
> — Nassim Nicholas Taleb, *Antifragile* (2012, p. 230)

---

## Before Mushi / After Mushi

The same team, the same codebase — but with a fundamentally different relationship to failure.

| | ❌ Before Mushi | ✅ After Mushi |
|---|---|---|
| **User hits a broken button** | Leaves silently. You never know. | Shakes phone → note + screenshot → your queue in seconds. |
| **Your error tracker** | Silent (nothing crashed). Sentry stays green. | Classified report: "Confusing UX · Medium · Dashboard/HeroCTA". |
| **Same bug, 40 users** | 40 separate tickets. Triage nightmare. | 1 row. Deduplicated by meaning, not by string. |
| **Root cause** | Your team guesses from a stack trace. | AI reads the screenshot and user note, names the component, suggests the fix. |
| **Fix it** | Assign Jira ticket → sprint → PR → review → deploy. | Click "Dispatch fix" → draft PR opens in minutes → you review and merge. |
| **Lesson encoded?** | No. It lives in a git commit message. | Yes. Vector-clustered into a named learning rule in `.mushi/lessons.json`. |
| **Next developer** | Makes the same class of mistake. | PR review gets the rule injected: *"Rule L-0042: never call setState in useEffect for derived values — seen 17 times."* |
| **Next AI agent** | Guesses from the same blank slate. | Cursor / Claude Code reads the lesson library via MCP before proposing a diff. |
| **Release accountability** | Nobody knows which user found which bug. | Auto-drafted changelog: *"Fixed by Kenji: Settings back-button counted safe-area inset twice."* |

---

## Pros & Cons

Be honest about what you're signing up for.

### Pros

- **Zero-code capture.** `npx mushi-mushi` installs in one command — no Webpack config, no SDK wrapper, no manual `window.onerror` wiring. The widget is Shadow-DOM; it won't touch your CSS.
- **Catches the invisible.** Dead buttons, 12-second screens, one-device layout bugs — the category of failures that Sentry, Datadog, and Firebase are structurally blind to.
- **Reports don't pile up.** pgvector dedup collapses the same broken thing across 40 users to one row. Your queue reflects reality, not noise.
- **The loop closes itself.** Bug → cluster → lesson → PR-review injection → agent memory. The next bug of the same class is stopped before it ships.
- **Bring your own AI keys.** You pay Anthropic and OpenAI directly, at your rate, with your data agreements. Mushi never marks up tokens or holds your data hostage.
- **Agent-native from day one.** MCP Streamable HTTP, A2A v1.0.0 tasks, OpenAPI 3.1. Cursor, Claude Code, Copilot, LangGraph, CrewAI all see the same surface the human admin does.
- **Standards-first.** W3C `traceparent` end-to-end, Standard Webhooks signing, RFC-draft `Idempotency-Key`, OAuth 2.0 Dynamic Client Registration. You bring your existing observability stack — Mushi slots in.
- **Self-host or cloud.** One Docker Compose file. One Helm chart (138 SQL migrations bundled). No vendor lock-in at the infra level.
- **Open-source SDK.** Every client package is MIT. Fork it, audit it, sell it — the trademarks are separate from the code.

### Cons / trade-offs

- **Requires your own LLM API key.** Classification, clustering, fix-dispatch, and lessons all call Anthropic / OpenAI. Most teams run under $20/month, but the cost is yours. If you have no API budget, the widget still captures and you can triage manually — but the AI layers won't fire.
- **The lesson library needs volume.** Vector clustering requires ~30 reports before it promotes its first cluster to a lesson. Early-stage projects see a quiet lesson page for the first week or two.
- **AI-dispatched fixes are a draft, not a merge.** The agent opens a PR. A human always reviews. If you want fully automated merges, wire your own CI policy — Mushi doesn't force-merge.
- **Server packages are BSL 1.1** (converts to Apache 2.0 in 2029). SDK packages are MIT. If you want to run Mushi as a hosted service for third-party clients today, you need a commercial license.
- **OIDC SSO is audit-only today.** SAML SSO is self-service; OIDC stores the config and returns HTTP 202 for manual Supabase-support setup. Most teams use SAML or API-key auth without needing OIDC.
- **AI fix orchestrator needs a GitHub token.** Without one, the classification, dedup, and lesson loop all work — you just won't get auto-drafted PRs. Jira/Linear/Slack plugins still fire.

---

## Install in one line

```bash
npx mushi-mushi
```

The wizard auto-detects your framework, installs the right SDK, writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` to `.env.local` (with the right prefix — `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, or `VITE_`), and prints the snippet to paste. **Non-destructive**: never overwrites existing env vars, never edits your source files.

```tsx
// After the wizard — React / Next.js:
import { MushiProvider } from '@mushi-mushi/react';

export function App({ children }) {
  return (
    <MushiProvider config={{ projectId: 'proj_xxx', apiKey: 'mushi_xxx' }}>
      {children}
    </MushiProvider>
  );
}
```

That's it. Your users have a shake-to-report button. Every report lands in [your admin console](https://kensaur.us/mushi-mushi/), classified within seconds.

<details>
<summary><b>Other frameworks</b> — Vue, Svelte, Angular, React Native, Vanilla JS</summary>

```ts
// Vue 3 / Nuxt
import { MushiPlugin } from '@mushi-mushi/vue';
app.use(MushiPlugin, { projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

// Svelte / SvelteKit
import { initMushi } from '@mushi-mushi/svelte';
initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

// Angular 17+
import { provideMushi } from '@mushi-mushi/angular';
bootstrapApplication(AppComponent, {
  providers: [provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })],
});

// React Native / Expo
import { MushiProvider } from '@mushi-mushi/react-native';
<MushiProvider projectId="proj_xxx" apiKey="mushi_xxx"><App /></MushiProvider>;

// Vanilla JS / any framework
import { Mushi } from '@mushi-mushi/web';
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });
```

</details>

<details>
<summary><b>Flags for CI, monorepos, and self-hosted</b></summary>

```bash
npx mushi-mushi --framework next               # skip framework detection
npx mushi-mushi --project-id proj_xxx --api-key mushi_xxx
npx mushi-mushi --skip-install                 # print the install command, don't run it
npx mushi-mushi --cwd apps/web                 # run inside a monorepo sub-package
npx mushi-mushi --endpoint https://mushi.your-company.com   # self-hosted
npx mushi-mushi -y                             # accept the detected framework, no prompts
```

The wizard also auto-detects monorepo workspace type (npm / yarn / pnpm workspaces, Turborepo, Nx, Lerna) from your `package.json` and shows the correct workspace-scoped install command.

</details>

---

## How the loop actually runs

```
1. User taps the widget  ──▶  screenshot + route + note + last 5s of console + network
         │
         ▼
2. Fast-filter (Haiku)   ──▶  drops spam / test noise, passes real friction
         │
         ▼
3. Deep classify (Sonnet + vision + RAG)  ──▶  category, severity, component, root-cause hint
         │
         ▼
4. Dedup (pgvector)      ──▶  collapses duplicates across users — 40 reports become 1 row
         │
         ▼
5. Cluster (BIRCH)       ──▶  groups similar bugs by meaning; LLM judge scores coherence
         │
         ▼
6. Promote to lesson     ──▶  coherent clusters become named rules in .mushi/lessons.json
         │
         ▼
7. Inject into PR review ──▶  `lessons.query` MCP tool sends relevant rules to your agent
         │
         ▼
8. Optional: Dispatch fix ──▶  agent opens a draft GitHub PR · human reviews and merges
         │
         ▼
9. Release credits       ──▶  changelog names the user who found the bug · SDK shows toast
         │
         ▼
         └────────────── Loop starts stronger than it began ──────────────┘
```

Every iteration of the loop is slightly better than the last. That's cumulative selection — not a metaphor.

---

## What you get on day one

- **Shake-to-report widget** — Shadow-DOM, zero CSS conflicts. Captures screenshot, console ring, network ring, route + intent, and queues offline automatically.
- **AI-classified reports** — 2-stage pipeline (Haiku fast-filter → Sonnet deep + vision) streams partial results to the admin UI as tokens arrive. Stage 2 includes RAG over your lesson library so reports of *known* bugs get flagged immediately.
- **Dedup by meaning, not string** — pgvector knowledge graph collapses duplicates across users, routes, and deploys.
- **Lesson library** — BIRCH-style clusterer + LLM coherence judge promotes clusters to named learning rules. `mushi sync-lessons` writes `.mushi/lessons.json` to your repo automatically.
- **Bidirectional inventory (v2)** — opt into `capture: { discoverInventory: true }` and the SDK quietly observes routes, `data-testid`s, and outbound API paths. Claude drafts an `inventory.yaml` of user stories → pages → actions for you to accept.
- **Five pre-release gates (v2)** — `no-dead-handler`, `no-mock-leak`, inventory drift, agentic-failure detection, synthetic walk health. One composite GitHub check.
- **Spec-traced fixes (v2.10)** — every dispatched fix carries the inventory `Action` it repairs; `validateAgainstSpec` fires before the PR opens; a targeted synthetic probe runs the moment the PR lands.
- **One-click "Dispatch fix"** — agentic orchestrator opens a GitHub PR with a Playwright replay and screenshot diff. Sandbox-pluggable (`e2b`, `modal`, `cloudflare`, or your own `SandboxProvider`).
- **A/B experiments** — `mushi.experiment('hero-copy-v3')` returns sticky variant assignments; CUPED + mSPRT analysis with automatic SRM detection.
- **Anomaly detection** — STL + Page-Hinkley + isolation-forest detectors on inbound adapter metrics; confirmed regressions auto-open reports and feed back into the lesson library.
- **Release attribution** — auto-drafted changelogs credit the exact user whose report triggered the fix; SDK shows a toast: *"v1.2.3 shipped — you helped fix the settings back-button."*
- **PDCA iterate loop** — producer/critic agent loop with selectable personas (Tufte data-density, NN/g heuristic, WCAG a11y, mobile-first). Live progress + draft-PR exit.
- **Agent-native via MCP + A2A** — MCP Streamable HTTP at `/functions/v1/mcp`, A2A v1.0.0 tasks at `/v1/a2a/tasks`. Cursor, Claude Code, Copilot, OpenAI Agents SDK, LangGraph, and CrewAI all see the same surface.

---

## Who it's for

| You are… | …this helps because |
|---|---|
| **Solo dev / small team** shipping a consumer app | You already have Sentry for crashes — but users drop off over *friction*, not exceptions. Mushi captures "this button doesn't do anything". |
| **PM or designer** living in the admin | Triage, severity, component ownership, and PR status — in one dark-mode console. No reading stack traces. |
| **AI-native team** already in Cursor / Claude | MCP tools expose the full loop to your agent: `get_recent_reports`, `classify`, `dispatch_fix`, `lessons.query`. |
| **Team that ships fast and breaks things** | The lesson library means each sprint starts smarter than the last. You're not just fixing bugs — you're encoding them. |
| **Enterprise** needing SOC 2 + residency | Region-pinned data (US / EU / JP / SELF), SAML SSO, audit-log ingest, DSAR workflow, HMAC-signed plugin webhooks. |

---

## Mushi vs your existing stack

Mushi is a **companion** to Sentry/Datadog, not a replacement. It sees the signal they structurally can't.

| Signal type | Typical tool | What they miss |
|---|---|---|
| Code-thrown errors | Sentry, Crashlytics, Bugsnag, Rollbar | Bugs that don't throw — dead buttons, janky scroll, 12-second screens |
| System telemetry | Datadog, New Relic, Honeycomb | The user's perspective on what that latency spike *felt* like |
| Product analytics | Firebase, PostHog, Amplitude | *Why* a funnel step was abandoned, in the user's own words |
| **User-felt friction** | **nothing → Mushi** | — |

| | Sentry / Crashlytics | Datadog / New Relic | Firebase / Amplitude | **Mushi Mushi** |
|---|:---|:---|:---|:---|
| **Signal origin** | Code throws | Infrastructure metrics | User events | User-felt friction, in the moment |
| **Lesson encoded?** | No | No | No | Yes — named rule in `.mushi/lessons.json` |
| **Repeat signal** | Same error = separate issue | Spike repeats = new alert | Funnel drops again | Same broken button → 1 row, forever |
| **Closes the loop** | Assign a ticket | Write a runbook | A/B test conversion | Draft PR → lesson → future PRs get the rule |
| **From your IDE** | Paste issue ID into Cursor | — | — | Cursor reads the lesson library + proposes the diff |

> Already have Sentry? Mushi writes breadcrumbs into your existing Sentry session — jump from a crash to the user's own words in one click. 12 outbound plugins (Slack, Jira, Linear, PagerDuty, Discord, MS Teams, GitHub Issues, Bugsnag, Rollbar, Crashlytics, Zapier, Sentry) and 11 inbound adapters ship in [`@mushi-mushi/adapters`](https://www.npmjs.com/package/@mushi-mushi/adapters).

---

## Framework support

| Framework | Package installed by wizard |
|---|---|
| React / Next.js | `@mushi-mushi/react` |
| Vue 3 / Nuxt | `@mushi-mushi/vue` + `@mushi-mushi/web` |
| Svelte / SvelteKit | `@mushi-mushi/svelte` + `@mushi-mushi/web` |
| Angular 17+ | `@mushi-mushi/angular` + `@mushi-mushi/web` |
| React Native / Expo | `@mushi-mushi/react-native` (v0.11.0 — Hermes-compatible) |
| Capacitor / Ionic | `@mushi-mushi/capacitor` |
| Flutter / Dart | `pub add mushi_mushi` |
| iOS native (Swift) | Swift Package Manager |
| Android (Kotlin/Java) | `dev.mushimushi:mushi-android` |
| Vanilla JS / any | `@mushi-mushi/web` |
| Node.js (Express / Fastify / Hono) | `@mushi-mushi/node` |

---

## Power-user CLI

`mushi-mushi` is the setup wizard. For daily triage install the full CLI:

```bash
npm i -g @mushi-mushi/cli
mushi reports list
mushi reports triage <id> --status acknowledged --severity high
mushi deploy check          # post-deploy smoke check
mushi status                # live pipeline health
```

For the **AI agent loop**, add one GitHub Action:

```yaml
# .github/workflows/mushi-gates.yml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: gates  # also: propose · discover-api · discovery-status
```

Or drive it entirely from your AI agent:

```json
{ "mcpServers": { "mushi": { "command": "npx", "args": ["-y", "@mushi-mushi/mcp"] } } }
```

<details>
<summary><b>Troubleshooting</b></summary>

- **Wrong framework detected?** Pass `--framework <id>`. Valid: `next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla`.
- **Monorepo?** `cd` into your app package first, or pass `--cwd apps/web`. The wizard reads your `package.json` to detect workspace type (npm / yarn / pnpm workspaces, Turborepo, Nx, Lerna) and shows the right install command.
- **Stale `npx` cache?** `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive terminal (CI)?** Pass `--yes --project-id proj_xxx --api-key mushi_xxx`.
- **Node version?** Requires Node ≥ 18. Check at [nodejs.org](https://nodejs.org/).
- **Debug mode:** `DEBUG=mushi npx mushi-mushi`.

</details>

<details>
<summary><b>Supply-chain verification (Socket, Provenance, Bundlephobia)</b></summary>

| Scanner | What it shows | What it means |
|---|---|---|
| **npm provenance** | ✅ Signed by `kensaurus/mushi-mushi @ master` | Cryptographic Sigstore attestation — `npm audit signatures` verifies this build came from this exact commit |
| **Socket.dev** | Score + a few low-signal alerts | Alerts are benign: `child_process.spawn` (invokes `npm install`), `process.env` (reads `DEBUG`, `npm_config_*`). All visible in `src/index.ts` — ~150 LOC, auditable in minutes |
| **Bundlephobia** | ❌ EntryPointError | **Expected.** This is a CLI (`bin` only — no `main`/`module`/`exports`). Bundlephobia only measures importable libraries |

</details>

---

## Links

- 🌐 **[Live admin demo](https://kensaur.us/mushi-mushi/)** — click through a real dataset, no sign-up
- 📦 **[GitHub](https://github.com/kensaurus/mushi-mushi)** — source, full architecture, self-hosting guide
- 📚 **[Docs](https://kensaur.us/mushi-mushi/docs/)** — concepts, SDK reference, closed-loop essay
- 🧬 **[Why a closed loop](https://kensaur.us/mushi-mushi/docs/concepts/closed-loop)** — the full Dawkins / Taleb / Syed argument
- 🐛 **[Report a bug](https://github.com/kensaurus/mushi-mushi/issues)** — eat your own dogfood

---

## License

MIT © [Kenji Sakuramoto](https://github.com/kensaurus). Backend packages (`@mushi-mushi/server`, `agents`, `verify`) are [BSL 1.1](https://github.com/kensaurus/mushi-mushi/blob/master/packages/server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
