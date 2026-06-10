<div align="center">

# Mushi Mushi

**The bug your monitoring can't see, in your queue with a draft fix.**

Sentry catches what your code throws. Datadog catches what your infrastructure does. Firebase catches what your users _click_. Mushi catches what your users _feel_ — the dead button, the 12-second screen, the layout that breaks on one Android.

Mushi is the **synthesis layer**: the one signal none of your existing tools capture, with inbound adapters for **11 monitoring sources** (Sentry, Datadog, Bugsnag, Rollbar, Crashlytics, New Relic, Honeycomb, Grafana Loki, AWS CloudWatch, Opsgenie, Firebase Analytics) and **13 outbound plugins** (Sentry, Slack, Jira, Linear, PagerDuty, Discord, Microsoft Teams, GitHub Issues, Bugsnag, Rollbar, Crashlytics, Zapier, Cursor Cloud) so every tool in your stack stays in the loop.

[![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=%40mushi-mushi%2Freact&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![CI](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml/badge.svg)](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/SDK-MIT-blue.svg)](./LICENSE)
[![Server](https://img.shields.io/badge/server-BSL%201.1-orange.svg)](./packages/server/LICENSE)

[Quick start](#try-it) · [Live admin demo](https://kensaur.us/mushi-mushi/admin/) · [Docs](https://kensaur.us/mushi-mushi/docs/) · [Marketing landing](https://kensaur.us/mushi-mushi/) · [Self-hosting](./SELF_HOSTED.md) · [Rewards program](./docs/REWARDS.md) · [Full screenshot tour](./docs/SCREENSHOTS.md)

<a href="https://kensaur.us/mushi-mushi/admin/" title="Open the live admin demo — animated guided tour">
  <img src="./docs/screenshots/tour-pdca-loop.gif" alt="Animated guided tour through the logged-in admin console, walking the full Plan → Do → Check → Act loop." width="100%" />
</a>

<sub>↑ a logged-in 4-stop walk through the Plan → Do → Check → Act loop</sub>

<br><br>

<a href="https://kensaur.us/mushi-mushi/admin/dashboard" title="Open the live admin dashboard">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshots/dashboard-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./docs/screenshots/dashboard-light.png">
    <img alt="Mushi admin dashboard — the new v2 PDCA cockpit. Plan / Do / Check / Act pills along the top, Workspace snapshot, the bug-fix loop summary, the next action callout, and the project setup checklist down the right." src="./docs/screenshots/dashboard-dark.png" width="100%">
  </picture>
</a>

<sub>↑ the v2 admin · click to open the live demo · the image swaps with your system theme</sub>

</div>

---

## Read this first if you're not a developer

A 60-second tour for product managers, designers, founders, and anyone who's ever heard "we'll fix it next sprint" three sprints in a row.

- **What it is** — A small "shake your phone to report a bug" button that drops into any web or mobile app in one line of code. It captures a screenshot, what the user was trying to do, and what their device looked like.
- **Why it's different** — Sentry, Datadog, and Firebase tell you when _code crashes_. They go quiet when a button looks clickable but isn't, when a page takes 12 seconds to load with no error, or when the layout looks broken on one phone model. Mushi catches those — the bugs your users _feel_ but your monitoring can't see.
- **What happens to a report** — An AI reads it within seconds, tags severity ("blocker", "minor"), groups duplicates ("the same broken button collapsed across 47 users"), and (optionally) hands the report to another AI that opens a draft pull request with the proposed code change. A human always reviews and merges.
- **Where your data lives** — Your own cloud (self-hosted), or ours. The free tier covers 1,000 reports a month with no credit card.
- **What it costs to run** — Mushi is the _plumbing_. You bring your own API keys for Anthropic / OpenAI / Sentry / Slack / etc., and you pay those vendors directly. We don't mark up LLM tokens or hold your data hostage. Most teams run the whole loop for under $20/month.
- **Who it's for** — Founders shipping a consumer product, PMs who live in support tickets, designers tired of "works on my machine", on-call engineers who want fewer 3 AM Slack pings.
- **Two-line install** — `npx mushi-mushi`. The wizard does the rest.

If you're a developer skip ahead to [Try it](#try-it). If you're an operator or platform engineer, jump to [Operator-grade plumbing](#operator-grade-plumbing) for the production checklist.

---

## What's new in v2 — bidirectional inventory + agentic-failure gates

Mushi v1 was the negative side: catch what your users _felt_ break and triage it.
**v2 adds the positive side**: a declarative `inventory.yaml` of user stories, pages, and actions — with five pre-release **gates** that fail the build when the agent's drafts diverge from the contract, and a **synthetic monitor** that re-walks the same surface against staging on a schedule.

- 🌱 **Sketch your app, not just its bugs.** A `User stories · Inventory` page (sidebar → User stories) groups every user-facing action under the story it serves and shows verified / unwired / regressed counts at a glance.
- 🤖 **The SDK proposes the inventory.** Turn on `capture.discoverInventory` and the SDK quietly observes routes, `data-testid`s, and outbound API paths in production — Claude drafts an `inventory.yaml` from the stream, you accept or edit. Most teams will never hand-author one.
- 🚦 **Five gates, one composite GitHub check.** `mushi-mushi/no-dead-handler` (empty `onClick`s), `mushi-mushi/no-mock-leak` (faker / "John Doe" arrays in non-test paths), inventory drift (added / removed / renamed actions), agentic-failure detection (handler regressions across deploys), and synthetic walk health.
- 🛰️ **Synthetic monitor** runs the inventory's `expected_outcome` checks against your staging URL on a cron — fail-closed by default, with explicit `synthetic_monitor_allow_mutations` opt-in for write paths.
- 🕸️ **Graph gets a Surface mode** — the same `Bug graph` toggles to a `Surface` view that overlays the positive inventory on the live knowledge graph so you can see the dead corners.
- 🧭 **Spec traceability is end-to-end (2026-05-09 release).** `expected_outcome` is a real schema field — its assertions ride along with every fix dispatch, get rendered into the LLM prompt, gate the PR through `validateAgainstSpec`, and trigger a _targeted_ synthetic probe against the originating Action the moment the PR opens. Every `fix_attempt` row records the inventory `Action` it was meant to repair (`inventory_action_node_id`), so the admin "Where this fix came from" drawer can show the same spec the agent saw. See [How spec traceability works](#how-spec-traceability-works) below for the full chain.
- 🔌 **First-class orchestrator interop.** Plug Mushi into Cursor, Claude Code, OpenAI Agents SDK, LangGraph, CrewAI, A2A v1.0.0 agents, or anything else: **MCP Streamable HTTP** at `/functions/v1/mcp` (2025-03-26 spec), **A2A `tasks` endpoints** at `/v1/a2a/tasks` (create / get / cancel / SSE subscribe), **OpenAPI 3.1** at `/openapi.json`, AG-UI v0.4 SSE accepts API keys (`mcp:read`), `SandboxProvider` is an open contract with a third-party registry, and JSON Schemas for `FixContext` / `FixResult` / `SandboxProvider` / `ExpectedOutcome` are served at `/v1/schemas/*`. See [Connecting your orchestrator](https://kensaur.us/mushi-mushi/docs/concepts/orchestrator-interop) for per-orchestrator recipes.
- 🧩 **Headless SDK widget.** `MushiTrigger` and `MushiAttach` let you attach the feedback reporter to any button, icon, or menu item in your existing design system — no floating stamp, no fixed position, just your UI opening Mushi on click. Works in React (polymorphic `as` prop) and React Native (`cloneElement` injection). See [Headless integration](#headless-sdk-integration).
- 🌐 **Multi-platform console.** Reports from iOS, Android, Web, and React Native are now filterable by platform and SDK package in the Reports list. Each report's detail drawer shows the "Device & Build" section with `sdk_version` and `app_version`. The Dashboard shows a **Platform Health** tile with 24h report volume per SDK.
- 🤖 **QA Coverage Suite.** Define automated user-story tests as natural-language prompts or Playwright scripts, schedule them on cron, and run them via **Firecrawl Actions** (default, no setup), **Browserbase** (BYOK, cloud Chromium), or **local Playwright** (CLI). Pass/fail history appears on a dedicated `/qa-coverage` page and a dashboard tile. When you generate a Playwright test from a report, Mushi automatically creates a QA story so it runs on a weekly schedule as a regression guard. See [QA Coverage Suite](#qa-coverage-suite).

Get started in any project that already has Mushi installed:

```yaml
# .github/workflows/mushi-gates.yml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: gates # also: propose · discover-api · discovery-status · auth-bootstrap
```

Inside your IDE the same commands are exposed as MCP tools via [`@mushi-mushi/mcp`](./packages/mcp/), so Cursor / Claude Code / Copilot can run them on your behalf. From the admin UI you click _Run gates_ / _Run crawler_ directly on each row of the User stories page.

Full schema in [`@mushi-mushi/inventory-schema`](./packages/inventory-schema/), ESLint rules in [`eslint-plugin-mushi-mushi`](./packages/eslint-plugin-mushi-mushi/), the auth-bootstrap helper in [`@mushi-mushi/inventory-auth-runner`](./packages/inventory-auth-runner/).

---

## How spec traceability works

The most-asked v2 question is "how do you keep agent work tied back to the original spec once implementation starts?" Honest answer: until the 2026-05-09 release the read side was tight and the write side was a U-turn — the worker dropped the inventory pointer the moment dispatch started. That's now closed end-to-end.

```
report ──► classify-report writes graph_edge (reports_against)
              │
              ▼
        inventory Action node ◄────────── inventory.yaml (expected_outcome)
              │
              ▼
       POST /v1/admin/fixes/dispatch  (or /v1/a2a/tasks, MCP dispatch_fix)
              │  body may carry { inventoryActionNodeId } — else worker walks the edge
              ▼
        fix_dispatch_jobs.inventory_action_node_id  ──► persisted
              │
              ▼
        fix-worker assembles FixContext
              + inventoryAction.expectedOutcome  ──► Markdown spec block in the LLM prompt
              ▼
        validateAgainstSpec  (deterministic pre-PR gate)
              │  HARD ERROR if the diff removes a json_path field the contract asserts on
              │  WARN to fix_attempts.spec_validation_warnings if no file references the contract's table / route
              ▼
        GitHub PR + fix_attempts row stamped with inventory_action_node_id
              │
              ▼
        synthetic_runs queued (status='skipped', error_message='queued_post_pr', action_node_id=…)
              │
              ▼
        synthetic-monitor cron drains the queue with priority on the next tick,
        runs an HTTP probe, evaluates expected_outcome (status_in + JSONPath assertions),
        records a real synthetic_runs row.
              │
              ▼
        Status reconciler picks it up → admin UI flips the Action to verified / regressed.
```

Every link in that chain has a real column / migration / test:

| Link                                       | Where to look                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expected_outcome` schema                  | [`packages/inventory-schema/src/index.ts`](./packages/inventory-schema/src/index.ts) — Zod + JSON Schema, mirrored at `/v1/schemas/expected-outcome.json`                                                                                                                                                                        |
| `inventory_action_node_id` columns         | [`20260509100000_inventory_action_traceability.sql`](./packages/server/supabase/migrations/) — `fix_dispatch_jobs` + `fix_attempts` (FK, `ON DELETE SET NULL`) + `spec_validation_warnings JSONB`                                                                                                                                |
| Spec context in the LLM prompt             | `renderSpecContext()` in [`packages/agents/src/review.ts`](./packages/agents/src/review.ts), mirrored in [`packages/server/supabase/functions/fix-worker/index.ts`](./packages/server/supabase/functions/fix-worker/index.ts)                                                                                                    |
| Pre-PR gate                                | `validateAgainstSpec()` in [`packages/agents/src/review.ts`](./packages/agents/src/review.ts), wired into [`packages/agents/src/orchestrator.ts`](./packages/agents/src/orchestrator.ts)                                                                                                                                         |
| Post-PR probe                              | `drainPostPrQueue()` + `evaluateExpectedOutcome()` in [`packages/server/supabase/functions/synthetic-monitor/index.ts`](./packages/server/supabase/functions/synthetic-monitor/index.ts)                                                                                                                                         |
| External orchestrators see the same anchor | `dispatch_fix` and `get_fix_context` MCP tools in [`packages/server/supabase/functions/mcp/index.ts`](./packages/server/supabase/functions/mcp/index.ts); A2A `inventoryActionNodeId` body field in [`packages/server/supabase/functions/api/routes/a2a-tasks.ts`](./packages/server/supabase/functions/api/routes/a2a-tasks.ts) |

What the agent sees in its prompt today (rendered by `renderSpecContext`):

```markdown
## Inventory Spec Context (whitepaper §2.10 spec-traceability)

This fix was dispatched against a tracked Action in the project's `inventory.yaml`.
The agent and the reviewer MUST keep the diff scoped to making the action work as
specified — do NOT refactor unrelated code or break sibling actions on the same page.

- Action: `signup-form: submit`
- Description: Submit the signup form and create a new user
- Page: `/signup` (id=`signup`)
- User story: New user signup (`signup`)

### Expected outcome contract (success criteria after fix)

- Summary: POST /signup returns 200 and creates a user row
- HTTP status MUST be one of: 200, 201
- Response body assertions:
  - `$.user.id` exists
- Database: `public.users` MUST row_exists
- UI MUST show text containing: "Welcome"
- UI MUST navigate to: `/dashboard`

After the PR merges, the synthetic monitor will probe the action against this
contract. A draft fix that the synthetic monitor will then immediately mark
`regressed` is worse than no fix at all.
```

The same anchor flows out to every external surface — Cursor / Claude Code / OpenAI Agents SDK / LangGraph / CrewAI / A2A all get the inventory Action and its `expected_outcome` via the MCP `get_fix_context` tool, the A2A Task `metadata.inventoryActionNodeId` field, or the dispatch row's column directly.

---

## When this matters to you

Your existing monitoring is excellent at one thing: telling you what your code threw. It can't tell you any of these:

- A user added a coupon and the pay button slipped under their keyboard.
- A new signup tapped _Save_ twice because nothing visibly happened the first time.
- A Pro customer's dashboard takes 12 seconds to load and they've started using the competitor's tab in the meantime.
- A layout that looks fine on your laptop folds in half on the one Android model used by 18% of your traffic.
- A feature regressed two deploys ago. Three users emailed support; two just churned.

These never trigger an alert. Your users just leave. Mushi gives them a way to tell you while the moment is still fresh — so the bug your monitoring missed lands in your triage queue, classified, deduped, and (optionally) with a draft PR already open.

---

## At a Glance

<sub>Verified from source — June 2026. Run <code>pnpm docs-stats</code> or <code>pnpm check:docs-stats</code> for live counts.</sub>

<table>
<tr>
<td align="center" width="16%">

**~248K**
<br/>
<sub>TypeScript Lines</sub>

</td>
<td align="center" width="16%">

**1,079**
<br/>
<sub>Source Files</sub>

</td>
<td align="center" width="16%">

**41**
<br/>
<sub>Workspace Packages</sub>

</td>
<td align="center" width="16%">

**35**
<br/>
<sub>NPM Packages</sub>

</td>
<td align="center" width="16%">

**43**
<br/>
<sub>Edge Functions</sub>

</td>
<td align="center" width="16%">

**234**
<br/>
<sub>SQL Migrations</sub>

</td>
</tr>
<tr>
<td align="center">

**14**
<br/>
<sub>Pipeline Agents</sub>

</td>
<td align="center">

**11**
<br/>
<sub>Inbound Adapters</sub>

</td>
<td align="center">

**13**
<br/>
<sub>Outbound Plugins</sub>

</td>
<td align="center">

**3**
<br/>
<sub>Apps</sub>

</td>
<td align="center">

**3**
<br/>
<sub>QA Providers</sub>

</td>
<td align="center">

**pnpm 10**
<br/>
<sub>Monorepo</sub>

</td>
</tr>
</table>

---

## Try it

```bash
npx mushi-mushi
```

The wizard auto-detects your framework (Next.js / Nuxt / SvelteKit / Angular / Expo / Capacitor / plain React, Vue, Svelte / vanilla JS), installs the right SDK, writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` to `.env.local`, and prints the snippet to paste in. Equivalent commands:

```bash
npm create mushi-mushi              # via the npm-create convention
npx @mushi-mushi/cli init           # the scoped name
```

Or install directly if you already know which SDK you want:

```bash
npm install @mushi-mushi/react      # also covers Next.js
```

```tsx
import { MushiProvider } from '@mushi-mushi/react';

function App() {
  return (
    <MushiProvider
      config={{
        projectId: 'proj_xxx',
        apiKey: 'mushi_xxx',
        // v2.1 — opt in to passive inventory discovery (off by default).
        // Routes, testids, and outbound API paths flow into the proposer
        // so Claude can draft an inventory.yaml for you to accept.
        capture: { discoverInventory: true },
      }}
    >
      <YourApp />
    </MushiProvider>
  );
}
```

Your users now have a shake-to-report widget. Reports land in your admin console, classified within seconds — and (with `discoverInventory`) your inventory drafts itself from the same stream.

<details>
<summary><b>Other frameworks</b> — Vue, Svelte, Angular, React Native, Vanilla JS, iOS, Android</summary>

#### Vue 3 / Nuxt

```ts
import { MushiPlugin } from '@mushi-mushi/vue';
app.use(MushiPlugin, { projectId: 'proj_xxx', apiKey: 'mushi_xxx' });
```

#### Svelte / SvelteKit

```ts
import { initMushi } from '@mushi-mushi/svelte';
initMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });
```

#### Angular 17+

```ts
import { provideMushi } from '@mushi-mushi/angular';
bootstrapApplication(AppComponent, {
  providers: [provideMushi({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' })],
});
```

#### React Native / Expo

```tsx
import { MushiProvider } from '@mushi-mushi/react-native';
<MushiProvider projectId="proj_xxx" apiKey="mushi_xxx">
  <App />
</MushiProvider>;
```

#### Vanilla JS / any framework

```ts
import { Mushi } from '@mushi-mushi/web';
Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });
```

#### iOS (Swift Package Manager — v0.4.0)

```swift
.package(url: "https://github.com/kensaurus/mushi-mushi.git", from: "0.4.0")
import Mushi
Mushi.configure(projectId: "proj_xxx", apiKey: "mushi_xxx")
```

#### Android (Maven — v0.4.0)

```kotlin
dependencies {
  implementation("dev.mushimushi:mushi-android:0.4.0")
}
Mushi.init(context = this, config = MushiConfig(projectId = "proj_xxx", apiKey = "mushi_xxx"))
```

</details>

> Want a runnable example? [`examples/react-demo`](./examples/react-demo) is a minimal Vite + React app with test buttons for dead clicks, thrown errors, failed API calls, and console errors.

---

## Tour the rooms

A quick look at where you'll spend your time. Every panel is a click-through to the live demo.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://kensaur.us/mushi-mushi/admin/dashboard" title="Open the live dashboard">
        <img alt="Dashboard — PDCA cockpit with PLAN / DO / CHECK / ACT pills along the top, the bug-fix loop summary, the next action callout, and the project setup checklist." src="./docs/screenshots/dashboard-dark.png" width="100%">
      </a>
      <br>
      <sub><b>Dashboard</b> · the PDCA cockpit — PLAN / DO / CHECK / ACT in one row, the next action explained in plain English, and the setup checklist that moves itself off-screen once you finish</sub>
    </td>
    <td width="50%" align="center">
      <a href="https://kensaur.us/mushi-mushi/admin/inventory" title="Open the live inventory">
        <img alt="User stories · Inventory — the new v2 positive-side surface. Truth layer summary across the top, then per-story cards with verified / unwired / regressed counts and a Run gates button." src="./docs/screenshots/inventory-dark.png" width="100%">
      </a>
      <br>
      <sub><b>User stories · Inventory</b> · the new v2 positive surface — every user-facing action grouped under its story, with verified / unwired / regressed counts and one-click <i>Run gates</i> / <i>Run crawler</i> from the row</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://kensaur.us/mushi-mushi/admin/graph" title="Open the live knowledge graph">
        <img alt="Knowledge graph — Bug graph view with quick-view filters (All / Regressions / Fragile components / Fix coverage), 12 node types, 19 edge types, and Graph / Surface / Table tabs in the upper-right." src="./docs/screenshots/graph-dark.png" width="100%">
      </a>
      <br>
      <sub><b>Knowledge graph</b> · component / page / release adjacency weighted by bug incidence — toggle <i>Surface</i> to overlay the positive inventory and see the dead corners</sub>
    </td>
    <td width="50%" align="center">
      <a href="https://kensaur.us/mushi-mushi/admin/graph" title="Open graph in Surface mode">
        <img alt="Graph in Surface mode — the same knowledge graph with the positive inventory (Page (inventory), User story, Element, Action node types) overlaid; subtitle reads SURFACE - INVENTORY OVERLAY · 83/119 nodes · 110/114 edges." src="./docs/screenshots/graph-surface-dark.png" width="100%">
      </a>
      <br>
      <sub><b>Graph · Surface mode</b> · v2 — the same canvas, but every Page / Element / Action from <code>inventory.yaml</code> overlaid on the live knowledge graph so the dead corners light up</sub>
    </td>
  </tr>
</table>

For the full screenshot tour (28 surfaces, every page in the console) see [`docs/SCREENSHOTS.md`](./docs/SCREENSHOTS.md).

---

## How the loop runs

When a user shakes their phone, four things happen in roughly the order you'd expect a careful colleague to do them:

1. **Capture.** The widget grabs the screenshot, the route, the user's note, the last few console + network events, and the device context. Everything they were doing, plus everything that broke.
2. **Classify.** A two-stage LLM pipeline (Haiku fast-filter → Sonnet deep + vision) tags severity, category, and root-cause hint in plain English. A nightly Sonnet judge scores the classifier's own work and feeds a prompt-A/B loop, so the labels you see come from prompts that have earned their place.
3. **Connect.** The report embeds into a knowledge graph (Postgres + pgvector). The same broken button reported twenty times shows up as one row, not twenty.
4. **Fix.** _Optional._ You click _Dispatch fix_ (or wire the same action from Slack — the bot posts a threaded status reply once the PR is open), MCP, or CI) and an agent in a sandbox tries the change, runs your tests, and opens a draft PR. You review it like any other PR — and merge, change, or close it.

The architecture, sequence diagram, and component-by-component spec live in [`apps/docs/content/concepts/architecture.mdx`](./apps/docs/content/concepts/architecture.mdx). A condensed wire diagram:

```mermaid
flowchart LR
    subgraph App["Your app"]
        SDK["mushi-mushi/{react, vue, svelte, angular, …}<br/>shadow-DOM widget · screenshot · console · network"]
    end
    subgraph Edge["Supabase Edge Functions"]
        API["api"]
        FF["fast-filter"]
        CR["classify-report<br/>+ vision + RAG"]
        ORCH["fix-dispatch"]
    end
    subgraph DB["Postgres + pgvector"]
        REP["reports"]
        KG["knowledge graph"]
        FIX["fix_attempts"]
    end
    subgraph Agents["mushi-mushi/agents"]
        SBX["sandbox: e2b / modal / cloudflare"]
        GH["GitHub PR"]
    end
    SDK -->|HTTPS| API
    API --> FF --> CR
    CR --> KG
    CR --> REP
    REP --> ORCH --> Agents
    Agents --> GH
```

---

## What you get on day one

- **You see one report per actual bug, not twenty.** Dedup runs against the knowledge graph, so the same broken button collapses across users and devices.
- **Your queue is already triaged.** Severity, category, and a one-line root-cause hint are there before you click in.
- **Your users get a way to tell you.** A 14 KB shake-to-report widget that doesn't pretend to be a chat bot and doesn't ask them to write a ticket.
- **Your auto-fix is opt-in and reviewable.** The agent opens a _draft_ PR. You merge it, edit it, or close it — the loop never bypasses you.
- **Your existing tools keep working.** Mushi sits next to Sentry; it does not replace it. Sentry breadcrumbs flow into Mushi's classifier, and Mushi reports flow back as Sentry User Feedback if you want them to.

---

## Launcher modes

The SDK ships four ways to surface the bug reporter — choose the one that fits your app's layout:

| Mode | `trigger` value | When to use |
|---|---|---|
| **Header banner** _(recommended)_ | `banner` | A slim 36 px strip pinned to the top (or bottom) of the viewport. Three visual variants: `neon` (electric-lime), `brand` (vermillion), `subtle` (hairline). Body content is nudged down automatically; the offset is removed on dismiss. |
| **Floating stamp (FAB)** | `auto` | The default pill button in the bottom-right corner. Good for greenfield apps with no bottom navigation bar. |
| **Edge tab** | `edge-tab` | A vertical tab on the viewport edge — useful on tablet or dense desktop layouts. |
| **Attach to your button** | `attach` | Binds to any element you nominate via `attachToSelector`. The SDK renders no launcher of its own. |
| **Headless / manual** | `manual` / `hidden` | No launcher at all — call `Mushi.open()` programmatically from your own help menu or keyboard shortcut. |

**Banner quick start**

```js
Mushi.init({
  apiKey: 'mushi_…',
  widget: {
    trigger: 'banner',
    bannerConfig: {
      variant: 'brand',   // 'neon' | 'brand' | 'subtle'
      position: 'top',    // 'top' | 'bottom'
      bugCta: '🐛 Report a bug',
      featureCta: true,
    },
  },
})
```

Configure the launcher and preview the snippet live in the admin console under **SDK Install → Launcher**.

## Headless SDK integration

By default the SDK injects a floating 🐛 stamp button. For the `attach` or `manual` modes, use the headless primitives:

### React — `MushiTrigger`

```tsx
import { MushiTrigger } from '@mushi-mushi/react'

// Any element: button, anchor, div, custom component
<MushiTrigger as="button" category="bug" className="my-feedback-btn">
  Report a bug
</MushiTrigger>

// With Radix / shadcn
<MushiTrigger as={Button} variant="ghost" size="sm">
  Feedback
</MushiTrigger>
```

All native props are forwarded. The `onClick` chain is preserved — if the host button calls `e.preventDefault()` Mushi will not open.

### React — `MushiAttach`

Attach the reporter to an element you can't wrap (third-party widget, portal):

```tsx
import { MushiAttach } from '@mushi-mushi/react'

// Renders nothing — just wires the click listener
<MushiAttach selector="#help-button" category="bug" />
```

### React Native — `MushiTrigger`

```tsx
import { MushiTrigger } from '@mushi-mushi/react-native'

<MushiTrigger>
  <Pressable style={styles.btn}>
    <Text>Report a bug</Text>
  </Pressable>
</MushiTrigger>
```

### SDK Install Card

The admin console's **SDK Install** page (Get started → Configure & install the SDK) has a five-option **Trigger mode** chooser: Header banner (recommended), Attach to my button, Floating stamp, Edge tab, and Headless (manual). The snippet preview updates in real time to show the correct import and usage pattern.

---

## QA Coverage Suite

Define user-story tests as prompts or Playwright scripts and schedule them to run automatically.

### Quick start

1. Go to **Check → QA Coverage** in the sidebar.
2. Click **+ New story** and describe the test in natural language.
3. Pick a provider (Firecrawl by default — no API key needed).
4. The story runs hourly and results appear on the page and the Dashboard tile.

### Providers

| Provider | Requirements | Best for |
|----------|-------------|---------|
| `firecrawl_actions` | None (default) | Content verification, navigation checks, link health |
| `browserbase` | `BYOK_BROWSERBASE_API_KEY` in project settings | Complex UI interactions, JavaScript-heavy SPAs |
| `local` | CLI runner (`mushi-dev run-qa-stories`) | Full Playwright access, local-only environments |

### Connecting to user stories

When you click **Generate test from report** on a report, Mushi writes a Playwright script, opens a GitHub PR, and automatically creates a QA story for it — scheduled weekly as a regression guard.

### BYOK (Bring Your Own Key)

Story runners use your own API keys stored in `mushi_runtime_config`. No key → story is skipped with a clear reason. Key resolution order: project-level override → org-level override → Mushi platform default (Firecrawl only).

### Dashboard integration

The **QA Coverage** tile on `/dashboard` shows: total stories, % passing (≥80% pass rate), and the top failing story. Click "View all →" to open the full `/qa-coverage` page.

### A2A failure notifications

If a story fails and your project has an A2A endpoint configured, `qa-story-runner` pushes a structured failure notification to connected agents (Cursor, Claude Code, etc.) via the A2A protocol.

---

## Multi-platform console

### Filtering reports by platform / SDK

The Reports list (`/reports`) has **Platform** and **SDK** filter dropdowns. Options: iOS, Android, Web, macOS, Windows (platform); Web, React, React Native, Capacitor (SDK package). Selecting a value appends `?platform=ios` (or `?sdk_package=@mushi-mushi/react-native`) to the URL for shareability.

### Device & Build panel

Each report detail page shows a **Device & Build** section with:
- `platform` — iOS / Android / Web / …
- `sdk_package` — `@mushi-mushi/react`, `@mushi-mushi/react-native`, etc.
- `sdk_version` — the SDK version that filed the report
- `app_version` — the app's own version string (if provided)

### Platform Health dashboard tile

The **Platform Health · 24h** tile on `/dashboard` shows report volume, error counts, and SDK version list per platform, sourced from the `qa_platform_rollup_24h` materialized view (refreshed hourly). Click any row to drill into `/reports?platform=<platform>`.

---

## Operator-grade plumbing

Mushi is the _intermediary_. We deliberately avoid replicating Sentry / Datadog / Firebase — instead we ship the boring-but-essential standards that let those tools talk to each other through one console, with one audit trail, and one consistent agent-facing API.

| Standard                                                                                                                               | Where it shows up                                                                                                                                                                                                                            | Why you care                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W3C `traceparent`**                                                                                                                  | SDK → `api` → `fix-worker` → outbound webhooks → MCP. Every hop emits and propagates the spec-compliant header.                                                                                                                              | Your existing Datadog / Honeycomb / Tempo trace can follow a user-felt bug from the widget tap all the way through the draft PR — no proprietary "Mushi-Trace-Id". |
| **OTLP/HTTP+JSON exporter (BYOK)**                                                                                                     | Edge functions ship spans straight to your collector when `OTLP_EXPORTER_URL` is set.                                                                                                                                                        | Zero markup, zero lock-in. Mushi never charges per span — you point it at your own collector and pay your APM vendor directly.                                     |
| **Standard Webhooks** ([standardwebhooks.com](https://www.standardwebhooks.com/))                                                      | Every outbound delivery includes `webhook-id` / `webhook-timestamp` / `webhook-signature: v1,<hmac>`.                                                                                                                                        | Receivers can use any off-the-shelf Standard Webhooks library to verify signatures — you don't have to write Mushi-specific signing code.                          |
| **Idempotency-Key** ([IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/))                        | Every mutating `/v1/admin/*` endpoint accepts `Idempotency-Key`. Replays return the cached response keyed by `(user_id, key)`.                                                                                                               | Safe retries from flaky CI / mobile networks. The key is tenant-scoped so a malicious user can't poison another's cache.                                           |
| **OAuth 2.0 RFC 7591 Dynamic Client Registration**                                                                                     | `POST /v1/admin/auth/register` issues an API key with the right scopes for an orchestrator to self-onboard, audit-logged as `api_key.created`.                                                                                               | LangGraph / CrewAI / OpenAI Agents SDK / your-internal-tool can register themselves without a human in the loop.                                                   |
| **Last-Event-Id SSE replay**                                                                                                           | `GET /v1/a2a/tasks/:id:subscribe` and AG-UI streams honor `Last-Event-ID` to replay missed events.                                                                                                                                           | A flaky orchestrator network never silently drops a task transition.                                                                                               |
| **A2A v1.0.0 PushNotificationConfig**                                                                                                  | `POST /v1/a2a/tasks` body accepts `configuration.pushNotificationConfig = { url, token? }`. A Postgres trigger fans out signed POSTs on every state change to `a2a-push-notify`.                                                             | Pull (SSE) _and_ push are both supported. Your orchestrator never has to hold a long-lived connection open.                                                        |
| **Integration Health Probe**                                                                                                           | `pg_cron` job calls every BYOK integration every 15 minutes; `GET /v1/admin/integrations/health` and the admin Integrations page surface status chips.                                                                                       | You catch a rotated Anthropic key or a broken Slack bot token before users do.                                                                                     |
| **Closed-loop plugin dispatch**                                                                                                        | `fix-worker` fires `fix.proposed` when it opens a draft PR; the GitHub merge webhook fires `fix.applied` exactly once per merge (idempotent via `is(merged_at, null)`).                                                                      | The Sentry issue auto-resolves the moment Mushi merges its fix; Jira / Linear / Bugsnag / Rollbar / Crashlytics tickets transition through the same event stream.  |
| **Regression auto-triage**                                                                                                             | When the status reconciler flips an action from `verified` → `regressed`, it pages the operator (Slack/Discord), opens a triage report, and fans `report.created` to plugins.                                                                | A regressed action funnels straight back through the same PDCA loop as a real user-shaken-phone report — no waiting for someone to refresh `/inventory`.           |
| **Webhook delivery exhaustion alerts**                                                                                                 | After 5 retries (30s + 2m + 10m + 1h + 6h backoff) `plugin-dispatch-retry` pages the operator with the dead webhook + last error, deduped per `(project, plugin)` per tick.                                                                  | A plugin with a rotated token announces itself in chat instead of silently dropping every fix notification for hours.                                              |
| **OpenTelemetry GenAI semconv attributes**                                                                                             | OTLP spans for `classify-report` carry `gen_ai.operation.name` / `gen_ai.provider.name` / `gen_ai.request.model` / `gen_ai.response.model` / `gen_ai.usage.input_tokens` / `output_tokens` / `cache_*` and a custom `gen_ai.usage.cost_usd`. | Your APM (Honeycomb / Datadog / Tempo / SignalFx) graphs cost-per-report and tokens-per-model out of the box without a Mushi-specific dashboard.                   |
| **Spec-validation soft warnings on the Fixes page**                                                                                    | `fix_attempts.spec_validation_warnings` (written by `validateAgainstSpec()`) renders as a `Spec N` count chip + per-warning detail block on every fix card; a 30-day count appears as a 6th tile on the summary row when non-zero.           | Reviewers see early warnings ("the diff didn't touch the contract's table or the action's page route") before clicking Merge, instead of after the regression.     |
| **Synthetic-eval feedback loop**                                                                                                       | `generate-synthetic` re-classifies every freshly inserted row through the live stage2 prompt (Haiku, BYOK), populates `actual_classification` + `match_score` (0..1, 2-decimal).                                                             | The Prompt Lab "match score" column shows real numbers — you can A/B-test a prompt change and see whether synthetic accuracy went up or down.                      |
| **MCP Streamable HTTP** (2025-03-26 spec)                                                                                              | `/functions/v1/mcp`. Both stdio (local IDE) and HTTP (remote orchestrator) transports advertise the same tool catalog.                                                                                                                       | One MCP server, two transports, every modern AI client supported.                                                                                                  |
| **MCP `inventory://current` resource**                                                                                                 | Live snapshot via Realtime subscription — the resource updates without polling whenever the inventory changes.                                                                                                                               | Cursor / Claude Code see the current `inventory.yaml` truth without round-tripping the database.                                                                   |
| **Agent Card** (`/.well-known/agent-card`, schemaVersion 1.0) + **OpenAPI 3.1** (`/openapi.json`) + **JSON Schemas** (`/v1/schemas/*`) | Discovery surface every spec-following agent expects.                                                                                                                                                                                        | Your orchestrator finds Mushi the same way it finds anything else.                                                                                                 |

> **BYOK throughout.** Mushi never holds your Anthropic / OpenAI / Sentry / Slack / Jira keys for billing leverage. Bring your own; rotate them in your own dashboard. The Integration Health Probe tells us (and you) the moment something rotated out from under us.

---

## Where it stops

Mushi is honest about what's still partial. Skim before you commit:

| Area                 | Working                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Still partial                                                                                                                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification       | Haiku fast-filter, Sonnet deep + **vision air-gap closed**, structured outputs, prompt-cached prompts, `pg_cron` self-healing, **Stage 2 streaming via `streamObject` with progressive `reports.stage2_partial` UI updates and OpenAI fallback**                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                 |
| Judge / self-improve | Sonnet judge with **OpenAI fallback**, prompt A/B auto-promotion via `judge → avg_judge_score → promoteCandidate`, **OpenAI fine-tune adapter end-to-end** (submit JSONL → poll → predict against `fine_tuned_model_id`, BYOK `OPENAI_API_KEY`), **Bedrock fine-tune adapter** (SigV4-signed `CreateModelCustomizationJob`, requires `MUSHI_BEDROCK_FINETUNE_ENABLED=1` + AWS BYOK keys) | Anthropic fine-tune API is not publicly self-service in 2026 — the adapter stub links to the access-request form. |
| Fix orchestrator     | Single-repo `validateResult` gating, GitHub PR, **MCP JSON-RPC 2.0** client, multi-repo coordinator, **first-party `ClaudeCodeAgent` (spawns local `claude` CLI)** and **`CodexAgent` (OpenAI Responses API, BYOK)** — both gated behind explicit env flags so shared deployments never invoke them unintentionally                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                 |
| Sandbox              | Provider abstraction; `local-noop` (tests) + `e2b` / `modal` / `cloudflare` (prod). Production refuses `local-noop` unless `MUSHI_ALLOW_LOCAL_SANDBOX=1`.                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                 |
| Verify               | Playwright screenshot diff + step interpreter (`navigate` / `click` / `type` / `press` / `select` / `assertText` / `waitFor` / `observe`)                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                 |
| Enterprise           | Plugin marketplace + HMAC, audit ingest, region pinning, retention CRUD, Stripe metering, **SAML SSO via Supabase Auth Admin API**, **OIDC SSO self-service** (Client ID / Secret / Issuer URL form → GoTrue `/admin/custom-providers`; falls back to `manual_required` + HTTP 202 where the GoTrue version doesn't support OIDC yet) | — |
| Graph backend        | SQL adjacency over `graph_nodes` / `graph_edges` ships in every deployment                                                                                                                                                                                                                                                                                                                                                                                                 | Apache AGE is a hosted-tier enhancement when the extension is installed (self-hosted Postgres 16 or Supabase Enterprise). Managed Supabase stays on SQL adjacency.                                                                                                                                                |
| Inventory v2         | Hand-written `inventory.yaml`, SDK-driven discovery (`capture.discoverInventory`), Claude proposer, ESLint rules `no-dead-handler` + `no-mock-leak`, 5-gate composite GitHub check, synthetic monitor with explicit mutation opt-in **toggle in the Settings UI** (fail-closed by default), **Surface** mode in the graph, **`expected_outcome` contract end-to-end**, **first-run three-step walkthrough** when inventory is empty | Inventory is gated behind _Advanced mode_ + the `inventory_v2` plan flag — both must be active for the nav item to appear. |
| Orchestrator interop | **MCP Streamable HTTP** at `/functions/v1/mcp` (2025-03-26 spec), **A2A v1.0.0 tasks + PushNotificationConfig** at `/v1/a2a/tasks` (pull via SSE _and_ push via signed webhook on every status change), **OpenAPI 3.1** at `/openapi.json`, AG-UI v0.4 SSE accepts API keys (`mcp:read`), `SandboxProvider` is an open contract with a third-party registry, JSON Schemas for `FixContext` / `FixResult` / `SandboxProvider` / `ExpectedOutcome` served at `/v1/schemas/*` | —                                                                                                                                                                                                                                                                                                                 |
| Self-host (Helm)     | Single-pod deploy on any Kubernetes; pre-install Job applies all SQL migrations from a bundled ConfigMap synced via `pnpm sync:helm-migrations`. **Multi-region**: `global.region` + `global.peerRegions` Helm values inject `MUSHI_CLUSTER_REGION` / `MUSHI_PEER_REGIONS`; see `SELF_HOSTED.md` "Running multi-region" for logical replication and DNS setup. | Full active/active write replication is not automated yet — `region_routing` replicates read-only; write routing relies on client-side region stickiness. |

The orchestrator **refuses to run `local-noop` in production** unless you explicitly set `MUSHI_ALLOW_LOCAL_SANDBOX=1`. Pick `e2b` (or implement `SandboxProvider` yourself) before exposing autofix to production traffic.

---

## Where Mushi fits

Every team we talk to already runs three kinds of monitoring. Mushi is the fourth layer none of them cover.

| Signal                 | Typical tools                          | What they miss                                                        |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Code-thrown errors     | Sentry, Crashlytics, Bugsnag, Rollbar  | Bugs that don't throw — dead buttons, janky scroll, 12-second screens |
| System telemetry       | Datadog, New Relic, Honeycomb, Grafana | The user's perspective on what that latency spike felt like           |
| Product analytics      | Firebase Analytics, PostHog, Amplitude | _Why_ a funnel step was abandoned, in the user's own words            |
| **User-felt friction** | **nothing → Mushi**                    | —                                                                     |

Mushi is the **synthesis layer**, not a replacement. It adds the one signal that's missing, and ingests the others so a single classified bug row can carry everything at once: the stack trace from Crashlytics, the latency spike from Datadog, the funnel drop from Firebase, AND the user's screenshot and note.

### Compared to each tool you already have

|                              | Sentry / Crashlytics        | Datadog / New Relic       | Firebase / Amplitude    | **Mushi Mushi**                               |
| ---------------------------- | :-------------------------- | :------------------------ | :---------------------- | :-------------------------------------------- |
| **Signal origin**            | Code throws                 | Infrastructure metrics    | User event streams      | User-felt friction, captured in the moment    |
| **What lands in your queue** | Stack trace                 | Alert threshold breach    | Funnel drop-off         | User note + screenshot + device context       |
| **Repeat signal**            | Same error = separate issue | Spike repeats → new alert | Conversion drops again  | Same broken button collapses to one row       |
| **Closing the loop**         | Assign a ticket             | Write a runbook           | A/B test the conversion | Optional draft PR you merge, edit, or close   |
| **From your IDE**            | Paste issue ID into Cursor  | —                         | —                       | Cursor reads the report and proposes the diff |
| **Where it runs**            | Their cloud                 | Their cloud               | Google cloud            | Yours, ours, or both                          |

Mushi is already wired to send signals **back** to the tools you run — 13 outbound plugins covering Sentry, Slack, Jira, Linear, PagerDuty, Discord, Microsoft Teams, GitHub Issues, Bugsnag, Rollbar, Crashlytics, Zapier, and Cursor Cloud — and to **receive** alerts from 11 inbound sources (Sentry, Datadog, Bugsnag, Rollbar, Crashlytics, New Relic, Honeycomb, Grafana Loki, AWS CloudWatch, Opsgenie, Firebase Analytics) via [`@mushi-mushi/adapters`](./packages/adapters). You don't replace anything; you add the layer that completes the picture.

The marketing landing at [`kensaur.us/mushi-mushi/`](https://kensaur.us/mushi-mushi/) walks the full integration story.

---

## Run it

**Hosted (zero-config).** Sign up at [`kensaur.us/mushi-mushi/`](https://kensaur.us/mushi-mushi/), click _Start free, no card_, create a project, and copy your `projectId` + `apiKey`. The free tier covers 1,000 reports a month.

**Self-hosted.** A single Docker Compose file gets you a working stack against your own Supabase project:

```bash
cd deploy
cp .env.example .env   # ANTHROPIC_API_KEY, Supabase creds
docker compose up -d
```

[`SELF_HOSTED.md`](./SELF_HOSTED.md) is the long-form guide. A production-ready **Helm chart** lives at [`deploy/helm/`](./deploy/helm/README.md) — pre-install `Job` applies all 234 SQL migrations from a bundled ConfigMap (`pnpm sync:helm-migrations` keeps it fresh; CI guards drift). One `helm install` on any cluster.

> **Internal edge functions** (`fast-filter`, `classify-report`, `fix-worker`, `judge-batch`, `intelligence-report`, `usage-aggregator`, `soc2-evidence`, `generate-synthetic`) authenticate via the shared `requireServiceRoleAuth` middleware. Never expose them with `--no-verify-jwt` in production. Only the public `api` function should face the internet — see [`packages/server/README.md`](./packages/server/README.md#internal-caller-authentication-sec-1).

---

## Cursor & Claude Skills

Install Mushi skills in your Cursor or Claude Code project for one-command setup, usage, and debugging:

```bash
# Install both Mushi skills at once
npx skills add kensaurus/mushi-mushi

# Or individually
npx skills add kensaurus/mushi-mushi/mushi-mushi   # Setup, config & TDD usage
npx skills add kensaurus/mushi-mushi/mushi-debug   # Debug & fix issues
```

Then in Cursor/Claude:
- `/mushi-mushi` — guided setup, configuration, and TDD workflow
- `/mushi-debug` — diagnose and fix issues

## Packages

Most developers only install **one** SDK package — `npx mushi-mushi` picks the right one for you and pulls in `core` and `web` automatically.

| Install                               | Framework                       | What you get                                                                                                                                                                               |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx mushi-mushi`                     | **Any** (auto-detects)          | One-command wizard — installs the right SDK, writes env vars, prints the snippet                                                                                                           |
| `npm i @mushi-mushi/react`            | React / Next.js                 | `<MushiProvider>`, `useMushi()`, `<MushiErrorBoundary>`                                                                                                                                    |
| `npm i @mushi-mushi/vue`              | Vue 3 / Nuxt                    | `MushiPlugin`, `useMushi()` composable, error handler                                                                                                                                      |
| `npm i @mushi-mushi/svelte`           | Svelte / SvelteKit              | `initMushi()`, SvelteKit error hook                                                                                                                                                        |
| `npm i @mushi-mushi/angular`          | Angular 17+                     | `provideMushi()`, `MushiService`, error handler                                                                                                                                            |
| `npm i @mushi-mushi/react-native`     | React Native / Expo             | Shake-to-report, bottom-sheet widget, navigation capture, offline queue                                                                                                                    |
| `npm i @mushi-mushi/capacitor`        | Capacitor / Ionic               | iOS + Android via Capacitor                                                                                                                                                                |
| `pub add mushi_mushi`                 | Flutter / Dart                  | Shake-to-report, screenshot capture, offline queue — iOS + Android + Web                                                                                                                   |
| Swift PM `.package(url:…)`            | iOS (Swift)                     | Native shake-to-report, breadcrumbs, proactive triggers, PII scrubbing — v0.4.0                                                                                                            |
| Gradle `dev.mushimushi:mushi-android` | Android (Kotlin/Java)           | Native shake-to-report, breadcrumbs, proactive triggers, PII scrubbing — v0.4.0                                                                                                            |
| `npm i @mushi-mushi/web`              | Vanilla / any framework         | Framework-agnostic SDK                                                                                                                                                                     |
| `npm i @mushi-mushi/node`             | Node (Express / Fastify / Hono) | Server-side SDK — error-handler middleware, `uncaughtException` hook                                                                                                                       |
| `npm i @mushi-mushi/adapters`         | Any Node webhook server         | Translate alerts from **11 sources** into Mushi reports — Sentry, Datadog, Bugsnag, Rollbar, Crashlytics, New Relic, Honeycomb, Grafana Loki, AWS CloudWatch, Opsgenie, Firebase Analytics |

<details>
<summary><b>Internal &amp; backend packages</b></summary>

| Package                                                                  | Purpose                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@mushi-mushi/core`](./packages/core)                                   | Shared engine — types, API client, PII scrubber, offline queue, rate limiter, **v2.1 `discoverInventory` types**                                                                                                                                                                           |
| [`@mushi-mushi/cli`](./packages/cli)                                     | CLI for project setup, report listing, triage                                                                                                                                                                                                                                              |
| [`@mushi-mushi/mcp`](./packages/mcp)                                     | MCP server — Cursor / Copilot / Claude read, triage, classify, dispatch fixes. **Both stdio (local) and Streamable HTTP (`/functions/v1/mcp`, hosted) transports per the 2025-03-26 spec.** Discoverable via `/.well-known/agent-card`, `/openapi.json`, and `/v1/a2a/tasks` (A2A v1.0.0). |
| [`@mushi-mushi/mcp-ci`](./packages/mcp-ci)                               | GitHub Action — `gates`, `discover-api`, `discovery-status`, `propose`, `auth-bootstrap` (the v2 pre-release suite + new MCP CLI)                                                                                                                                                          |
| [`@mushi-mushi/inventory-schema`](./packages/inventory-schema)           | **v2 source of truth** — Zod + JSON Schema for `inventory.yaml`, used by the admin ingester, gate runner, LLM proposer, and GitHub Action                                                                                                                                                  |
| [`eslint-plugin-mushi-mushi`](./packages/eslint-plugin-mushi-mushi)      | **v2 gate rules** — `no-dead-handler` (empty `onClick` etc.) and `no-mock-leak` (faker / "John Doe" arrays in non-test paths). Ships a `recommended` preset                                                                                                                                |
| [`@mushi-mushi/inventory-auth-runner`](./packages/inventory-auth-runner) | **v2 helper** — `npx mushi-mushi-auth refresh` runs the `inventory.yaml` `auth.scripted` Playwright block and seeds the resulting cookies into `project_settings` so the crawler + synthetic monitor can hit auth-gated routes                                                             |
| [`@mushi-mushi/plugin-sdk`](./packages/plugin-sdk)                       | Build third-party plugins — signed webhook verification, REST callback, retry + validate helpers                                                                                                                                                                                           |
| [`@mushi-mushi/plugin-jira`](./packages/plugin-jira)                     | Bidirectional Mushi ↔ Jira Cloud sync                                                                                                                                                                                                                                                      |
| [`@mushi-mushi/plugin-slack-app`](./packages/plugin-slack-app)           | First-class Slack app — `/mushi` slash command                                                                                                                                                                                                                                             |
| [`@mushi-mushi/plugin-linear`](./packages/plugin-linear)                 | Create + sync Linear issues                                                                                                                                                                                                                                                                |
| [`@mushi-mushi/plugin-pagerduty`](./packages/plugin-pagerduty)           | Page on-call via PagerDuty when a critical bug is reported                                                                                                                                                                                                                                 |
| [`@mushi-mushi/plugin-zapier`](./packages/plugin-zapier)                 | Fan out any Mushi event to a Zapier-style incoming webhook                                                                                                                                                                                                                                 |
| [`@mushi-mushi/plugin-sentry`](./packages/plugin-sentry)                 | Mirror critical user-reported bugs into Sentry; resolves the Sentry fingerprint when Mushi applies a fix                                                                                                                                                                                   |
| [`@mushi-mushi/plugin-discord`](./packages/plugin-discord)               | Post critical Mushi events into a Discord channel via embed messages                                                                                                                                                                                                                       |
| [`@mushi-mushi/plugin-msteams`](./packages/plugin-msteams)               | Post adaptive cards into a Microsoft Teams channel for on-call handoff                                                                                                                                                                                                                     |
| [`@mushi-mushi/plugin-github-issues`](./packages/plugin-github-issues)   | File user-reported bugs as GitHub Issues with labels, assignees, and Mushi backlinks                                                                                                                                                                                                       |
| [`@mushi-mushi/plugin-bugsnag`](./packages/plugin-bugsnag)               | Mirror Mushi reports into Bugsnag projects; close Bugsnag errors when Mushi applies a fix                                                                                                                                                                                                  |
| [`@mushi-mushi/plugin-rollbar`](./packages/plugin-rollbar)               | Mirror Mushi reports into Rollbar; resolve Rollbar items on fix merge                                                                                                                                                                                                                      |
| [`@mushi-mushi/plugin-crashlytics`](./packages/plugin-crashlytics)       | Push Mushi reports into Firebase Crashlytics issues; close on fix                                                                                                                                                                                                                          |
| [`@mushi-mushi/plugin-cursor-cloud`](./packages/plugin-cursor-cloud)     | Dispatch fix jobs to Cursor Cloud agents; opens draft PRs from classified reports                                                                                                                                                                                                            |
| `@mushi-mushi/server` (BSL 1.1)                                          | Edge functions — classification pipeline, knowledge graph, fix dispatch + SSE, RAG indexer                                                                                                                                                                                                 |
| `@mushi-mushi/agents` (BSL 1.1)                                          | Agentic fix orchestrator — `validateResult` gating, GitHub PR creation, sandbox abstraction                                                                                                                                                                                                |
| `@mushi-mushi/verify` (BSL 1.1)                                          | Playwright fix verification — screenshot visual diff + step interpreter                                                                                                                                                                                                                    |

</details>

---

## Contributing

Issues and PRs welcome. To get started:

```bash
git clone https://github.com/kensaurus/mushi-mushi.git
cd mushi-mushi
pnpm install
pnpm dev
```

Requires Node.js ≥ 22 and pnpm ≥ 10. See individual package READMEs for setup, [`docs/stats.md`](./docs/stats.md) for canonical repo counts, [`docs/`](./docs/) for handover notes (newest first), and [`docs/SCREENSHOTS.md`](./docs/SCREENSHOTS.md) for the full admin tour.

```bash
pnpm docs-stats        # print canonical README / server / integration stats
pnpm check:docs-stats  # fail if README counts drift from source
```

## License & branding

This repository is dual-licensed because the **code** is open source but
the **brand** is not. The split is what lets us welcome forks while
making it hard for bad actors to ship a malicious copy under our name.

| Surface                                                                                                                                                                                                                                                                                                          | License                              | Permitted                                              | Notes                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK packages — `core`, `web`, `react`, `vue`, `svelte`, `angular`, `react-native`, `capacitor`, `flutter`, `ios`, `android`, `node`, `cli`, `mcp`, `mcp-ci`, `plugin-*` (13 plugins), `adapters` (11 sources), `inventory-schema`, `inventory-auth-runner`, `eslint-plugin-mushi-mushi`, `brand`, `marketing-ui` | [MIT](./LICENSE)                     | Use, fork, sell, embed in proprietary products.        | Trademarks separate — see below.                                                                                                               |
| Server packages — `@mushi-mushi/server`, `@mushi-mushi/agents`, `@mushi-mushi/verify`                                                                                                                                                                                                                            | [BSL 1.1](./packages/server/LICENSE) | Self-host for your own org. Modify. Resell embedded.   | Cannot offer as a hosted bug-reporting service to third parties until **2029-04-15**, when it converts to Apache 2.0 automatically.            |
| Trademarks — "Mushi Mushi", "Mushi", 虫, the bug logo, the visual identity                                                                                                                                                                                                                                       | [Trademark policy](./TRADEMARK.md)   | Refer to the project, build add-ons, link to the repo. | **Forks must rename.** Hosting a service under the Mushi name requires written permission. Use on malware / phishing kits is enforced against. |
| Third-party attributions                                                                                                                                                                                                                                                                                         | [NOTICE](./NOTICE)                   | —                                                      | One-stop list of upstream projects we depend on and their licenses.                                                                            |

If you're a security researcher, see [`SECURITY.md`](./SECURITY.md) for
the threat model, PII commitments, coordinated-disclosure timeline, and
safe-harbor terms.

---

---

## Also by @kensaurus

Other free apps and tools from the same Tokyo studio:

### Mobile apps

| App | What it does | iOS | Android |
|:----|:-------------|:----|:--------|
| **[glot.it — Learn Thai Free](https://kensaur.us/glot-it/)** | 161 lessons, pitch-contour tone mirror, AI roleplay chat, offline-first. Actually free — not free-to-look-at. | [App Store](https://apps.apple.com/us/app/glot-it/id6761582648) | [Google Play](https://play.google.com/store/apps/details?id=com.glotit.app) |
| **[yen-yen — Expense Tracker](https://kensaur.us/yen-yen/)** | Kakeibo-style household ledger. No bank password, no ads, no auto-writes. Multi-currency with historical FX. | [App Store](https://apps.apple.com/app/id6764548441) | [Google Play](https://play.google.com/store/apps/details?id=app.yenyen) |
| **[Help Her Take Photo](https://kensaur.us/help-her-take-photo/)** | Two phones → one remote photo studio. Live preview + remote shutter, no account required. | [App Store](https://apps.apple.com/app/help-her-take-photo/id6762513666) | [Google Play](https://play.google.com/store/apps/details?id=com.kensaurus.helphertakephoto) |
| **[The Wanting Mind — Free Book](https://kensaur.us/the-wanting-mind/)** | 147,000-word interactive book — 3D knowledge graph, 12 narrators, karaoke highlighting, 22 simulations. EN/JA/ZH/TH. Free, no ads, no paywalls. | [App Store](https://apps.apple.com/us/app/the-wanting-mind/id6761361305) | [Google Play](https://play.google.com/store/apps/details?id=us.kensaur.thewantingmind) |

### Developer tools

| Tool | What it does | Install |
|:-----|:-------------|:--------|
| **[cursor-kenji](https://github.com/kensaurus/cursor-kenji)** | 58 Cursor AI agent skills for React / Next.js / Supabase development. The deploy-npm skill was built for this monorepo. | `npx skills add kensaurus/cursor-kenji` |

---

<div align="center">
<sub>If Mushi-chan helped, drop a ⭐ — next devs find the repo faster that way. <a href="https://github.com/kensaurus/mushi-mushi/stargazers">Star the repo</a> · <a href="https://github.com/kensaurus/mushi-mushi/issues/new/choose">Open an issue</a> · <a href="https://bsky.app/profile/mushimushi.dev">Follow on Bluesky</a></sub>
</div>
