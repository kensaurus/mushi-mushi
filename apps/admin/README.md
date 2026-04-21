# @mushi-mushi/admin

Admin console for Mushi Mushi — report triage, analytics dashboard, knowledge graph visualization, and project settings.

## Tech Stack

- React 19 + React Router 7
- Tailwind CSS v4 (CSS-first `@theme` tokens)
- Vite 8
- Supabase Auth + Realtime

## Live Demo

**https://kensaur.us/mushi-mushi/** — sign up and explore. No setup required.

## Getting Started

### Cloud mode (zero setup)

```bash
cd apps/admin
pnpm dev    # Starts on http://localhost:6464
```

No `.env` needed. The console auto-connects to Mushi Mushi Cloud. Sign up from the login page and start using immediately.

### Self-hosted mode (bring your own Supabase)

```bash
cd apps/admin
cp .env.example .env    # Fill in your Supabase credentials
pnpm dev
```

The console detects a non-cloud `VITE_SUPABASE_URL` and switches to self-hosted mode automatically. Shows connection diagnostics and Supabase host info.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | No | Supabase project URL. Defaults to Mushi Mushi Cloud |
| `VITE_SUPABASE_ANON_KEY` | No | Supabase anonymous key. Defaults to cloud key |
| `VITE_API_URL` | No | Override API base URL (defaults to Supabase functions) |
| `VITE_INSTANCE_TYPE` | No | Force `self-hosted` mode (auto-detected otherwise) |
| `VITE_BASE_PATH` | No | Public base path for the build. Defaults to `/`. The CloudFront deployment sets this to `/mushi-mushi/` in `.github/workflows/deploy-admin.yml` |

## Design System

Tokens are defined in `src/index.css` using Tailwind v4's `@theme` directive. Shared UI primitives live in `src/components/ui.tsx`. Color maps and status tokens are in `src/lib/tokens.ts`.

### Surface hierarchy

`surface-root` (sidebar) → `surface` (main bg) → `surface-raised` (cards) → `surface-overlay` (hover)

### Semantic colors

`brand` (amber), `accent` (violet), `ok` (green), `warn` (amber), `danger` (red), `info` (blue)

### UI primitives (`src/components/ui.tsx`)

Layout & content:

- `PageHeader`, `PageHelp` — consistent page chrome with collapsible "what / when / how" help block. `PageHeader` accepts an optional `projectScope` prop so list pages can render `Reports · glot-it` and the active project name stays visible across the loop. `PageHelp` defaults open only on the user's first ever visit (single global `mushi:visited` flag in `localStorage`) and persists per-page dismissal in `localStorage[mushi:pagehelp:dismissed:${title}]`, so first-time learners get the explainer but returning admins aren't bombarded with re-opened help on every page they navigate to (Wave K)
- `Section` — titled section with optional leading `icon` (e.g. `IconUser`, `IconSparkle`, `IconCamera` from `icons.tsx`)
- `Card`, `Divider`, `Loading`, `Skeleton`, `ErrorAlert`, `StatCard`. Layout-shaped skeletons live in `src/components/skeletons/` (`DashboardSkeleton`, `TableSkeleton`, `DetailSkeleton`, `PanelSkeleton`) and replace 22 page-level `<Loading />` spinners — first paint matches the loaded layout instead of a tiny spinner over an empty page. Each accepts a `label` for `aria-label` and sets `role="status" aria-busy="true"`. `TableSkeleton` accepts `rows / columns / showFilters / showKpiStrip` so callers can shape it for their layout; `PanelSkeleton` accepts `inCard` so settings sub-panels (which already live inside a `<Section>`) don't double-wrap
- `EmptyState` — NN/G-compliant empty: `title` (status line) + `description` (learning cue) + optional `hints` bullet list + optional `action` (direct path) + optional `icon`. Use this everywhere instead of bespoke "no results" cards so the three legs of empty-state design are always present

Field rendering:

- `Field` — label / value pair; supports `tooltip` (jargon hint), `copyable`, and a custom `valueClassName`
- `IdField` — UUID/hash renderer with truncated prefix, copy-on-click, and a tooltip showing the full value
- `RelativeTime` — "3h ago" with the full ISO timestamp on hover
- `CopyButton`, `InfoHint` — one-click copy and an `i`-icon tooltip for inline use

Status-aware guidance:

- `RecommendedAction` — single-sentence "what to do next" card with one CTA, used on the Report Detail page and across `Reports`, `DLQ`, `Fixes`, and `Health`. Tones: `urgent` / `info` / `success` / `neutral`. CTA accepts `to` (router link), `href` (external), or `onClick`.

Media:

- `ImageZoom` — click-to-zoom modal for screenshots (Esc to close, no library dependency)

Forms & controls:

- `Btn`, `Input`, `Textarea`, `Checkbox`, `Toggle`, `SelectField`, `FilterSelect`, `Tooltip`, `Kbd`, `Badge`. `Btn` accepts a `loading` prop that swaps the leading icon for a spinner and sets `aria-busy`, so callers don't have to toggle text manually — adopted across `ReportTriageBar`, `HealthPage` cron triggers, BYOK / Firecrawl / Health quick-tests, and Billing invoice retry

Action receipts:

