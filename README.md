<div align="center">

# Mushi Mushi 虫虫

**The user-friction intelligence layer that complements Sentry.**

Sentry sees what your code throws. Mushi sees what your users *feel*.

[![npm](https://img.shields.io/npm/v/@mushi-mushi/react?label=%40mushi-mushi%2Freact&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![CI](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml/badge.svg)](https://github.com/kensaurus/mushi-mushi/actions/workflows/ci.yml)
[![Security](https://github.com/kensaurus/mushi-mushi/actions/workflows/security.yml/badge.svg)](https://github.com/kensaurus/mushi-mushi/actions/workflows/security.yml)
[![Socket](https://socket.dev/api/badge/npm/package/mushi-mushi)](https://socket.dev/npm/package/mushi-mushi)
[![Snyk](https://snyk.io/advisor/npm-package/mushi-mushi/badge.svg)](https://snyk.io/advisor/npm-package/mushi-mushi)
[![License](https://img.shields.io/badge/SDK-MIT-blue.svg)](./LICENSE)
[![Server](https://img.shields.io/badge/server-BSL%201.1-orange.svg)](./packages/server/LICENSE)
[![React 19](https://img.shields.io/badge/React-19-149eca.svg)](https://react.dev)
[![TypeScript 6](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://typescriptlang.org)
[![Vite 8](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev)
[![Node ≥22](https://img.shields.io/badge/Node-%E2%89%A522-339933.svg)](https://nodejs.org)
[![pnpm ≥10](https://img.shields.io/badge/pnpm-%E2%89%A510-f69220.svg)](https://pnpm.io)

[Quick start](#quick-start) · [Live admin demo](https://kensaur.us/mushi-mushi/) · [Docs](./apps/docs) · [Self-hosting](./SELF_HOSTED.md) · [Architecture](#architecture)

<a href="https://kensaur.us/mushi-mushi/" title="Open the live admin demo — animated guided tour">
  <img src="./docs/screenshots/tour-pdca-loop.gif" alt="Animated guided tour through the logged-in admin console, walking the full Plan → Do → Check loop — Dashboard PDCA cockpit with '5 failed fixes need retry' next-action card and live KPI strip (Plan triage caught up, Do 5 failed, Check open Health to seed judge freshness, Act 11 PRs awaiting review), Reports triage queue with severity-stripe sparklines (Critical 2 / High 53 +1330% / Medium 8 / Low 7) and per-row Dispatch fix CTA, Fixes auto-fix pipeline with KPI cards (19 attempts / 11 completed 69% success / 5 failed / 11 PRs open) and per-attempt PDCA cards (Plan CLOSED → Dispatch FAILED → Check NOT YET → Act FAILED), Judge scores with Decide/Act/Verify hero (overall 0.83/5, investigate 44% disagreement, last eval openai/gpt-4.1) and 12-week score trend / distribution histogram" width="100%" />
</a>

<sub>↑ a logged-in 4-stop walk through the Plan → Do → Check loop · static deep-dive hero below · click to open the live admin</sub>

<a href="https://kensaur.us/mushi-mushi/" title="Open the live admin demo">
  <img src="./docs/screenshots/report-detail-dark.png" alt="A real classified user-felt bug inside Mushi Mushi — 4-stamp PDCA receipt strip (Plan CLOSED 'Received &amp; classified (high)', Do CLOSED 'Fix dispatched — 1 file changed · PR #11', Check CLOSED 'judge evaluated — judge agreed (score 97%)', Act IN FLIGHT 'Awaiting merge / mark-as-fixed · Review &amp; merge'), live Branch &amp; PR timeline with Dispatch requested → Worker started → Agent started → Branch created mushi/fix-75dda4af-moaw66j7 → Commit 92c76aa → PR opened #11 → Fix completed → CI in progress, Langfuse trace deeplink, Status + Severity dropdowns, Sync destinations + Dispatch fix actions" width="100%" />
</a>

<sub>↑ a real bug, end-to-end · the admin is dark-only by design</sub>

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

A walk through the rooms inside. Click any panel to land on it in the live demo.

<table width="100%">
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/"><img src="./docs/screenshots/quickstart-dark.png" alt="Quickstart mode dashboard — three-page sidebar (Setup, Bugs to fix, Fixes ready) with verb-led labels and zero PDCA jargon, 'You're caught up · No new bugs waiting' top banner with 'Open inbox →' primary action, 'Bugs to fix' page heading, Next-Best-Action strip '2 failed fixes need retry · Open Fixes →' (only the two items the user actually needs to act on), and the same live PDCA canvas below (Do node marked CURRENT FOCUS, '2 fixes in flight', '2 failed fixes need retry')" /></a>
    <p align="center"><b>Quickstart mode</b> · <sub>3 pages, verb-led labels, no PDCA jargon. The default for first-time visitors — pill-toggle up to Beginner (9 pages) or Advanced (all pages) anytime.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/"><img src="./docs/screenshots/first-run-tour-dark.png" alt="First-run interactive tour — spotlight cutout around the Plan tile, dark backdrop dimming everything else, coach-mark panel reading 'TOUR - 1 OF 5 · Plan — bugs your users felt · Each tile is a stage of the loop. Plan is where real user complaints land, get classified, and get scored by severity. Click any tile to drill in.' with a Next button and a Don't show again link." /></a>
    <p align="center"><b>First-run tour</b> · <sub>custom 5-stop spotlight tour, no <code>react-joyride</code> dep so it inherits dark theme tokens. Stops that need real data silently skip until the first report lands.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/onboarding"><img src="./docs/screenshots/onboarding-dark.png" alt="Plug-n-play onboarding wizard with PDCA storyboard — four cards across the top (Plan capture, Do dispatch, Check verify, Act standardise) showing where the loop starts and ends, then a 'You're set up · 4/4 required · 100%' progress bar above a checklist of Done steps (project, API key, SDK install, first bug report, GitHub) and an Add API key CTA on the optional Anthropic step." /></a>
    <p align="center"><b>Plug-n-play onboarding</b> · <sub>opens with a Plan→Do→Check→Act storyboard so you see the loop before the checklist. Required steps drive the green progress bar; optional steps stay tagged.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/judge"><img src="./docs/screenshots/judge-runresult-dark.png" alt="Judge scores page right after clicking 'Run judge now' — a green sticky ResultChip beside the button reads '✓ Dispatched 3 projects — refreshing in ~30s · now', the rest of the page shows latest week 65% / 24 evals KPIs, 12-week multi-line score trend, score distribution histogram, prompt leaderboard, and recent evaluations table with summaries instead of report hashes." /></a>
    <p align="center"><b>Sticky run receipts</b> · <sub>every Run / Generate / Dispatch button leaves a persistent <code>ResultChip</code> next to it, so the user never has to wonder "did it actually work?" after the toast fades.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/"><img src="./docs/screenshots/dashboard-dark.png" alt="Advanced-mode dashboard with PDCA cockpit — full 24-page sidebar grouped by Plan / Capture / Classify — Do / Dispatch fixes — Check / Verify quality — Act / Integrate &amp; scale, Next-Best-Action strip '2 failed fixes need retry · Open Fixes →', 4 Plan / Do / Check / Act tiles on a React Flow canvas with the Do node marked CURRENT FOCUS and a marching-ants failure ring on the Do bottleneck, Live Activity feed (Auto-fix completed, Login button click has no effect), and KPI strip (Reports 60 14d, Triage backlog 0, Auto-fix PRs 9, LLM tokens 149.8k)" /></a>
    <p align="center"><b>Dashboard (Advanced)</b> · <sub>one living number per stage, bottleneck ring, Next-Best-Action strip, 14d severity-stacked histogram, LLM tokens &amp; calls sparklines, Repo link right under Fixes.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/reports"><img src="./docs/screenshots/reports-dark.png" alt="Triage queue — 4 px severity stripe per row, 14d KPI strip (Critical 2, High 41, Medium 8, Low 7) with per-severity sparklines, Save view button, filter row (All 60, New 0, Queued 0, Triaged 0, Resolved 0, Dismissed 0, Critical 2, Major 0), search + Status / Category / Severity dropdowns, 60 real reports showing 'Login button click has no effect — no form submission, navigation, or console errors triggered' with status pills (Fixing 3/4, Classified 2/4), severity pills (High 78%, Critical 95%), and 'Dispatch fix →' primary action per row" /></a>
    <p align="center"><b>Reports</b> · <sub>triage queue + Btn parity — 4 px severity stripe, 14d severity KPIs with sparklines, blast-radius dedup, Save view preset, single primary action per row.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/fixes"><img src="./docs/screenshots/fixes-dark.png" alt="Auto-fix pipeline — 5 KPI cards with 30d sparklines (Attempts 14, Completed 9 / 82% success, Failed 2, In flight 0, PRs open 9), '9 PRs are ready for review' banner with 'Open latest PR' CTA, per-attempt cards with stage-by-stage status (Report → Dispatch → Draft PR → Judge → Ship) and PDCA lifecycle rows (Plan CLOSED, Do CLOSED with real PR #11, Check IN FLIGHT 'CI running on the PR', Act IN FLIGHT 'Awaiting merge'), Langfuse trace deeplink per run" /></a>
    <p align="center"><b>Fixes</b> · <sub>pipeline + stagger — per-attempt PDCA cards, 30d KPI sparklines, Langfuse trace per run, real PR links, retry-failed CTA. Cards cascade-fade in via <code>useStaggeredAppear</code>.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/judge"><img src="./docs/screenshots/judge-dark.png" alt="Judge scores with Decide/Act/Verify hero — Decide tile 'Overall score 0.80/5 stable across 52 evaluations over 2 weeks', Act tile 'Investigate 58% judge disagreement — Open Prompt Lab', Verify tile 'Last eval openai/gpt-4.1 2026-04-23 02:58', then 4 KPI cards (Latest week 80% +22.6%, Total evaluations 52, Prompt versions 12, Mean score 74%), 12-week score trend with per-dimension lines (Overall 80, Accuracy 100, Severity 86, Component 60, Repro 58), score distribution histogram, prompt leaderboard, 'Run judge now' CTA top-right" /></a>
    <p align="center"><b>Judge</b> · <sub>Decide/Act/Verify hero over the charts. Live KPIs, 12w score trend, distribution histogram, prompt leaderboard, one-click re-run with a sticky <code>ResultChip</code>.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/repo"><img src="./docs/screenshots/repo-dark.png" alt="Repo graph page — Repository card with GitHub remote, KPI row (14 branches, 9 PR open, 4 CI passing, 2 CI failing, 4 merged, 2 stuck), filter tabs (All 14 / PR open / CI passing / CI failing / Failed), per-branch cards showing 'CI in progress' pill, branch name mushi/fix-75dda4af-moaw66j7, one-sentence summary from the originating report, and an inline mini PDCA graph (Dispatched → Branch → PR #11 → Completed), plus a live REPO ACTIVITY stream on the right with auto-refreshing 'CI success', 'CI failure', 'Commit', 'PR #11 opened', 'Fix dispatched' events timestamped to the minute" /></a>
    <p align="center"><b>Repo</b> · <sub>one branch per auto-fix attempt, grouped by CI status. Live event stream via Supabase Realtime on <code>fix_events</code>, inline mini-graph per card, refreshes itself so you can leave it open on a second monitor.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/intelligence"><img src="./docs/screenshots/intelligence-dark.png" alt="Bug intelligence page with Decide/Act/Verify hero — Decide tile '1 digest on file · This week's digest is fresh. Check hotspots and category drift', Act tile 'All clear — nothing actionable here right now', Verify tile 'Latest report 4/17/2026 — 2026-04-06, Open evidence →', then an 'ALL CLEAR' banner, week-of 2026-04-06 digest card with prompt (claude-sonnet-4-6), Cross-customer benchmarking opt-in toggle (Sharing off), recent generation jobs table, and a weekly digest row with 'Download PDF' CTA" /></a>
    <p align="center"><b>Intelligence</b> · <sub>the 3-tile hero pattern in action — Decide surfaces the one-liner that matters, Act collapses to "All clear" when there's nothing to do, Verify deeplinks to the evidence. Every advanced page follows this shape.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/health"><img src="./docs/screenshots/health-dark.png" alt="LLM health with Decide/Act/Verify hero — Decide tile 'All systems nominal · 13 calls · 0.0% err · Fallback rate 0.0% · avg 8220ms (24h)', Act tile 'All clear', Verify tile 'Last LLM call claude-sonnet-4-6 classify-report 02:57:31Z · Open evidence → · Open audit log', 'All systems nominal' banner, 24h KPI row (Total calls 13, Fallback rate 0.0%, Error rate 0.0%, Latency p50 8220ms / p95 17877ms), per-function breakdown (classify-report 5 calls $0.0766, fast-filter 8 calls $0.0440), per-model breakdown (claude-sonnet-4-6 5 calls 10,729 tokens, claude-haiku-4-5 8 calls 9,752 tokens), provider probes row" /></a>
    <p align="center"><b>Health</b> · <sub>real <code>cost_usd</code> per call, per-function / per-model breakdown, p50/p95 latency, fallback rate, cron triggers, Langfuse deeplinks, Decide/Act/Verify hero over the raw numbers.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/prompt-lab"><img src="./docs/screenshots/prompt-lab-dark.png" alt="Prompt Lab — KPIs (2 active prompts / 2 candidates / no scored prompts yet / 49 of 52 reports labelled in eval dataset), Stage 1 fast-filter and Stage 2 classify version tables each with v1-baseline (Active, 100% traffic) and v2-experiment (Candidate, 0% traffic) rows, two pending fine-tuning jobs on claude-sonnet-4-6, and an empty Synthetic reports section with a Generate CTA" /></a>
    <p align="center"><b>Prompt Lab</b> · <sub>replaces Fine-Tuning. A/B traffic split between active and candidate prompts per stage, eval dataset preview, synthetic report generator, fine-tuning jobs queue.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/graph"><img src="./docs/screenshots/graph-dark.png" alt="Knowledge graph in Sankey storyboard mode — two columns labelled COMPONENT and PAGE with bezier links showing which components co-occur with which pages; thicker link = more bugs touching both; quick-view chips for All / Regressions / Fragile / Fix coverage; Graph backend status (SQL only / AGE not installed) and Bug ontology editor below" /></a>
    <p align="center"><b>Knowledge graph</b> · <sub>auto-switches to Sankey storyboard under 12 nodes; full React Flow canvas above. Apache AGE backed when installed, falls back to plain SQL adjacency otherwise.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/compliance"><img src="./docs/screenshots/compliance-dark.png" alt="Compliance dashboard — Refresh evidence + Export PDF actions top-right, Latest control evidence table with rows for A1.2 (Availability snapshot, WARN), CC6.1 (RLS coverage, PASS), CC6.7 (Data retention windows, WARN — default_used true), CC7.2 (Operational monitoring · audit_log volume 7d, mixed PASS/WARN), CC8.1 (DSAR fulfilment >30 days, PASS) with JSON payloads inline, then Data residency table with US/EU/JP/SELF radio per project" /></a>
    <p align="center"><b>Compliance</b> · <sub>SOC 2 control evidence pack with PASS / WARN pills and inline JSON, region pinning per project, print-styled Export PDF, DSAR workflow tracking.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/marketplace"><img src="./docs/screenshots/marketplace-dark.png" alt="Plugin marketplace — Available plugins (4/4) showing PagerDuty Escalation (Official, Incident response, report.classified + sla.breached events), Linear Sync (Project management, report.created + report.classified + report.status_changed), Zapier Bridge (Integration, generic webhook fan-out), and Sentry Mirror (Observability, report.classified + fix.proposed + fix.applied), each with Source link and Install button. Installed section is empty with 'No plugins installed' empty state. Recent deliveries (0/0) below" /></a>
    <p align="center"><b>Marketplace</b> · <sub>toggleable extension layer for the loop. Each plugin declares the events it subscribes to and ships with HMAC-signed webhooks; deliveries are logged with HTTP status + first 512 chars of the response.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/inbox"><img src="./docs/screenshots/inbox-dark.png" alt="Action inbox grouped by PDCA stage — top KPI strip with 4 PDCA cards (Plan 'Triage caught up', Do '5 failed fix dispatch needs attention', Check 'Judge batch is fresh', Act '11 PRs awaiting review'), then sections per stage: 'Plan — classify + triage' with a 'Reports queue · 2 critical reports in the last 14 days' yellow card and 'Open critical queue →' CTA, 'Do — dispatch + land fixes' with '5 fix attempts failed · Review the failure, fix the agent prompt, or retry manually' and 'Open failed fixes →' CTA, 'Check — verify quality' with 'Trigger a fresh judge batch · Last evaluation ran 49h ago' and 'Run judge batch →' CTA, 'Act — connections + config' below" /></a>
    <p align="center"><b>Action inbox</b> · <sub>open actions across the PDCA loop, grouped by stage with one yellow CTA per group (<code>Open critical queue → / Open failed fixes → / Run judge batch →</code>). Empty groups skip — the page only renders what's actually waiting on you.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/anti-gaming"><img src="./docs/screenshots/anti-gaming-dark.png" alt="Anti-gaming dashboard — Decide/Act/Verify hero (Decide tile 'Flagged devices need review · 4 flagged · 0 cross-account', Act tile 'All clear', Verify tile 'Latest enforcement activity · 53 recent events · 4 collapsed'), KPI strip (Tracked devices 4 -flat vs 7d avg, Flagged 4 ↑30 vs 7d avg, Cross-account 0 ↑30 vs 7d avg, Total reports 65), Flagged devices table with rows per fingerprint (fp:1f0b09790709b8a0..., 14 tokens · 1 IP · 14 reports, 'Multi-account: 4 reporter tokens from same device', First seen 4/23/2026), each with Details / Unflag actions, search input top-right" /></a>
    <p align="center"><b>Anti-gaming</b> · <sub>per-device fingerprint tracker that throttles bad-faith reporters and surfaces multi-account abuse (<code>4 reporter tokens from same device</code>). Operator gets <code>Details / Unflag</code> per row; every enforcement action lands in the audit trail.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/queue"><img src="./docs/screenshots/queue-dark.png" alt="Processing queue (DLQ) — Decide/Act/Verify hero ('Queue is healthy · 0 running · 0 pending · No stuck work, no dead letters', 'All clear', 'Latest throughput snapshot 2026-04-23 · 20 completed · 0 failed'), top-right batch ops (completed dropdown, All Stage dropdown, Retry page (25), Flush queued, Recover stranded), KPI cards (Pending 0, Running 0, Completed 67 ↑2853%, Failed 0, Dead letter 0), 14d daily throughput histogram (created/completed/failed colour-coded), per-stage backlog bar (stage1 67), and per-job rows showing 'stage1 - Completed · 6/3 attempts · user-story:1776924091355 — the login button does nothing and the page flickers · Created 7 hours ago - last attempt 7 hours ago' with a Retry button" /></a>
    <p align="center"><b>Processing queue (DLQ)</b> · <sub><code>worker_jobs</code> viewer with 14d throughput histogram, per-stage backlog bar, and per-job <code>Retry</code> action. Top-right batch ops — <code>Retry page (25) / Flush queued / Recover stranded</code> — operate on the visible filter so you never accidentally retry the whole table.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/query"><img src="./docs/screenshots/query-dark.png" alt="Ask Your Data — page heading 'Ask Your Data · Ad-hoc natural-language questions against your bug data. Read-only, sandboxed, and cited.', Decide/Act/Verify hero ('Saved queries ready · 1 saved · 1 recent', 'All clear', 'Latest activity · Last run 76h ago · Open evidence → · New query'), 'Ask a question about your...' input with Ask button, 6 quick-prompt chips (How many critical bugs were reported this week? · Which component has the most bugs? · Show reports that might be regressions · Top 5 components by report count this month · List dismissed reports with low reputation reporters · Average judge score by week (last 4 weeks)), SQL HINTS panel with 5 hint rows, Saved (1) + History sidebar on the right" /></a>
    <p align="center"><b>Ask Your Data</b> · <sub>ad-hoc natural-language SQL over the bug data — read-only Postgres, pre-canned chip prompts (<code>Top 5 components by report count this month</code>, <code>Reports with screenshots but no console logs in the last 7 days</code>), Saved queries + History sidebar, every successful answer logged to the audit trail.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/research"><img src="./docs/screenshots/research-dark.png" alt="Research notes page — 'CHECK' stage chip, heading 'Research · Long-form notes from QA and product research. Pin findings here so the next loop iteration starts smarter.', About Research collapsed accordion, SEARCH section with 'error signature, library na...' input + Search button, 5 chip topics (react query 5 cache invalidation breaking change · supabase auth getUser 401 with valid session · vite 8 esbuild externalization regression · pgvector cosine distance vs inner product accuracy · cloudflare workers fetch ECONNRESET intermittent), RECENT SESSIONS card 'No sessions yet — your first search will land here.'" /></a>
    <p align="center"><b>Research</b> · <sub>pin QA + product findings here so the next loop iteration starts smarter. Pre-seeded chip topics (<code>pgvector cosine distance vs inner product accuracy</code>, <code>vite 8 esbuild externalization regression</code>) hint at the kind of low-noise long-form notes the loop benefits from.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/mcp"><img src="./docs/screenshots/mcp-dark.png" alt="MCP — Model Context Protocol page for the glot.it project — heading 'MCP — Model Context Protocol  glot.it · Connect Cursor, Claude Desktop, or any MCP-aware agent to this project's live triage queue. Agents read reports, dispatch fixes, and log PRs without copy-pasting IDs into chat.', 'Mint an API key' button top-right, '60-second 3-step bootstrap' card (1. Mint an API key with mcpread / mcpwrite scope chips · 2. Paste the snippet into your IDE · 3. Ask the agent to 'list mushi tools' · should see all 13 tools), 'Install snippet' card with .cursor/mcp.json / .env.local toggle and a JSON code block pre-filled with mushiServers · mushi-glot-it · npx mushi-mcp@latest · MUSHI_API_ENDPOINT https://api.mushimushi.dev · MUSHI_API_KEY paste-your-key-here · MUSHI_PROJECT_ID 542b34e0-019e-41fe-b900-7b637717b986" /></a>
    <p align="center"><b>MCP — Model Context Protocol</b> · <sub>per-project <code>.cursor/mcp.json</code> snippet pre-filled with the active <code>MUSHI_PROJECT_ID</code>, 13-tool catalog mirror (<code>apps/admin/src/lib/mcpCatalog.ts</code>, kept in sync with <code>packages/mcp/src/catalog.ts</code> by the <code>check-catalog-sync</code> pre-commit guard), 60s 3-step agent bootstrap.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/integrations"><img src="./docs/screenshots/integrations-dark.png" alt="Integrations page — 'ACT' stage chip, heading 'Integrations · Sentry / Slack / GitHub routing + per-platform probe history.', CORE PLATFORM section with three cards: Sentry (Healthy pill · 'Pulls Seer root-cause analysis into your reports and lets the LLM cross-reference production errors with user feedback. Wire the webhook to mirror Sentry user feedback into Mushi.' · Last probe 3 days ago 894ms HTTP 200 · sparkline · Test / Edit), Langfuse (Healthy · 'Every LLM call (Stage 1 classify, Stage 2 vision, fix-worker) emits a trace. Click any trace from a report or fix attempt to see the exact prompt + response + token cost.' · 506ms HTTP 200), GitHub (Healthy · 770ms HTTP 200 sparkline). Then 'Codebase indexing On / Reconfigure' card with Repo https://github.com/kensaurus/glot.it, Branch main, Indexed files 401, Last sweep 3 hours ago. ROUTING DESTINATIONS below with Jira card (Unknown pill, Connect button, severity-to-priority mapping bullets)" /></a>
    <p align="center"><b>Integrations</b> · <sub><code>Sentry / Langfuse / GitHub</code> health-checked probes with last-probe latency + HTTP code + sparkline, codebase indexing status (401 files swept 3h ago, fed back into the RAG context the auto-fix agent reads), routing-destination CRUD (Jira / PagerDuty / Linear).</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/notifications"><img src="./docs/screenshots/notifications-dark.png" alt="Reporter Notifications page — 'ACT' stage chip, heading 'Reporter Notifications · Outbound messages sent to the people who reported the bugs — keeps the loop transparent.', top-right filters (Show All dropdown, All Type dropdown, 'Mark all read (77)' button), table of 'classified' notification rows each with timestamp, 'unread' state, 'tok:e7bafe2b...' reporter token, 'report:5b0027a1...' / 'report:7fe4cd7d...' / 'report:15e7ce7e...' report ID link, and per-row 'Show payload' + 'Mark read' actions" /></a>
    <p align="center"><b>Reporter notifications</b> · <sub>outbound messages sent to the people who reported each bug (e.g. <code>classified — report:5b0027a1...</code> paired with <code>tok:e7bafe2b...</code>). <code>Show payload</code> reveals the exact JSON the SDK delivered. Keeps the loop transparent — every reporter knows what happened to their bug.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/settings"><img src="./docs/screenshots/settings-dark.png" alt="Settings page — heading 'Settings · Project keys, BYOK vault, developer toggles.', About Settings collapsed accordion, 5-tab nav (General · LLM keys (BYOK) · Firecrawl · Health & test · Dev tools), General tab visible with NOTIFICATIONS card (Slack Webhook URL input 'https://hooks.slack.com/services/...'), SENTRY INTEGRATION card (Sentry DSN pre-filled, Webhook Secret input, 'Consume Sentry User Feedback as Mushi reports' checkbox checked), LLM PIPELINE card (Stage 2 Model dropdown 'Claude Sonnet 4.6 — recommended default', Stage 1 Confidence Threshold slider 0.85), DEDUPLICATION card (Similarity Threshold slider 0.82), 'No changes' button at the bottom" /></a>
    <p align="center"><b>Workspace settings</b> · <sub>5 tabs (General · BYOK · Firecrawl · Health &amp; test · Dev tools) covering Slack webhook, Sentry DSN, Stage-2 model picker, Stage-1 confidence threshold, dedup similarity threshold — every knob the LLM pipeline reads at runtime, with a <code>No changes</code> button that arms only when something diffs.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/sso"><img src="./docs/screenshots/sso-dark.png" alt="SSO Configuration page — heading 'SSO Configuration · Configure SAML or OIDC for your team. JIT-provisioning on first login is enabled by default.', About SSO collapsed accordion, ADD IDENTITY PROVIDER card with SAML 2.0 dropdown, Provider name input (e.g. Okta), Metadata URL (required), Entity ID (optional, parsed from metadata), Email domains (comma-separated, e.g. acme.com,acme.io), 'Add Provider' yellow button, helper text 'On submit, Mushi calls the Supabase Auth Admin API to register the SAML provider. We surface the resulting ACS URL + Entity ID below for you to paste into your IdP.', empty state 'No identity providers configured' below" /></a>
    <p align="center"><b>SSO config</b> · <sub>SAML 2.0 + OIDC form, calls the Supabase Auth Admin API on submit, surfaces the resulting ACS URL + Entity ID below for you to paste into your IdP. JIT provisioning on first login is the default. OIDC intentionally returns 501 — see <a href="#honest-status--what-works-whats-still-partial">Honest status</a>.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/audit"><img src="./docs/screenshots/audit-dark.png" alt="Audit Log page — heading 'Audit Log · Append-only history of every mutation made by the platform. Filter by actor, action, or resource.', 'Export CSV (13)' button top-right, Decide/Act/Verify hero ('Audit trail clean · 13 events · Every mutation in scope is accounted for. Export evidence for your next review', 'All clear', 'Last event - settings.updated · eb0c15cc-4139-490b-a335-35b3d87428df · 2026-04-2... · Open evidence → · Open compliance'), filter row (All Action / All Resource / Actor type / When / Actor email / Search action / resource), table with columns Time / Action / Actor / Resource showing rows like '4/23/2026, 11:09:47 AM · settings.updated · eb0c15cc-4139... · byok:anthropic', '4/20/2026, 2:48:09 PM · compliance.soc2.evidence_refreshed · ... · soc2_evidence', 'compliance.dsar.created · data_subject_requests:cc1cd0f', several 'fine_tuning' and 'integration_platform' rows" /></a>
    <p align="center"><b>Audit log</b> · <sub>append-only history of every mutation, filterable by actor / action / resource / time. Each row pairs a <code>settings.updated</code> / <code>compliance.dsar.created</code> action with an actor UUID and resource handle so you can trace any change to a tenant. <code>Export CSV</code> for the next SOC 2 review.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/storage"><img src="./docs/screenshots/storage-dark.png" alt="Storage page — heading 'Storage · Per-project bucket usage and retention policy for screenshots, logs, and uploaded artefacts.', Decide/Act/Verify hero ('No buckets configured · Connect a bucket to retain screenshots + logs beyond the default rolling window.', 'All clear', 'Latest probe snapshot · No probes run yet'), PER-PROJECT USAGE table (PROJECT / OBJECTS / LAST WRITE columns, glot.it 0 -, Test Project 0 -, Mushi Test Project 0 -), then a per-project bucket form for glot.it (542b34e0-019e-41fe-b900-7b637717b986) with 'Using cluster default — save to override' yellow pill, Provider dropdown 'Supabase Storage (default)', Bucket input 'mushi-public', Region 'us-east-1', Endpoint placeholder 'https://s3.us-east-1.amazonaws.com', Path prefix 'mushi-mushi/', Signed URL TTL (seconds) 3600, Access key Vault ref + Secret key Vault ref inputs" /></a>
    <p align="center"><b>BYO storage</b> · <sub>per-project bucket form (Supabase / S3 / R2), region pinning, presigned-URL TTL editor, vault-ref'd access keys (never plaintext). Per-project usage table at the top so you spot a project burning through storage before the bill arrives.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/projects"><img src="./docs/screenshots/projects-dark.png" alt="Projects page — heading 'Projects · 3 projects owned by you', About Projects collapsed accordion, 'New project name (e.g. Acme iOS app)' input + 'Create project' yellow button, then 3 per-project cards: glot.it (Active pill, glot-it slug, Created 4/17/2026, last report 6h ago, '65 reports · 3 active keys · 1 member', yellow 'DO 5 fixes need retry' chip, '4 keys (3 active)' expander) with toolbar (Reports / Integrations / Settings / Send test report / SDK ingest dropdown / Mint key); Test Project (test-project, Created 4/16/2026, last report 6d ago, 5 reports · 2 active keys · 1 member); Mushi Test Project (mushi-test, 3 reports · 1 active key · 0 members) — each with Set active / Reports / Integrations / Settings / Send test report / SDK ingest / Mint key" /></a>
    <p align="center"><b>Multi-project workspace</b> · <sub>per-project cards with active-key count, reports count, member count, plus inline CTAs to mint a fresh key, send a test report, or open project-scoped Integrations / Settings. The active project drives the project filter on every other page.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/billing"><img src="./docs/screenshots/billing-dark.png" alt="Billing page — heading 'Billing · Plan, usage, invoices, and quota — everything you need to keep the loop running on your terms.', 'Free quota: 1,000 reports / mo' top-right, About Billing collapsed accordion, 'Plans at a glance · Billed monthly · cancel any time · prices in USD · YOUR PLAN IS HIGHLIGHTED' card with 4-column comparison table: Hobby (Your plan, Free), Starter (Most popular, $19/mo), Pro ($99/mo), Enterprise (Talk to us, Email sales →). Feature rows include USAGE: Reports/month (1,000 / 10,000 / 50,000 / Unlimited), Overage (- / $0.0025 per report / $0.0020 / -), Report retention (7 / 30 / 90 / 365 days), Admin seats (3 / Unlimited / Unlimited / Unlimited). PLATFORM rows: Bring your own LLM key, Plugin marketplace, Weekly intelligence reports, Self-hosted option each with checkmarks per tier" /></a>
    <p align="center"><b>Billing</b> · <sub>plan comparison (Hobby Free / Starter $19 / Pro $99 / Enterprise), per-plan reports/month + overage cents/report + retention days + admin seats, Stripe-metered LLM $ per day below the fold, <code>Need help?</code> form wired to <code>/v1/support/contact</code> (rate-limited to 5 tickets/hour/user) so paying customers jump the queue.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/"><img src="./docs/screenshots/report-detail-dark.png" alt="Report detail page for a High-severity login-button bug — 4-stamp PDCA receipt (Plan CLOSED, Do CLOSED 'Fix dispatched — 1 file changed · PR #11', Check CLOSED 'judge agreed score 97%', Act IN FLIGHT 'Awaiting merge'), live Branch &amp; PR timeline with every step from Dispatch requested through CI in progress, branch name + CI status + PR link + commit SHA + changed files summary cards, Langfuse trace deeplink, Status / Severity dropdowns, Sync destinations + Dispatch fix actions" /></a>
    <p align="center"><b>Report detail</b> · <sub>4-stamp PDCA receipt + live Branch &amp; PR timeline — every step of the dispatch lifecycle from <code>llm_invocations</code>, <code>fix_attempts</code>, <code>fix_events</code>, and <code>classification_evaluations</code> in a single round-trip so it never N+1s.</sub></p>
  </td>
</tr>
</table>

---

## Seven capabilities, one platform

1. **User-side capture** — Shadow-DOM widget, screenshot, console + network rings, route + intent, offline queue, rage-click / error-spike / slow-page proactive triggers.
2. **LLM-native classification** — 2-stage pipeline (Haiku fast-filter → Sonnet deep + vision), structured outputs via `response_format`, prompt-cached system instructions, deterministic JSON.
3. **Knowledge graph + dedup** — Bug ↔ component ↔ page ↔ version edges in Postgres + pgvector. Auto-grouping kills duplicate noise.
4. **LLM-as-Judge self-improvement** — Weekly Sonnet judge scores classifier outputs; low-scoring runs feed a fine-tuning queue. OpenAI fallback when Anthropic is degraded.
5. **Agent-agnostic auto-fix** — Orchestrator with `validateResult` gating + GitHub PR creation. Sandbox provider abstraction (`local-noop` for tests, `e2b` / `modal` / `cloudflare` for prod, all four wired through `resolveSandboxProvider`). True MCP client adapter (JSON-RPC 2.0 + SEP-1686 Tasks) so Claude Code, Codex, Cursor, or any future agent plugs in.
6. **Multi-repo coordinated PRs** — A bug spanning frontend + backend opens linked PRs (`fix_coordinations` table) so reviewers see the full surface.
7. **Enterprise scaffolding** — SSO config CRUD, audit log ingest, plugin marketplace with HMAC, region-pinned data residency, retention policies, DSAR workflow, Stripe metered billing.

---

## Quick start

```bash
npx mushi-mushi
```

The wizard auto-detects your framework (Next.js / Nuxt / SvelteKit / Angular / Expo / Capacitor / plain React, Vue, Svelte / vanilla JS), installs the right SDK with your package manager, writes `MUSHI_PROJECT_ID` and `MUSHI_API_KEY` to `.env.local` (with the right framework prefix), and prints the snippet to paste in. Equivalent commands:

```bash
npm create mushi-mushi              # via the npm-create convention
npx @mushi-mushi/cli init           # if you prefer the scoped name
```

Skip the wizard and install directly if you already know which SDK you want:

```bash
npm install @mushi-mushi/react      # also covers Next.js
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

**Published:** SDKs at `0.2.x` (all seven frameworks + node + adapters + capacitor), CLI + launcher at `0.4.x`, MCP + MCP-CI at `0.1.x`, admin at [`kensaur.us/mushi-mushi/`](https://kensaur.us/mushi-mushi/) (auto-deployed to S3 + CloudFront on every push to `master`).

**Dogfood:** end-to-end loop validated on a real production webapp. Report → LLM triage → "Dispatch fix" → draft GitHub PR → live in `/fixes` → live branch graph in `/repo` with per-event Supabase Realtime stream. Sentry, Langfuse, and GitHub all probe **Healthy** from the Integrations page, with a nightly Playwright dogfood against the production stack catching regressions before they reach users.

**This month's highlights** 🐛

- **Decide / Act / Verify page hero** — every Advanced PDCA page now opens with a 3-tile hero strip (Decide = one headline metric, Act = the current next-best-action with a single CTA, Verify = deeplink to the evidence). Charts moved below the fold. Beginner mode collapses it to a one-line summary. Source: `apps/admin/src/components/PageHero.tsx`.
- **Live `/repo` page** — one node per branch the auto-fix agent has opened, grouped by CI status (open / passing / failing / merged / stuck), with a live event stream on the right via Supabase Realtime on the new `fix_events` table. Each branch shows its own mini PDCA graph (Plan → Dispatch → Branch → Commit → PR → CI → Merge) so you can see the loop progress without leaving the page.
- **Dynamic tab titles + favicon badges** — `useDocumentTitle` keeps `document.title` in sync with the active page via the shared `pageContext` registry (`Reports · 60 reports · 2 critical — Mushi Mushi`) and `useFaviconBadge` paints a red dot on the favicon whenever `criticalCount > 0`, so operators see urgency from any other browser tab. Both are data-layer driven — zero per-page wiring.
- **Nightly prod PDCA** — `.github/workflows/nightly-prod-pdca.yml` runs the full Playwright dogfood suite against the **production** Supabase stack every night (07:00 UTC) and auto-opens a GitHub issue if the pipeline regresses. Catches stale env keys, expired tokens, cron disables, and LLM provider outages that the local-stack PR e2e can't see. Flip `ENABLE_NIGHTLY_PROD_PDCA` to `true` to enable.
- **Global command palette** — press `⌘K` (macOS) or `Ctrl+K` (Linux/Windows) anywhere to jump to any page, filtered view, or real report / fix by name. `cmdk`-backed, keyword aliases (`bugs` → Reports, `pr` → Fixes, `spam` → Anti-Gaming), debounced live API search, recents persist per browser (page actions excluded from the recents list so navigation recents don't get evicted).
- **PDCA as a live React Flow canvas** — the dashboard loop is a diamond of Plan / Do / Check / Act nodes with gradient bezier edges and a marching-ants animation on the current bottleneck. Narrow viewports keep the stacked cockpit fallback; onboarding ships the same flow as an explainer.
- **Quickstart mode** — the default 3-page admin (`Setup → Bugs to fix → Fixes ready`) for humans who'd rather not know what PDCA stands for. Pill-toggle up to Beginner (9 pages) or Advanced (full console) anytime. Advanced mode groups pages under the four PDCA stages with staleness badges and per-page "next best action" strips.
- **First-run tour** — a 5-stop spotlight that auto-launches once, skips stops that need real data, and resumes when the first report lands. No `react-joyride` dep, inherits dark theme tokens.
- **Responsive tables** — `ResponsiveTable` primitive with edge-fade scroll shadows, opt-in sticky first column, and a global comfy / compact density toggle that persists per browser. Reports, Judge leaderboards, and Compliance evidence / DSAR tables already use it.
- **Themed dialogs** — native `window.confirm/prompt` retired in favour of focus-trapped `<ConfirmDialog>` / `<PromptDialog>` with proper `tone="danger"` for destructive actions.
- **Resilient embeddings sweep** — the RAG repo indexer no longer aborts the whole sweep on a single embedding failure. Per-chunk try/catch keeps the loop going, counts failed chunks, and only surfaces to Sentry when *zero* chunks succeed. Empty-response errors now include upstream host, model, and the raw 200-OK body so BYOK + OpenRouter mis-configurations are diagnosed in one pass.
- **N+1 slayed** — `apiFetch` dedups in-flight requests + keeps a 200 ms micro-cache. The old 24× storm on `/v1/admin/setup` is now 1 request.
- **Sentry telemetry** — every non-2xx API response leaves a breadcrumb; 5xx captures a message; rotated DSNs self-disable after 3 consecutive 401/403 so your devtools stay clean. `logLlmInvocation` now swallows its own promise-rejection so `void` callers on the hot request path can't crash the isolate.
- **Slack quick-fix** — Block Kit messages with `Triage` + `Dispatch fix` buttons wired to a signed `slack-interactions` Edge Function. The loop starts and ends in Slack.
- **Pre-commit lint guards** — `pnpm install` auto-installs a `.git/hooks/pre-commit` that chains zero-dependency guards: `check-no-secrets.mjs` (AWS / Stripe / Slack / GitHub / OpenAI / Anthropic / JWT leak scanner), `check-design-tokens.mjs` (retired-Tailwind-aliases that render transparently), `check-mcp-catalog-sync.mjs` (MCP catalog ↔ admin mirror parity), `check-dead-buttons.mjs` (`<button disabled>` without `aria-label` / tooltip), `check-publish-readiness.mjs`, and `check-license-headers.mjs`. Bypass once with `git commit --no-verify`, skip install with `MUSHI_SKIP_GIT_HOOKS=1`.

<details>
<summary><b>Full phase history</b></summary>

| Phase | Theme | Status |
| :--: | -------------------------------------------------------------------------------------------------- | :----: |
|  A   | Capture, fast-filter, deep classification, dedup                                                   |   ✅    |
|  B   | Knowledge graph, NL queries, weekly intelligence                                                   |   ✅    |
|  C   | Vision air-gap, RAG codebase indexer, fix dispatch                                                 |   ✅    |
|  D   | Marketplace, Cloud + Stripe, multi-repo fixes, hardened LLM I/O                                    |   ✅    |
| E–H  | PDCA full-sweep, pipeline self-heal, SAML SSO, integrations CRUD, Sentry hardening                 |   ✅    |
|  I   | Real `unique_users` blast radius, `StatusStepper`, `PdcaReceiptStrip`, NN/G-compliant `EmptyState`  |   ✅    |
|  J   | Real LLM cost — `llm_invocations.cost_usd`, Billing `LLM $X.XX` chip, Prompt Lab `Avg $ / eval`    |   ✅    |
|  K   | Admin polish — first-action gating, layout-shaped skeletons, `ResultChip`, microinteractions       |   ✅    |
|  L   | Beginner/Advanced mode toggle, Next-Best-Action strip, unified 4-stage PDCA, post-QA fixes         |   ✅    |
| M–Q  | 23-page audit + fix-spec sweep — Quickstart mode, first-run tour, themed dialogs, N+1 dedup        |   ✅    |
|  R   | 7-axis security + perf audit (2026-04-21) — internal-only middleware, expanded PII scrubber, 20 FK indexes, Zod runtime validation, vendor chunks, secrets scanner · [`docs/audit-summary-2026-04-21.md`](./docs/audit-summary-2026-04-21.md) | ✅ |
|  S   | IA rewrite (2026-04-22/23) — Decide/Act/Verify hero on every advanced page, `/repo` live branch graph + `fix_events` stream, dynamic tab titles, favicon critical-badge, nightly-prod-PDCA workflow, resilient embeddings sweep | ✅ |

Handover docs (most recent first) live under [`docs/`](./docs/) — they're the long-form companion to each row above.

</details>

### Honest status — what works, what's still partial

| Area                 | Working                                                                                             | Still partial                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Classification       | Haiku fast-filter, Sonnet deep, **vision air-gap closed + contract-tested**, structured outputs, prompt-cached prompts, **`pg_cron` self-healing every 5 min** | Stage 2 response streaming (Wave S5) — see below               |
| Judge / self-improve | Sonnet judge with **OpenAI fallback** wired, prompt A/B auto-promotion loop (judge → `prompt_versions.avg_judge_score` → `promoteCandidate`) | **Fine-tune vendor promotion**: `finetune_runs` schema exists, the submit-to-OpenAI/Anthropic worker is a stub. Prompt A/B promotion is the shipping mechanism today. |
| Fix orchestrator     | Single-repo `validateResult` gating, GitHub PR creation, **MCP JSON-RPC 2.0** client, multi-repo **data model** + **coordinator worker** (fans out per-repo fix attempts, aggregates per-repo pass/fail) | First-party Claude Code / Codex adapters still wait on vendor APIs. |
| Sandbox              | Provider abstraction; `local-noop` (tests) + `e2b` / `modal` / `cloudflare` (prod-ready, deny-by-default egress, audit-event stream) | —                                                              |
| Verify               | Screenshot diff via Playwright + pixelmatch; **`@mushi-mushi/verify` step interpreter feature-complete** — `navigate`, `click`, `type`, `press`, `select`, `assertText`, `waitFor`, `observe`. | —                                                              |
| Enterprise           | Plugin marketplace + HMAC, audit ingest, region pinning, retention CRUD, Stripe metering + `/billing` UI + invoice list, **SAML SSO via Supabase Auth Admin API** (ACS / Entity ID surfaced for IdP setup), routing-destination CRUD with masked secrets | **OIDC SSO intentionally returns `501 Not Implemented`** — Supabase GoTrue does not yet expose the admin endpoints we'd need. The admin UI exposes the config form so the settings round-trip is tested, but the endpoint is gated. Track Supabase changelog for GoTrue OIDC admin support. |
| Graph backend        | Plain SQL adjacency over `graph_nodes` / `graph_edges` ships in every deployment. | **Apache AGE is a hosted-tier enhancement**: when the AGE extension is installed (self-hosted Postgres 16 or Supabase Enterprise tier) we route graph queries through AGE for >10× traversal speedup. Supabase's managed tier does not ship AGE, so cloud deployments stay on SQL adjacency. |
| Streaming            | Fix-dispatch SSE (CVE-2026-29085-safe sanitization)                                                  | Classification reasoning still arrives whole. Stage 2 `streamObject` conversion lands in Wave S5. |

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

> Most developers only install **one** SDK package — `npx mushi-mushi` picks the right one for you and pulls in `core` and `web` automatically.

| Install                            | Framework               | What you get                                                                              |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `npx mushi-mushi`                  | **Any** (auto-detects)  | One-command wizard — installs the right SDK, writes env vars, prints the snippet          |
| `npm i @mushi-mushi/react`         | React / Next.js         | `<MushiProvider>`, `useMushi()`, `<MushiErrorBoundary>` — drop-in for any React app       |
| `npm i @mushi-mushi/vue`           | Vue 3 / Nuxt            | `MushiPlugin`, `useMushi()` composable, error handler (pair with `web` for the widget UI) |
| `npm i @mushi-mushi/svelte`        | Svelte / SvelteKit      | `initMushi()`, SvelteKit error hook (pair with `web` for the widget UI)                   |
| `npm i @mushi-mushi/angular`       | Angular 17+             | `provideMushi()`, `MushiService`, error handler (pair with `web` for the widget UI)       |
| `npm i @mushi-mushi/react-native`  | React Native / Expo     | Shake-to-report, bottom-sheet widget, navigation capture, offline queue                   |
| `npm i @mushi-mushi/capacitor`     | Capacitor / Ionic       | iOS + Android via Capacitor — shake-to-report, screenshot, offline queue                  |
| `npm i @mushi-mushi/web`           | Vanilla / any framework | Framework-agnostic SDK — Shadow-DOM widget, screenshot, console + network capture         |
| `npm i @mushi-mushi/node`          | Node (Express/Fastify/Hono) | **Server-side** SDK — error-handler middleware, `uncaughtException` hook, W3C trace context |
| `npm i @mushi-mushi/adapters`      | Any Node webhook server | Translate Datadog / New Relic / Honeycomb / Grafana alerts into Mushi reports              |

[![mushi-mushi](https://img.shields.io/npm/v/mushi-mushi?label=mushi-mushi%20(launcher)&color=cb3837)](https://www.npmjs.com/package/mushi-mushi)
[![@mushi-mushi/react](https://img.shields.io/npm/v/@mushi-mushi/react?label=react&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react)
[![@mushi-mushi/vue](https://img.shields.io/npm/v/@mushi-mushi/vue?label=vue&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/vue)
[![@mushi-mushi/svelte](https://img.shields.io/npm/v/@mushi-mushi/svelte?label=svelte&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/svelte)
[![@mushi-mushi/angular](https://img.shields.io/npm/v/@mushi-mushi/angular?label=angular&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/angular)
[![@mushi-mushi/react-native](https://img.shields.io/npm/v/@mushi-mushi/react-native?label=react-native&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/react-native)
[![@mushi-mushi/capacitor](https://img.shields.io/npm/v/@mushi-mushi/capacitor?label=capacitor&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/capacitor)
[![@mushi-mushi/web](https://img.shields.io/npm/v/@mushi-mushi/web?label=web&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/web)
[![@mushi-mushi/node](https://img.shields.io/npm/v/@mushi-mushi/node?label=node&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/node)
[![@mushi-mushi/adapters](https://img.shields.io/npm/v/@mushi-mushi/adapters?label=adapters&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/adapters)
[![@mushi-mushi/cli](https://img.shields.io/npm/v/@mushi-mushi/cli?label=cli&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/cli)
[![@mushi-mushi/mcp](https://img.shields.io/npm/v/@mushi-mushi/mcp?label=mcp&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/mcp)
[![@mushi-mushi/mcp-ci](https://img.shields.io/npm/v/@mushi-mushi/mcp-ci?label=mcp-ci&color=cb3837)](https://www.npmjs.com/package/@mushi-mushi/mcp-ci)

<details>
<summary><b>Internal & native packages</b></summary>

| Package                               | Purpose                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`@mushi-mushi/core`](./packages/core) | Shared engine — types, API client, PII scrubber, offline queue, rate limiter, structured logger. Auto-installed.       |
| [`@mushi-mushi/cli`](./packages/cli)   | CLI for project setup, report listing, triage. `npm i -g @mushi-mushi/cli`                                              |
| [`@mushi-mushi/mcp`](./packages/mcp)   | MCP server — lets Cursor / Copilot / Claude read, triage, classify, dispatch fixes, and run NL queries                  |
| [`@mushi-mushi/mcp-ci`](./packages/mcp-ci) | GitHub Action that calls the MCP tools from CI — gate PR merges on classification coverage, dispatch fixes on label  |
| [`@mushi-mushi/plugin-sdk`](./packages/plugin-sdk) | Build third-party plugins — signed webhook verification, REST callback client, framework adapters              |
| [`@mushi-mushi/plugin-jira`](./packages/plugin-jira) | Bidirectional Mushi ↔ Jira Cloud sync (OAuth 3LO, status transitions, fix comments)                          |
| [`@mushi-mushi/plugin-slack-app`](./packages/plugin-slack-app) | First-class Slack app — `/mushi` slash command, signing-secret verification, App Manifest           |
| [`@mushi-mushi/plugin-linear`](./packages/plugin-linear) | Reference plugin — create + sync Linear issues from Mushi reports                                        |
| [`packages/ios`](./packages/ios)       | Native iOS SDK (Swift Package Manager) — early dev                                                                      |
| [`packages/android`](./packages/android) | Native Android SDK (Maven `dev.mushimushi:mushi-android`) — early dev                                                  |

</details>

<details>
<summary><b>Backend packages</b> (BSL 1.1 → Apache 2.0 in 2029)</summary>

| Package                | Purpose                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mushi-mushi/server`  | Edge functions — classification pipeline, knowledge graph, fix dispatch + SSE, RAG indexer, vision air-gap, judge with OpenAI fallback, plugin runtime |
| `@mushi-mushi/agents`  | Agentic fix orchestrator — `validateResult` gating, GitHub PR creation, sandbox abstraction, MCP JSON-RPC 2.0 client, multi-repo coordinator                                  |
| `@mushi-mushi/verify`  | Playwright fix verification — screenshot visual diff + feature-complete step interpreter (`navigate`, `click`, `type`, `press`, `select`, `assertText`, `waitFor`, `observe`). Attach step arrays _at call-time_ via `verifyFix({ steps })` and correlate runs to an attempt with `verifyFix({ fixAttemptId })` — the verifier replays, diffs, writes `fix_verifications`, and mirrors the result into `fix_attempts.verify_steps` so the judge can answer "did attempt X verify?" without a timestamp join. |

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

> **Internal edge functions** (`fast-filter`, `classify-report`, `fix-worker`, `judge-batch`, `intelligence-report`, `usage-aggregator`, `soc2-evidence`, `generate-synthetic`) authenticate via the shared `requireServiceRoleAuth` middleware, which accepts **either** `MUSHI_INTERNAL_CALLER_SECRET` (used by `pg_cron` → `pg_net`, mirrored into `public.mushi_runtime_config.service_role_key`) or the auto-injected `SUPABASE_SERVICE_ROLE_KEY` (used for function-to-function calls). Never expose them with `--no-verify-jwt` in production. Only the public `api` function should face the internet. See [`packages/server/README.md`](./packages/server/README.md#internal-caller-authentication-sec-1).

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

## Payment & support operations

The hosted product wires three feedback loops so the operator hears from paying customers fast:

| Channel                              | Trigger                                                                                                                                                          | Where it shows up                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Stripe webhooks → operator push**  | `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`, `cancel_at_period_end → true`, `invoice.payment_succeeded` (recovery only) | Slack and/or Discord via `OPERATOR_SLACK_WEBHOOK_URL` / `OPERATOR_DISCORD_WEBHOOK_URL` |
| **Stripe Dashboard email digests**   | Same events natively, plus dispute / refund flows                                                                                                                 | The Stripe Dashboard email recipient list (configured in the Dashboard UI)    |
| **In-app support inbox**             | Paid (or free) customer submits the BillingPage "Need help?" form                                                                                                | `support_tickets` table + operator push + audit log + reply to `SUPPORT_EMAIL` |

How each piece works:

- **Operator push** (`packages/server/supabase/functions/_shared/operator-notify.ts`): a single helper that knows how to render Slack Block Kit *and* Discord rich embeds. Severity drives colour; `urgent` pings `@here` on Discord. Failures are captured to Sentry but never block the webhook from 200-ing back to Stripe.
- **In-app support form** (`/v1/support/contact`): JWT-gated, rate-limited to 5 tickets/hour/user, captures plan tier at submit time so paid tickets jump the queue. Customer sees status updates inline on `/billing`. PII (passwords, API keys) explicitly called out as off-limits in the form copy.
- **Centralised support address** (`SUPPORT_EMAIL` env var, defaults to `kensaurus@gmail.com` — the maintainer's inbox; there is no `*@mushimushi.dev` mailbox, that domain is branding/URLs only): used in the Checkout `custom_text`, the BillingPage "Need help?" mailto, and the rate-limit error message. **Self-hosters must override this** so their tenants don't email the upstream maintainer.

To enable the operator push for a self-hosted instance:

```bash
# 1. Create a Slack incoming webhook (api.slack.com/messaging/webhooks)
#    OR a Discord channel webhook (server settings → integrations → webhooks).
# 2. Push the secret to Supabase:
supabase secrets set OPERATOR_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
# or
supabase secrets set OPERATOR_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
# 3. Override the support address (defaults to kensaurus@gmail.com — the
#    upstream maintainer's inbox; self-hosters MUST set this):
supabase secrets set SUPPORT_EMAIL=ops@yourdomain.com
# 4. Redeploy the api + stripe-webhooks functions:
supabase functions deploy api stripe-webhooks
```

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
| `pnpm check:secrets` | Scan the whole tree for leaked AWS / Stripe / Slack / GitHub / OpenAI / Anthropic / Supabase / JWT tokens. Also runs staged-only on every commit via the auto-installed `pre-commit` hook. |
| `pnpm check:design-tokens` | Flag Tailwind classes in `apps/admin/` that reference retired aliases (`success*` / `error*` / `surface-subtle`) or typo against real `--color-*` namespaces defined in `apps/admin/src/index.css`. Catches the "invisible transparent element" bug class at commit time. |
| `pnpm check:catalog-sync` | Verify `packages/mcp/src/catalog.ts` and its admin mirror `apps/admin/src/lib/mcpCatalog.ts` haven't drifted. |
| `pnpm check:publish-readiness` | Assert every publishable `package.json` has `name`, `version`, `license`, `engines.node >=20`, `repository.directory`, `files` (incl. README + LICENSE), and `exports`/`main` or `bin`. Runs in CI and the release workflow before `changeset publish`. |
| `pnpm check:license-headers` | Assert every package's `license` field matches its folder's canonical license (BSL for `server` / `agents` / `verify`, MIT for the rest) and that a matching `LICENSE` file exists. |
| `pnpm check:dead-buttons` | Grep `apps/admin/**/*.tsx` for `<button disabled>` / `disabled={true}` with no `aria-label` or tooltip — catches "button exists but does nothing" regressions at commit time. |
| `pnpm size`       | Run `size-limit` against the built `@mushi-mushi/web` bundle (15 KB gzipped budget). |
| `pnpm e2e`        | Run the full-PDCA Playwright dogfood suite in `examples/e2e-dogfood/`. Assumes Supabase + admin + the dogfood app are already running locally — see the workspace README for setup. |

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
  core, web, react, vue, svelte, angular,                 # Web / framework SDKs (MIT)
  react-native, capacitor, node, adapters
  ios, android, flutter                                   # Native SDKs (early dev)
  cli, mcp, mcp-ci, launcher, create-mushi-mushi          # Tooling + CI gate
  server, agents, verify                                  # Backend (BSL 1.1)
  plugin-sdk, plugin-jira, plugin-slack-app,              # Plugin marketplace
  plugin-linear, plugin-pagerduty, plugin-zapier, plugin-sentry
  wasm-classifier                                         # On-device pre-classifier (ONNX)
apps/
  admin    # React 19 + Tailwind 4 + Vite 8 (dark-only by design, 24 pages)
  docs     # Nextra v4 documentation site
  cloud    # Next.js 15 marketing landing + Stripe billing
examples/
  react-demo, e2e-dogfood
deploy/    # Docker Compose + Helm chart
tooling/   # Shared ESLint + TypeScript configs
scripts/   # Zero-dependency pre-commit + CI guards (secrets / tokens / dead-buttons / changelog aggregate / …)
```

</details>

---

## Contributing

Issues and PRs welcome. To get started: `pnpm install && pnpm dev`. See individual package READMEs for package-specific setup, and the latest handovers (newest first) under [`docs/`](./docs/) — [`HANDOVER-2026-04-21-console-elevate.md`](./docs/HANDOVER-2026-04-21-console-elevate.md) is the current state of play; Wave S (Decide/Act/Verify hero, `/repo` page, dynamic titles, favicon badge, nightly prod PDCA) lands on top of it via subsequent PRs.

## License

- **SDK packages** (core, web, react, vue, svelte, angular, react-native, cli, mcp): [MIT](./LICENSE)
- **Server, agents, verify**: [BSL 1.1](./packages/server/LICENSE) — converts to Apache 2.0 on April 15, 2029

---

<div align="center">
<sub>もしMushi-chanのお役に立てたら、⭐ をひとつ — next devs find the repo faster that way. <a href="https://github.com/kensaurus/mushi-mushi/stargazers">Star the repo</a> · <a href="https://github.com/kensaurus/mushi-mushi/issues/new/choose">Open an issue</a> · <a href="https://bsky.app/profile/mushimushi.dev">Follow Mushi on Bluesky</a></sub>
</div>
