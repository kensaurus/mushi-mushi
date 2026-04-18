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

- `PageHeader`, `PageHelp` — consistent page chrome with collapsible "what / when / how" help block
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

## First-Run Experience

The console operates in two modes — auto-detected from env vars:

### Cloud mode (default)
1. **Clean login** — branded sign-in page with no infrastructure details
2. **Onboarding wizard** — guides through: create project, generate API key, test connection, copy SDK snippet
3. **Dashboard getting started** — empty dashboard shows checklist, action cards, and connection health

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
| `/` | Dashboard — stat cards, category/severity breakdowns; **`QuotaBanner`** above KPIs surfaces any project ≥50% of its monthly free-tier report quota (warn / danger tones, deep-links to `/billing`); getting started cards when empty |
| `/onboarding` | First-run setup wizard (project, API key, test, SDK snippet) |
| `/reports` | Filterable report list (status / category / severity / `component` / `reporter`); status-aware "what to do next" card above the filters |
| `/reports/:id` | Report detail — recommended next action, triage bar, LLM classification, environment, console / network / performance (always rendered with empty states), zoomable screenshot, related cross-links (component, reporter, graph, fix) |
| `/queue` | Pipeline queue — paginated backlog by stage/status, throughput sparkline, retry actions, **Force-process queued** button (kicks `POST /v1/admin/queue/flush-queued` to drain stuck `status='queued'` reports), DLQ inspector |
| `/graph` | Knowledge graph — interactive React Flow canvas (component / page / reporter / category clusters, search, blast-radius highlight, side-panel detail). Toggleable "Table" view renders nodes + edges as accessible HTML tables for screen readers; React Flow canvas has `role="region"` + descriptive `aria-label` |
| `/judge` | Judge dashboard — KPI row, score-over-time trend, score distribution histogram, prompt-version leaderboard, "Run judge now" button |
| `/query` | Ask Your Data — natural-language → SQL with persistent history (per user), sanitised LLM output (trailing `;` and inline comments stripped), explanation, generated SQL, and result table |
| `/fixes` | Auto-fix PDCA — KPI summary (last 30d), daily volume sparkline, per-fix branch graph (`FixGitGraph`) overlaying dispatch → branch → commit → PR → CI → merge, retry button |
| `/projects` | Project management + API keys, with toast feedback for create / generate / revoke |
| `/integrations` | Sentry, Langfuse, GitHub App + routing destinations (Jira, Linear, GitHub Issues, PagerDuty) — `HealthPill` per integration, full CRUD editor for routing credentials with masked-secret pass-through, sidebar health dot |
| `/sso` | SAML / OIDC self-service — provider name, metadata URL, entity ID, email domains. SAML registers via Supabase Auth Admin API and surfaces ACS URL + Entity ID for the IdP; OIDC currently writes config and shows a "register in dashboard" hint pending GoTrue admin support. Disconnect drops the row + the registered provider |
| `/audit` | Audit log with CSV export |
| `/prompt-lab` | Prompt Lab (replaces `/fine-tuning`) — leaderboard of prompt versions, A/B traffic split, dataset preview, clone / activate / delete. `/fine-tuning` redirects here |
| `/health` | LLM and cron job health — fallback rate, latency, last-run status (live via Realtime) |
| `/anti-gaming` | Reporter-token abuse detection — flagged devices and event log |
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

Async UX & reliability:

- `useToast` (`src/lib/toast.tsx`) — global toast provider with `success / error / warn / info` tones; accepts `message` as an alias for `title` for ergonomic call sites
- `usePageData` (`src/lib/usePageData.ts`) — StrictMode-safe GET hook (per-mount abort flag, stable `reload` callback, optional `deps`)
- `IntegrationHealthDot` — sidebar health indicator that polls `/v1/admin/health/history` and degrades to yellow/red on the worst latest status per kind
- `HealthPill` is shared across `Dashboard`, `Judge`, `Queue`, `Fixes`, `Prompt Lab`, **and now both core platform integrations + routing destinations on `/integrations`**
- `FixesPage` polling pauses while the tab is hidden and guards against overlapping in-flight requests
- `usePageData` is the standard data-load hook for `Dashboard`, `Reports`, `ReportDetail`, `Queue`, `DLQ`, `Audit`, `AntiGaming`, `Health`, `Sso`, `Settings`, `Marketplace`, `Integrations`, and `Billing`. `useToast` is the standard mutation-feedback channel for the same set

### New admin endpoints (server)

These were added to support the page rebuilds and live in `packages/server/supabase/functions/api/index.ts`:

- `GET  /v1/admin/dashboard` — single-call payload for the dashboard
- `GET  /v1/admin/judge/evaluations | /distribution | /prompts`, `POST /v1/admin/judge/run`
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
