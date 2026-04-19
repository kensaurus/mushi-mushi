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

- `PageHeader`, `PageHelp` — consistent page chrome with collapsible "what / when / how" help block. `PageHelp` defaults open on first visit per page and persists user dismissal in `localStorage[mushi:pagehelp:${title}]`, so first-time discovery isn't hidden by default
- `Section` — titled section with optional leading `icon` (e.g. `IconUser`, `IconSparkle`, `IconCamera` from `icons.tsx`)
- `Card`, `Divider`, `EmptyState`, `Loading`, `Skeleton`, `ErrorAlert`, `StatCard`

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

- `Btn`, `Input`, `Textarea`, `Checkbox`, `Toggle`, `SelectField`, `FilterSelect`, `Tooltip`, `Kbd`, `Badge`

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

## First-Run Experience

The console operates in two modes — auto-detected from env vars:

### Cloud mode (default)
1. **Clean login** — branded sign-in page with no infrastructure details
2. **Onboarding wizard** — guides through: create project, generate API key, test connection, copy SDK snippet
3. **Dashboard getting started** — when the user has 0 reports, `GettingStartedEmpty` renders a PDCA-framed first-run script (Plan → Do → Check) on top of the existing setup checklist, so the next action is always one click away

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
| `/` | Dashboard — **`PdcaCockpit`** strip up top (4 stage tiles with the bottleneck stage ringed + a single-sentence callout), then stat cards and category/severity breakdowns; **`QuotaBanner`** above KPIs surfaces any project ≥50% of its monthly free-tier report quota (warn / danger tones, deep-links to `/billing`); PDCA-framed `GettingStartedEmpty` when the user has 0 reports |
| `/onboarding` | First-run setup wizard (project, API key, test, SDK snippet) |
| `/reports` | Filterable report list (status / category / severity / `component` / `reporter`); each row has a 4 px left-edge severity stripe (instant scan), a `+N similar` badge for deduped reports (driven by `report_group_id`), and a single primary action button — `Triage →` for `new` reports, `Dispatch fix →` for `classified`/`fixing` reports (gated on `DISPATCH_ELIGIBLE_STATUSES`); secondary actions (Copy link, Dismiss) move into a row kebab |
| `/reports/:id` | Report detail — recommended next action, triage bar, LLM classification, environment, console / network / performance (always rendered with empty states), zoomable screenshot, related cross-links (component, reporter, graph, fix) |
| `/queue` | Pipeline queue — paginated backlog by stage/status, throughput sparkline, retry actions, **Force-process queued** button (kicks `POST /v1/admin/queue/flush-queued` to drain stuck `status='queued'` reports), DLQ inspector |
| `/graph` | Knowledge graph — auto-switches between two views: a Sankey-style **`GraphStoryboard`** (left-to-right columns by `node_type` with bezier links) when fewer than 12 nodes exist, and the full React Flow canvas otherwise. Filter chips are grouped (`Show node types` / `Connect via edges`) with `all` toggles. Minimap is suppressed on small graphs to avoid clutter. Toggleable "Table" view renders nodes + edges as accessible HTML tables for screen readers; canvas has `role="region"` + descriptive `aria-label`. A "Force canvas view" override is available when the storyboard threshold trips by accident |
| `/judge` | Judge dashboard — KPI row, score-over-time trend with a colour-coded dimension legend (Overall / Accuracy / Severity / Component / Repro), score distribution histogram, prompt-version leaderboard, "Run judge now" button. Recent evaluations table renders the **report summary** (not the opaque `report_id` hash) and abbreviated columns (`Acc / Sev / Comp / Repro / Agreed`) carry hover tooltips explaining each dimension |
| `/query` | Ask Your Data — natural-language → SQL with persistent history (per user), sanitised LLM output (trailing `;` and inline comments stripped), explanation, generated SQL, and result table |
| `/fixes` | Auto-fix PDCA — KPI summary (last 30d), daily volume sparkline, per-fix branch graph (`FixGitGraph`) overlaying dispatch → branch → commit → PR → CI → merge, retry button |
| `/projects` | Project management + API keys, with toast feedback for create / generate / revoke |
| `/integrations` | Sentry, Langfuse, GitHub App + routing destinations (Jira, Linear, GitHub Issues, PagerDuty) — `HealthPill` per integration, full CRUD editor for routing credentials with masked-secret pass-through, sidebar health dot |
| `/sso` | SAML / OIDC self-service — provider name, metadata URL, entity ID, email domains. SAML registers via Supabase Auth Admin API and surfaces ACS URL + Entity ID for the IdP; OIDC currently writes config and shows a "register in dashboard" hint pending GoTrue admin support. Disconnect drops the row + the registered provider |
| `/audit` | Audit log with CSV export |
| `/prompt-lab` | Prompt Lab (replaces `/fine-tuning`) — leaderboard of prompt versions, A/B traffic split, dataset preview, clone / activate / delete. `/fine-tuning` redirects here |
| `/health` | LLM and cron job health — fallback rate, latency, last-run status (live via Realtime) |
| `/anti-gaming` | Reporter-token abuse detection — flagged devices and event log. Identical events (same `event_type` + `reason` + `reporter_token_hash` + `ip_address`) are aggregated client-side into a single row with a count + expand-to-see-each-occurrence; a "Group identical" toggle disables the aggregation when forensics need every row |
| `/notifications` | Reporter-facing notifications — classified, fixed, reward events |
| `/intelligence` | Bug Intelligence — async generation queue with progress card (cancellable), recent reports |
| `/storage` | Per-project storage overrides (S3 / R2 / GCS / MinIO / Supabase) with health check + toast feedback |
| `/billing` | Per-project Stripe billing — plan badge, monthly usage bars, Upgrade / Manage Subscription, recent invoices list |
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