- `ResultChip` — persistent inline receipt for Test / Run / Trigger buttons (`✓ Connection OK · 2s ago` / `✕ Auth failed · just now`). Five tones (`idle / running / success / error / info`) with matching glyphs, spinner glyph for `running`. `aria-live="polite"` (or `"assertive"` for errors), optional `at` prop renders a `<RelativeTime>` so the chip doubles as "when did this last succeed?". Used by `BYOK / Firecrawl / Health` quick-tests so users never have to hunt for "did it actually work?" (Wave K). **Wave U** widened adoption to the highest-traffic actions: `JudgePage`'s `Run judge now` (sticky chip with the dispatched count + "refreshing in 30s" — survives the toast), `OnboardingPage`'s `Submit test report`, and `FirstReportHero`'s `Send test report` on the dashboard

Loading + entrance animations:

- **`Btn loading={...}`** — every Test / Run / Save / Generate / Dispatch button across the 23 pages goes through the same `loading` prop instead of swapping its label to a `-ing` form. The verb stays stable, the spinner does the work, and buttons no longer change width mid-click. Audit + sweep landed in Wave U — 25 files including `ConnectionStatus`, `ReportComments` Post, `DLQPage` Flush queued, `StoragePage` Health check + Save, `BillingPage` Manage + Plan select + Send ticket, `IntelligencePage` Generate, every `prompt-lab` / `marketplace` / `graph` modal save, and the `AntiGamingPage` Flag / Unflag row actions
- **`useStaggeredAppear`** (`src/lib/useStaggeredAppear.ts`) — returns a `style` callback for `.map()` callsites so consecutive items fade in with a small per-index delay (default 35ms step, capped at index 10). `motion-safe:animate-mushi-fade-in` does the actual keyframe; the hook just sets `animationDelay` + `animationFillMode: 'both'` so the very first paint doesn't flash items at full opacity. Used by `InsightsRow` and (Wave U) `FixesPage`'s fix-card list, with `ReportsPage` running an inline equivalent per-row from Wave M

### Label helpers (`src/lib/tokens.ts`)

Always render statuses, severities, and pipeline states through the helper functions instead of raw snake_case strings:

- `statusLabel(status)` — `"queued" → "Queued"`, `"ready_for_review" → "Ready for review"`, etc.
- `severityLabel(severity)` — `"critical" → "Critical"`
- `pipelineStatusLabel(stage)` — `"dead_letter" → "Dead letter"`, `"in_progress" → "In progress"`

Color tokens for the same dimensions live in `STATUS`, `SEVERITY`, and `PIPELINE_STATUS`.

### Format helpers (`src/lib/format.ts`)

Pure, dependency-free string utilities. Use these instead of inline `count === 1 ? 'fix' : 'fixes'` ternaries:

- `pluralize(count, single, plural?)` — picks the right form, falling back to `${single}s` for regular plurals
- `pluralizeWithCount(count, single, plural?)` — `2 reports`, `1 fix`, `0 attempts`

## Information architecture (PDCA loop)

The sidebar (`src/components/Layout.tsx`) groups the 23 admin pages into the same Plan → Do → Check → Act loop the README sells, so first-day users see the story instead of jargon-heavy nav items:

- **Start here** — `Dashboard`, `Get started`
- **Plan — capture & classify** — `Reports`, `Graph`, `Anti-Gaming`, `Queue`
- **Do — dispatch fixes** — `Fixes`, `Prompt Lab`
- **Check — verify quality** — `Judge`, `Health`, `Intelligence`, `Research`
- **Act — integrate & scale** — `Integrations`, `Marketplace`, `Notifications` — standardise verified fixes back into the upstream tools your team already lives in
- **Workspace** (account / identity / admin — outside the bug-fix loop) — `Projects`, `Settings`, `SSO`, `Billing`, `Audit Log`, `Compliance`, `Storage`, `Query`

`SSO` and `Billing` deliberately sit in **Workspace**, not Act — they're one-time admin / account concerns that don't iterate every loop. Act is reserved for tabs that turn a verified fix into something the rest of the team's toolchain consumes.