- **`PdcaCockpit`** — top-of-page strip rendering 4 stage tiles (Plan / Do / Check / Act). Each tile shows one big living number, a stage tone (`ok` / `warn` / `urgent`), a one-line bottleneck caption, and a deep-link CTA. The `focusStage` from the API gets a coloured ring; `urgent` stages also surface a full-width "Resolve →" callout below the strip. Backed by the `pdcaStages` + `focusStage` block on `GET /v1/admin/dashboard`
- **`GettingStartedEmpty`** — reused inside the dashboard when the user has 0 reports. PDCA-framed first-run script (Plan: install SDK → Do: dispatch a fix → Check: watch it land) wrapping the existing `SetupChecklist` primitive
- **`KpiRow`**, **`ChartsRow`**, **`TriageAndFixRow`**, **`InsightsRow`**, **`QuickFiltersCard`**, **`QuotaBanner`** — pre-existing rows preserved beneath the cockpit

Shared shapes for these components live in `src/components/dashboard/types.ts` (`PdcaStageId`, `PdcaStage`, `DashboardData`, etc.).

### Knowledge graph composition

`GraphPage` is composed from `src/components/graph/`:

- **`GraphCanvas`** — React Flow wrapper for dense graphs. Accepts a `showMinimap` prop (defaults `true`) so callers can suppress the minimap on sparse graphs
- **`GraphStoryboard`** — Sankey-shaped fallback for sparse graphs (<12 nodes by default). Buckets nodes by `node_type` into vertical columns and draws SVG bezier links between connected nodes. Fires the same `onSelect` callback the canvas uses, so the side-panel and blast-radius logic Just Work
- **`GraphFilters`** — quick-views, search, and grouped node-type / edge-type chip rows
- **`GraphSidePanel`**, **`GraphLegend`**, **`GraphTableView`**, **`NodeChip`** — pre-existing supporting components

Async UX & reliability:

- `useToast` (`src/lib/toast.tsx`) — global toast provider with `success / error / warn / info` tones; accepts `message` as an alias for `title` for ergonomic call sites
- `usePageData` (`src/lib/usePageData.ts`) — StrictMode-safe GET hook (per-mount abort flag, stable `reload` callback, optional `deps`)
- `IntegrationHealthDot` — sidebar health indicator that polls `/v1/admin/health/history` and degrades to yellow/red on the worst latest status per kind
- `HealthPill` is shared across `Dashboard`, `Judge`, `Queue`, `Fixes`, `Prompt Lab`, **and now both core platform integrations + routing destinations on `/integrations`**
- `FixesPage` polling pauses while the tab is hidden and guards against overlapping in-flight requests
- `usePageData` is the standard data-load hook for `Dashboard`, `Reports`, `ReportDetail`, `Queue`, `DLQ`, `Audit`, `AntiGaming`, `Health`, `Sso`, `Settings`, `Marketplace`, `Integrations`, and `Billing`. `useToast` is the standard mutation-feedback channel for the same set

### New admin endpoints (server)

These were added to support the page rebuilds and live in `packages/server/supabase/functions/api/index.ts`:

- `GET  /v1/admin/dashboard` — single-call payload for the dashboard. Now also returns a `pdcaStages: PdcaStage[]` block (Plan / Do / Check / Act counts, tones, bottleneck strings, deep-link CTAs) plus `focusStage` indicating which stage carries the highest backlog. Powers `PdcaCockpit`
- `GET  /v1/admin/reports` — every row is enriched with `dedup_count` (number of reports in the same `report_group_id`) so the Reports table can render the `+N similar` badge without an N+1 fetch from the client
- `GET  /v1/admin/judge/evaluations | /distribution | /prompts`, `POST /v1/admin/judge/run` — `evaluations` rows are hydrated with `report_summary`, `report_severity`, and `report_status` from the `reports` table so the Judge UI can show "Submit button on /checkout has wrong size" instead of `f9b3c2…`
- `POST /v1/admin/query`, `GET /v1/admin/query/history`, `DELETE /v1/admin/query/history/:id`
- `GET  /v1/admin/fixes/:id/timeline`, `GET /v1/admin/fixes/summary`
- `GET  /v1/admin/queue` (paginated), `GET /v1/admin/queue/summary`, `GET /v1/admin/queue/throughput`, `POST /v1/admin/queue/:id/retry`, `POST /v1/admin/queue/flush-queued`
- `GET  /v1/admin/prompt-lab`, `POST | PATCH | DELETE /v1/admin/prompt-lab/prompts[/:id]`
- `POST /v1/admin/intelligence` (async, enqueues a job), `GET /v1/admin/intelligence/jobs`, `POST /v1/admin/intelligence/jobs/:id/cancel`
- `GET  /v1/admin/health/history`
- `GET  /v1/admin/billing` (per-project plan + usage + quota), `GET /v1/admin/billing/invoices`, `POST /v1/admin/billing/checkout`, `POST /v1/admin/billing/portal`
- `GET | POST | DELETE /v1/admin/integrations` — credentials are masked in `GET`; `POST` merges with masked secrets so partial updates don't blow away tokens
- `GET | POST /v1/admin/sso`, `DELETE /v1/admin/sso/:id` — provisions / removes Supabase Auth Admin API SAML providers

## Deployment

The admin console is deployed to **S3 + CloudFront** at `kensaur.us/mushi-mushi/`.

- **CI/CD**: `.github/workflows/deploy-admin.yml` — triggers on push to `master` when `apps/admin/**` changes
- **S3 bucket**: `kensaur.us-mushi-mushi` (ap-northeast-1)
- **CloudFront Functions**: SPA router (viewer-request) and security headers (viewer-response) in `scripts/cloudfront-mushi-*`
- **Cache strategy**: immutable hashed assets (1yr), HTML/version.json (no-cache)
- **Security headers**: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy

## License

See root [LICENSE](../../LICENSE).