Each section header carries a stage badge (`P` / `D` / `C` / `A`) and a tooltip explaining the PDCA phase. The Dashboard page mirrors this with a `PdcaCockpit` strip — see [Dashboard composition](#dashboard-composition) below.

### Quickstart / Beginner / Advanced modes (Wave L → N)

The console ships in **Quickstart mode** (Wave N — the audit's "plug n play" answer) by default. A 3-state pill at the top of the sidebar flips between Quickstart → Beginner → Advanced. State is persisted in `localStorage:'mushi:mode'` and broadcast in-tab via a `mushi:mode-change` `CustomEvent`, so every NavLink, copy block, and `<NextBestAction>` re-renders without a route change. The hook is `useAdminMode()` from `src/lib/mode.ts` (`isQuickstart / isBeginner / isAdvanced`).

| Mode | Sidebar | Page copy | Extras |
|------|---------|-----------|--------|
| **Quickstart** (default) | **3 verb-led pages** — Setup, Bugs to fix, Fixes ready | Verb-first, jargon-free from `lib/copy.ts` ("Bugs to fix", "Fixes ready") — **no PDCA terminology surfaces at all** | "Resolve next bug →" mega-CTA above page content; `<LivePdcaPipeline>` storyboard on Dashboard; `<FirstRunTour>` auto-launches once |
| **Beginner** | 9 loop-essential pages (Dashboard, Get started, Reports, Graph, Fixes, Judge, Health, Integrations, Settings) | Outcome-first ("Your bug-fix loop", "Bugs your users felt") | `<NextBestAction>` strip on every page; `<LivePdcaPipeline>` storyboard; `<Jargon>` underlines tooltips for jargon nouns |
| **Advanced** | All 23 pages | Dense, jargon-rich ("PDCA cockpit", "Triage queue") | Power-user density; no NBA strip; `<Jargon>` is a no-op |

Routes resolve in **every mode** — only the sidebar is filtered, so deep links + bookmarks survive. If a quickstart/beginner user lands on a route hidden from their sidebar (autocomplete, link-share), the sidebar surfaces a "this page lives in Advanced mode — switch to keep it in your sidebar" hint.

### First-run interactive tour (Wave N)

`<FirstRunTour>` (`components/FirstRunTour.tsx`) is a custom 250-line coach-marks component — no `react-joyride` dependency, so it inherits the dark theme tokens, adds zero bundle weight, and never fights the design system. Five stops keyed by `data-tour-id` selectors:

1. **Plan** (`pdca-plan` on the Dashboard) — "Each tile is a stage of the loop"
2. **Reports** (`reports-row` on `/reports`) — "Each row has a screenshot, console log, and reproduction steps"
3. **Dispatch** (`dispatch-fix-button` on `/reports`) — "Click here to send the bug to the auto-fix agent"
4. **Fixes** (`fix-card` on `/fixes`) — "Auto-drafted PRs land here with judge scores and screenshot proof"
5. **Mode** (`mode-toggle` in the sidebar) — "Quick = 3 pages. Beginner = 9. Advanced = 23"

Auto-launches once when `localStorage:'mushi:tour-v1-completed' !== 'true'` AND the active project exists AND the user is on the dashboard (so anchors are mounted). Stops 2–4 silently skip when the active project has zero reports; the tour resumes from where it stopped after the first report lands. The `/onboarding` footer exposes `restartFirstRunTour()` so users can replay it anytime. Spotlight uses a darkened backdrop + bright cutout around the anchored element; ESC and "Don't show again" both dismiss permanently.

Three primitives back the mode split:

- **`lib/copy.ts`** — `COPY: { beginner, advanced }` keyed by route → `{ title, description, sections, help }`. `usePageCopy(path)` returns the active block; pages do `<PageHeader title={copy?.title ?? 'Reports'} />` with the hard-coded fallback. Adding outcome copy for a new route is one entry, not a sweep across 23 pages.
- **`lib/mode.ts`** — `useAdminMode()` returns `{ mode, setMode, toggle, isBeginner, isAdvanced }`. Cross-tab via `storage` event, in-tab via custom event, both wrapped in try/catch for private-browsing safety.
- **`components/Jargon.tsx`** — `<Jargon term="dispatch">Dispatch fix</Jargon>` renders an `<abbr>` with a dotted underline + plain-language tooltip in beginner mode and the bare word in advanced. Definitions live in `JARGON` in `lib/copy.ts` so renaming a term updates every surface.

## First-Run Experience

The console operates in two modes — auto-detected from env vars:

### Cloud mode (default)
1. **Clean login** — branded sign-in page with no infrastructure details
2. **Quickstart-mode shell** (Wave N, default) — new admins land in a 3-page Quickstart shell (Setup, Bugs to fix, Fixes ready) with verb-led labels and zero PDCA terminology. Switch up to Beginner or Advanced from the sidebar pill anytime
3. **First-run interactive tour** (Wave N) — `<FirstRunTour>` auto-launches once per browser the first time the user reaches the dashboard with an active project. Five spotlight stops walk through Plan → Reports → Dispatch → Fixes → Mode toggle. Stops that need real data silently skip when `report_count === 0` and resume after the first report lands. ESC, "Don't show again", and finishing the last stop all set `localStorage:'mushi:tour-v1-completed' = 'true'` so the tour stays out of the way after the first session. The `/onboarding` footer exposes a `restartFirstRunTour()` button so users can replay it
4. **Onboarding wizard** — guides through: create project, generate API key, test connection, copy SDK snippet
5. **Dashboard getting started** — when the user has 0 reports, `GettingStartedEmpty` renders a PDCA-framed first-run script (Plan → Do → Check) on top of the existing setup checklist, so the next action is always one click away
6. **Next-best-action strip** — `<NextBestAction>` (mounted in `Layout.tsx`) computes the single next move per page from `useSetupStatus` + active project counters, in PDCA-aligned tone. Rule order *is* the beginner journey ("create project → install SDK → send test report → dispatch fix → review PR → wire routing"), so the strip always pulls the user forward, never sideways. Animates a "✓ Done — next: X" handoff for ~1.4 s when the gate flips. Suppressed on `/` and `/onboarding` (those pages have a stronger first-action surface)
7. **First-fix-merged celebration** — when `merged_fix_count` flips 0 → 1, `useMilestoneCelebration` ('first-merged-fix' key, persisted in `localStorage`) fires `<Confetti>` and a toast with a `View merged fixes` SPA-route CTA. Once-per-browser; localStorage access is wrapped in try/catch so private-browsing modes degrade silently

### Self-hosted mode
1. **Environment gate** — if Supabase credentials are missing, a setup page offers two paths: connect to Mushi Cloud (copy-paste) or bring your own Supabase
2. **Diagnostics login** — shows Supabase host, connection health indicator, and actionable error messages
3. **Onboarding wizard** — same as cloud mode
4. **Dashboard getting started** — same as cloud mode, with connection diagnostics

### Debug Mode

Enable diagnostic console logging via:
- Settings → Developer Tools → Debug mode toggle
- `?debug=true` URL parameter
- `localStorage.setItem('mushi:debug', 'true')`

Logs all API calls (URL, status, latency), auth state changes, and response details.

## Authentication

- **Sign in** — email + password
- **Sign up** — creates account, sends branded confirmation email, shows "check your email" feedback
- **Forgot password** — sends reset link; user clicks link → lands on `/reset-password` to set new password
- **Email redirect** — confirmation and recovery emails redirect to the correct origin (cloud or localhost) via `emailRedirectTo`

Email templates are branded HTML stored in `packages/server/supabase/templates/`.

## Pages

| Route | Page |
|-------|------|
| `/login` | Sign in / Sign up / Forgot password |
| `/reset-password` | Set new password after recovery link |
| `/` | Dashboard — **`PdcaCockpit`** strip up top (4 stage tiles with the bottleneck stage ringed + a single-sentence callout), then stat cards and category/severity breakdowns; **`QuotaBanner`** above KPIs surfaces any project ≥50% of its monthly free-tier report quota (warn / danger tones, deep-links to `/billing`); **`FirstReportHero`** when the SDK is installed but no reports have landed (one-tap "Send test report" CTA); PDCA-framed `GettingStartedEmpty` when no project exists yet |
| `/onboarding` | First-run setup wizard (project, API key, test, SDK snippet). The active step is highlighted with a "do this next" chip + brand ring on the checklist row, and the banner version auto-collapses once required steps are done **or** completion ≥ 80% |
| `/reports` | Filterable report list (status / category / severity / `component` / `reporter`); top of page shows a **`ReportsKpiStrip`** with 14-day severity rollups; rows render a **`StatusStepper`** (`new → classified → fixing → fixed`) instead of a static badge, a 4 px left-edge severity stripe, a `+N similar` badge for deduped reports (driven by `report_group_id`), an **`unique_users` blast-radius column** powered by a `COUNT(DISTINCT)` Postgres RPC, and a single primary action button — `Triage →` / `Dispatch fix →` (gated on `DISPATCH_ELIGIBLE_STATUSES`). Group-by-fingerprint collapse is on by default (`?group=fingerprint`); expanded groups persist in `?expand=<id>` so deep links restore state |
| `/reports/:id` | Report detail — **`ScreenshotHero`** at the top (large zoomable screenshot), then a **`PdcaReceiptStrip`** that compresses the lifecycle into 4 stamps (Plan / Do / Check / Act) using `llm_invocations`, `fix_attempts`, and `classification_evaluations` data fetched in a single API round-trip; recommended next action, triage bar, LLM classification, environment, console / network / performance (always rendered with empty states), related cross-links (component, reporter, graph, fix) |
| `/queue` | Pipeline queue — paginated backlog by stage/status, throughput sparkline, retry actions, **Force-process queued** button (kicks `POST /v1/admin/queue/flush-queued` to drain stuck `status='queued'` reports), DLQ inspector |
| `/graph` | Knowledge graph — auto-switches between two views: a Sankey-style **`GraphStoryboard`** (left-to-right columns by `node_type` with bezier links + the **most-affected node** named under each column header + an inline edge-weight legend) when fewer than 12 nodes exist, and the full React Flow canvas otherwise. Filter chips are grouped (`Show node types` / `Connect via edges`) with `all` toggles. Minimap is suppressed on small graphs to avoid clutter. Toggleable "Table" view renders nodes + edges as accessible HTML tables for screen readers; canvas has `role="region"` + descriptive `aria-label`. A "Force canvas view" override is available when the storyboard threshold trips by accident |
| `/judge` | Judge dashboard — KPI row, score-over-time trend with a colour-coded dimension legend (Overall / Accuracy / Severity / Component / Repro), score distribution histogram, prompt-version leaderboard, "Run judge now" button. Recent evaluations table renders the **report summary** (not the opaque `report_id` hash) and abbreviated columns (`Acc / Sev / Comp / Repro / Agreed`) carry hover tooltips explaining each dimension |
| `/query` | Ask Your Data — natural-language → SQL with a **Saved sidebar** (pin a question with `★`), persistent history (per user, with rerun / unpin / delete row actions), an **SQL hints card** that seeds the input with effective phrasings, sanitised LLM output (trailing `;` and inline comments stripped), explanation, generated SQL, and result table |
| `/fixes` | Auto-fix PDCA — KPI summary (last 30d), daily volume sparkline, per-fix branch graph (`FixGitGraph`) overlaying dispatch → branch → commit → PR → CI → merge, retry button |
| `/projects` | Project management + API keys, with toast feedback for create / generate / revoke. Each project card surfaces a **`PdcaBottleneckPill`** (Plan / Do / Check / Act tone) labelled with the most-urgent stalled stage and deep-linking straight to that page (e.g. "3 fixes need retry → /fixes") |
| `/integrations` | Sentry, Langfuse, GitHub App + routing destinations (Jira, Linear, GitHub Issues, PagerDuty) — `HealthPill` per integration, full CRUD editor for routing credentials with masked-secret pass-through, sidebar health dot. Each unconfigured platform / provider card lists `capabilitiesOnceConnected` ("what you can do once it's connected") so the user can see the value before handing over a token |
| `/sso` | SAML / OIDC self-service — provider name, metadata URL, entity ID, email domains. SAML registers via Supabase Auth Admin API and surfaces ACS URL + Entity ID for the IdP; OIDC currently writes config and shows a "register in dashboard" hint pending GoTrue admin support. Disconnect drops the row + the registered provider |
| `/audit` | Audit log with CSV export and an **Actor type** filter (`human` / `agent (LLM)` / `system (cron / webhook)`), driven by an `actor_type` query param on the API |
| `/prompt-lab` | Prompt Lab (replaces `/fine-tuning`) — leaderboard of prompt versions, A/B traffic split, dataset preview, clone / activate / delete. Diff modal compares parent vs candidate across `Evaluations`, `Avg judge score`, **and `Avg $ / eval`** (real cost from `llm_invocations.cost_usd`, lower-is-better tone). `/fine-tuning` redirects here |
| `/health` | LLM and cron job health — fallback rate, latency, last-run status (live via Realtime) |
| `/anti-gaming` | Reporter-token abuse detection — flagged devices and event log. Identical events (same `event_type` + `reason` + `reporter_token_hash` + `ip_address`) are aggregated client-side into a single row with a count + expand-to-see-each-occurrence; a "Group identical" toggle disables the aggregation when forensics need every row |
| `/notifications` | Reporter-facing notifications — classified, fixed, reward events |
| `/intelligence` | Bug Intelligence — async generation queue with progress card (cancellable), recent reports |
| `/storage` | Per-project storage overrides (S3 / R2 / GCS / MinIO / Supabase) with health check + toast feedback. A **Per-project usage** table (object count + last write timestamp, sourced from the new `/v1/admin/storage/usage` endpoint) sits above the provider cards so admins can spot the project burning through storage at a glance |
| `/billing` | Per-project Stripe billing — plan badge, monthly **usage bar with a forecast band** ("on pace to hit the limit in N days" — `danger` / `warn` / `muted` tones), an **`LLM $X.XX` chip** showing real LLM dollars spent this billing month (sourced from `llm_invocations.cost_usd`), Upgrade / Manage Subscription, recent invoices list |
| `/compliance` | GDPR / SOC2 evidence and obligation tracker — Refresh evidence + an **Export PDF** button (`window.print()` + `@media print` CSS hide the app shell, expand link hrefs, avoid breaking cards across pages) so compliance officers can drop a clean snapshot into an audit folder |
| `/marketplace` | Plugin marketplace — install / uninstall, dispatch log, severity / event filters |
| `/settings` | Project configuration, connection health, pipeline test, debug toggle |

### Page primitives

Every analytical page reuses the same visual vocabulary from `src/components/charts.tsx`:

- `KpiRow` + `KpiTile` — clickable KPIs with `accent`, `delta` ({ value, direction, tone }), and optional `to` deep link
- `LineSparkline`, `BarSparkline`, `Histogram`, `SeverityStackedBars` — minimal SVG/HTML charts that respect the design tokens
- `StatusPill`, `HealthPill`, `LegendDot` — semantic status rendering shared between Dashboard, Judge, Queue, Fixes, and Prompt Lab
- `FixGitGraph` (`src/components/FixGitGraph.tsx`) — inline SVG branch graph for a single fix attempt's PDCA timeline

### Dashboard composition

`DashboardPage` is built from focused sub-components in `src/components/dashboard/`:

- **`LivePdcaPipeline`** (Wave L, beginner mode only) — clickable Plan→Do→Check→Act storyboard rendered above the cockpit. Each node shows the plain-language outcome (from `lib/pdca.ts > PDCA_STAGE_OUTCOMES`) and deep-links to the page that owns the stage. The header CTA *"Watch a bug travel through Mushi"* fires a real `POST /v1/admin/projects/:id/test-report`, animates the four stages in sequence (~1.1 s/stage), and toasts a `View report` action when the synthetic report lands. Hidden in advanced mode (`PdcaCockpit` covers power-user needs). Solves the audit's #1 finding: new users couldn't tell what Mushi *does*
- **`PdcaCockpit`** — top-of-page strip rendered under the heading **"Loop status — Plan, Do, Check, Act"** (Wave K renamed the visible copy from the jargon-heavy "PDCA cockpit"; the component name stays for code-search continuity). Renders 4 stage tiles (Plan / Do / Check / Act). Each tile shows one big living number, a stage tone (`ok` / `warn` / `urgent`), a one-line bottleneck caption, a deep-link CTA, **and a 7-day momentum spark** (Wave L — backed by the new `series` field on each `pdcaStages[*]`). The `focusStage` from the API gets a coloured ring; `urgent` stages also surface a full-width "Resolve →" callout below the strip. Backed by the `pdcaStages` + `focusStage` block on `GET /v1/admin/dashboard`
- **`FirstReportHero`** — promoted CTA shown when the SDK is installed but no reports have arrived (driven by `useSetupStatus`). One big "Send a test report" button so the user can close the loop without leaving the dashboard
- **`GettingStartedEmpty`** — reused inside the dashboard when no project exists yet. PDCA-framed first-run script (Plan: install SDK → Do: dispatch a fix → Check: watch it land) wrapping the existing `SetupChecklist` primitive
- **`Confetti`** + **`useMilestoneCelebration`** (Wave L) — pure-CSS confetti burst (no third-party library) that fires once-per-browser when `setup.activeProject.merged_fix_count` first reaches `>= 1`. Honours `prefers-reduced-motion` via the `motion-safe:` Tailwind variant. The peak-end celebration of the whole loop
- **`KpiRow`**, **`ChartsRow`**, **`TriageAndFixRow`**, **`InsightsRow`**, **`QuotaBanner`** — pre-existing rows preserved beneath the cockpit (the legacy `QuickFiltersCard` was retired; severity / status filters live on the Reports page itself now)

Shared shapes for these components live in `src/components/dashboard/types.ts` (`PdcaStageId`, `PdcaStage`, `DashboardData`, etc.).

### Knowledge graph composition

`GraphPage` is composed from `src/components/graph/`:

- **`GraphCanvas`** — React Flow wrapper for dense graphs. Accepts a `showMinimap` prop (defaults `true`) so callers can suppress the minimap on sparse graphs
- **`GraphStoryboard`** — Sankey-shaped fallback for sparse graphs (<12 nodes by default). Buckets nodes by `node_type` into vertical columns and draws SVG bezier links between connected nodes. Fires the same `onSelect` callback the canvas uses, so the side-panel and blast-radius logic Just Work
- **`GraphFilters`** — quick-views, search, and grouped node-type / edge-type chip rows
- **`GraphSidePanel`**, **`GraphLegend`**, **`GraphTableView`**, **`NodeChip`** — pre-existing supporting components

Async UX & reliability:

- `useToast` (`src/lib/toast.tsx`) — global toast provider with `success / error / warn / info` tones; accepts `message` as an alias for `title` for ergonomic call sites. **Wave L hardening:** pause-on-hover/focus (so users can read the message), optional `action` slot for inline `Undo` / `View report` CTAs, stack cap (3 — oldest auto-dismisses on overflow), visible drain progress bar (`animate-mushi-toast-progress`), `focus-visible` ring + larger hit-target on dismiss, dismiss is a real `<button>` (not a glyph) for screen readers
- `usePageData` (`src/lib/usePageData.ts`) — StrictMode-safe GET hook (per-mount abort flag, stable `reload` callback, optional `deps`). On manual `reload()` it forwards `cache: 'no-store'` to `apiFetch` so explicit refreshes always bypass the micro-cache and fetch fresh data
- `useMergedErrors` (`src/lib/useMergedErrors.ts`, Wave P) — merges loading + error state of N parallel `usePageData` queries into one decision the page can render against. `loading` is true while any query is loading on first paint (subsequent reloads are reported per-query so background refresh doesn't flash skeletons); `error` is the first non-null error with the failing query's label so the message can name what failed; `retry` reloads every query that errored so the user gets a single button instead of N. Adopted on `JudgePage`, `IntegrationsPage`, `CompliancePage`, `AntiGamingPage`
- `apiFetch` request dedup + micro-cache (`src/lib/supabase.ts`, Wave Q) — concurrent GET/HEAD requests with the same path+body are coalesced onto one in-flight promise; resolved values are kept in a 200ms TTL cache so back-to-back component mounts don't re-fetch. Killed the N+1 storm where `/v1/admin/setup` fired 24× per page load (12× from React StrictMode, 6 components × 2 mounts) — now fires once. `invalidateApiCache(path)` lets mutations punch through the cache after a write
- `apiFetch` Sentry telemetry (Wave Q) — every non-2xx HTTP response adds a typed `addBreadcrumb` (`level: 'error'` for 5xx, `'warning'` for 4xx) so any later captured event ships with the request log. 5xx responses also fire a `captureMessage` (server bugs we want to know about even when the UI doesn't crash). Network-level errors (DNS, TLS, offline, CORS — anything that throws before we get a Response) fire `captureException` unless the underlying error was an `AbortError` (StrictMode + route changes are not bugs). The URL is stripped to the bare path before forwarding so the Supabase project ref never leaks into Sentry's free-text fields
- `apiFetch` runtime schema validation (`src/lib/apiSchemas.ts`, FE-API-1, 2026-04-21) — pass an optional `schema: ZodType<T>` to `apiFetch` / `usePageData` and the parsed `data` slice is run through `schema.safeParse` before resolving (the `ApiResult` envelope itself stays unvalidated — `ok` / `error` is stable across routes). Validation failure degrades to `{ ok: false, error: { code: 'VALIDATION_ERROR', … } }` so the UI renders a fallback instead of exploding mid-render, *and* fires `Sentry.captureMessage` fingerprinted by `[apiFetch-zod, method, path, issueCode]` with the top-5 Zod issues attached as `extra` — backend contract drift lights up the dashboard within seconds instead of silently rendering `undefined.map(…)`. Schemas live in `apiSchemas.ts` grouped by route family so a new endpoint is one new entry
- Sentry self-disabling transport (`src/lib/sentry.ts`, Wave Q) — wraps the upstream `makeFetchTransport` in a `createTransport` shim that watches HTTP status codes from the ingest endpoint. After 3 consecutive 401/403 responses (a rotated/disabled DSN scenario) the transport short-circuits to a no-op for the remainder of the session, logs one warning, and stops polluting devtools / wasting battery. 429 (rate-limit) is left alone so the SDK's native rate-limit logic still runs. Types for `BrowserTransportOptions` etc. are derived from `Parameters<typeof makeFetchTransport>[0]` so the shim doesn't reach into `@sentry/core` internals that move between minor versions
- `<ConfirmDialog>` + `<PromptDialog>` (`src/components/ConfirmDialog.tsx`, Wave P) — themed replacements for `window.confirm` + `window.prompt`. Render to a fixed overlay, focus the primary input/button on mount, close on Escape, forward Enter to the primary action. `tone="danger"` on `ConfirmDialog` swaps the primary button to red. Both are uncontrolled — keep open/closed state in the parent. Used by every destructive action (delete project, revoke key, force-process queue, etc.) so admin actions never interrupt with a jarring browser-native dialog
- `IntegrationHealthDot` — sidebar health indicator that polls `/v1/admin/health/history` and degrades to yellow/red on the worst latest status per kind
- `HealthPill` is shared across `Dashboard`, `Judge`, `Queue`, `Fixes`, `Prompt Lab`, **and now both core platform integrations + routing destinations on `/integrations`**
- `FixesPage` polling pauses while the tab is hidden and guards against overlapping in-flight requests
- `usePageData` is the standard data-load hook for `Dashboard`, `Reports`, `ReportDetail`, `Queue`, `DLQ`, `Audit`, `AntiGaming`, `Health`, `Sso`, `Settings`, `Marketplace`, `Integrations`, and `Billing`. `useToast` is the standard mutation-feedback channel for the same set
- Motion utilities in `src/index.css` (`animate-mushi-fade-in` 160ms, `animate-mushi-modal-in` 220ms scale-in, `animate-mushi-toast-in` 180ms slide-from-right, `animate-mushi-toast-out` 140ms slide-back, **`animate-mushi-toast-progress`** 100→0% drain, **`animate-mushi-success-pulse`** 650ms ring glow, **`animate-mushi-confetti-fall`** for the first-fix burst) — all gated by `motion-safe:` so users with `prefers-reduced-motion` see no animation. Toasts (`useToast`) animate in / out via a `closing` flag + `setTimeout` on dismiss. Modal scrims fade-in and inner panels scale-in. Reports rows stagger-fade in 18ms apart (capped at 12 rows). `<PlatformIntegrationCard>` pulses on a fresh successful probe (initial-mount guarded so cold loads don't false-pulse). (Wave K + L)
- `SettingsPage` tablist uses an absolutely-positioned underline that translates between active tabs in 200ms via `useLayoutEffect` measurement, instead of jumping per-button border styles — full a11y preserved (`role="tab"`, `aria-selected`, `aria-controls`, focus-visible ring)
- Pre-setup dashboard gate: when any `setup.checklist` item is incomplete, `DashboardPage` renders only `SetupChecklist + HeroIntro` with a "Show full dashboard" reveal, so brand-new admins aren't drowned by 9 KPI tiles before they've even sent a test report (Wave K)
- **Layout-shaped skeletons** (`src/components/skeletons/`): `DashboardSkeleton`, `TableSkeleton`, `DetailSkeleton`, `PanelSkeleton`, **`GraphSkeleton`**, **`HealthSkeleton`**, **`OnboardingSkeleton`**, **`QuerySkeleton`**, **`ResearchSkeleton`** (Wave L) — every page now first-paints into the shape it'll fill, not into a centered spinner
- **Hero illustrations** (`src/components/illustrations/HeroIllustrations.tsx`, Wave L) — lightweight 64×64 SVG glyphs (`HeroBugFunnel`, `HeroFixWrench`, `HeroSearch`, `HeroPlugIntegration`) pinned to `currentColor` so they inherit theme. Used by `EmptyState` on Projects, Audit, Notifications, and Onboarding to give beginner-mode pages a visual anchor instead of a blank "no data yet" wall

### New admin endpoints (server)

These were added to support the page rebuilds and live in `packages/server/supabase/functions/api/index.ts`:

- `GET  /v1/admin/dashboard` — single-call payload for the dashboard. Returns a `pdcaStages: PdcaStage[]` block (Plan / Do / Check / Act counts, tones, bottleneck strings, deep-link CTAs) plus `focusStage` indicating which stage carries the highest backlog. **Wave L:** each stage row now also carries a `series: number[]` 7-day momentum array (oldest → newest) for the `PdcaCockpit` sparkline. Powers `PdcaCockpit`
- `GET  /v1/admin/reports` — every row is enriched with `dedup_count` (number of reports in the same `report_group_id`) **and `unique_users` (real `COUNT(DISTINCT reporter_token_hash)` blast radius)** sourced from the `report_group_blast_radius` Postgres RPC — see `packages/server/supabase/migrations/20260420000000_blast_radius_indexes.sql` for the partial covering indexes
- `GET  /v1/admin/reports/severity-stats` — 14-day severity rollup. **Wave L:** also returns `byDay: Array<{ day, critical, high, medium, low, total }>` so the `ReportsKpiStrip` can render per-tile trend sparklines instead of static totals
- `GET  /v1/admin/reports/:id` — hydrates the report with related `llm_invocations` (Plan + Check), `fix_attempts` (Do), and `classification_evaluations` (Check) in parallel so the **`PdcaReceiptStrip`** renders without N+1
- `GET  /v1/admin/projects` — each project row carries `pdca_bottleneck` + `pdca_bottleneck_label`, computed from `reports` (Plan), `fix_attempts` (Do), and `classification_evaluations` (Check). Powers the `PdcaBottleneckPill`
- `GET  /v1/admin/health/llm` — augmented with `p95LatencyMs`, `costUsd`, and `lastFailureAt` per function. **Wave J:** cost now reads the real `llm_invocations.cost_usd` column (added in `20260420000200_llm_cost_usd.sql`); the on-the-fly `estimateCallCostUsd` helper from `_shared/pricing.ts` only runs as a fallback for pre-backfill rows. FE renders are defensive (`?? 0`) so a stale Edge Function deployment can't crash the page
- `GET  /v1/admin/judge/evaluations | /distribution | /prompts`, `POST /v1/admin/judge/run` — `evaluations` rows are hydrated with `report_summary`, `report_severity`, and `report_status` from the `reports` table so the Judge UI can show "Submit button on /checkout has wrong size" instead of `f9b3c2…`
- `POST /v1/admin/query`, `GET /v1/admin/query/history` (supports `?saved=1`), `DELETE /v1/admin/query/history/:id`, **`PATCH /v1/admin/query/history/:id`** (toggles the new `is_saved` column, partial-indexed via `20260420000100_nl_query_saved.sql`). **Wave L:** the `GET /history` endpoint is migration-drift resilient — if the `is_saved` column is missing during a partial deploy (`pg_code='42703'`), it returns `{ ok: true, history: [], degraded: 'schema_pending' }` instead of a 500, so the page keeps rendering and the FE shows a yellow degradation banner
- `GET  /v1/admin/fixes/:id/timeline`, `GET /v1/admin/fixes/summary`
- `GET  /v1/admin/queue` (paginated), `GET /v1/admin/queue/summary`, `GET /v1/admin/queue/throughput`, `POST /v1/admin/queue/:id/retry`, `POST /v1/admin/queue/flush-queued`
- `GET  /v1/admin/prompt-lab` (each `PromptVersion` carries `cost_usd_total` + `avg_cost_usd` rolled up server-side from `llm_invocations.cost_usd` filtered by project + `prompt_version`, **Wave J**), `POST | PATCH | DELETE /v1/admin/prompt-lab/prompts[/:id]`
- `POST /v1/admin/intelligence` (async, enqueues a job), `GET /v1/admin/intelligence/jobs`, `POST /v1/admin/intelligence/jobs/:id/cancel`
- `GET  /v1/admin/health/history`
- `GET  /v1/admin/billing` (per-project plan + usage + quota; **Wave J:** also returns `llm_cost_usd_this_month` per project, summed from `llm_invocations.cost_usd` and indexed via `idx_llm_inv_project_cost`), `GET /v1/admin/billing/invoices`, `POST /v1/admin/billing/checkout`, `POST /v1/admin/billing/portal`
- `GET  /v1/admin/audit` — supports `?actor_type=human|agent|system` so the Audit log can split human admin actions from agent / cron noise
- `GET  /v1/admin/storage` — settings; **`GET /v1/admin/storage/usage`** — per-project object count + last write timestamp for the storage usage table
- `GET | POST | DELETE /v1/admin/integrations` — credentials are masked in `GET`; `POST` merges with masked secrets so partial updates don't blow away tokens
- `GET | POST /v1/admin/sso`, `DELETE /v1/admin/sso/:id` — provisions / removes Supabase Auth Admin API SAML providers

## Deployment

The admin console is deployed to **S3 + CloudFront** at `kensaur.us/mushi-mushi/`.

- **CI/CD**: `.github/workflows/deploy-admin.yml` — triggers on push to `master` when `apps/admin/**` changes
- **S3 bucket**: `kensaur.us-mushi-mushi` (ap-northeast-1)
- **CloudFront Functions**: SPA router (viewer-request) and security headers (viewer-response) in `scripts/cloudfront-mushi-*`
- **Cache strategy**: immutable hashed assets (1yr), HTML/version.json (no-cache)
- **Security headers**: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Bundle splitting** (PERF-3, 2026-04-21): `vite.config.ts > build.rollupOptions.output.manualChunks` carves `node_modules` into named vendor chunks (`vendor-react`, `vendor-sentry`, `vendor-supabase`, `vendor-charts`, `vendor-maps`, `vendor-markdown`, `vendor-table`, `vendor-misc`). Every route is already `React.lazy()`'d, so the login + dashboard path only downloads `vendor-react` + `vendor-supabase` + route chunk; Recharts, Mapbox, and the markdown/highlighter stack load on demand when the user opens Health / Billing / Report detail. Keeps TTI on cold loads independent of how heavy the long-tail pages get

## License

See root [LICENSE](../../LICENSE).
