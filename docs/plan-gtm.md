<!-- Copied from ~/.claude/plans/mushi-mushi-lacks-users-shiny-lampson.md on 2026-09-20 (approved). Phase 1 status: see docs/marketing/scorecard.md. Keep numbers there; keep decisions here. -->

# GTM Plan — Mushi Mushi (research → plan-gtm → workflow-gtm)

_Plan-only. Nothing changes until each phase is approved. Approving a phase hands it to `workflow-gtm`, which runs the named execution skills in order and re-reads the funnel table before and after._

## Context

Mushi Mushi is a shipped, open-source bug-report → plain-English diagnosis → fix-loop SDK with a hosted console, 30 published npm packages, an MCP server in every major registry, and a full zero-budget marketing playbook in `docs/marketing/` written in June 2026. The founder's ask (2026-09-20): the product "lacks users and visibility"; they want to (1) analyze funnels and track users **with the Mushi SDK itself**, (2) make it widely used like Sentry or Langfuse, (3) follow a 2026 marketing approach without hallucinated numbers, and (4) enhance UI/UX where activation requires it.

**What the live data says (queried 2026-09-20, Supabase project `dxptnwrhwsqckaftyymj`, GitHub API, npm API):**

| Signal | Number | Source |
|---|---|---|
| Console signups, all time | 9 (Apr 3 · May 5 · Jun 1 · Jul–Sep 0) | `auth.users` |
| Signups with a sign-in in the last 30 d | 2 (founder + 1) | `auth.users.last_sign_in_at` |
| Auth provider used by every signup | email/password only | `raw_app_meta_data.provider` |
| Projects | 11 = 7 founder-owned (`kenji` org, Pro) + 4 external (hobby) | `projects` ⨝ `organizations` |
| External projects with ≥1 report or ≥1 session | **0 of 4** (keys minted on day 1, never seen again) | `project_api_keys.last_seen_at`, `reports`, `end_user_sessions` |
| Reports, all time | 16, all Sept 13–20, all on founder apps, all `source=widget` | `reports` |
| End-user sessions | 26,405 all time · 740 in last 7 d · all founder apps (tsumagoi 20.5k, solo-boss 3.4k, wanting-mind 1.3k, glot.it 1k) | `end_user_sessions` |
| Company setup-funnel events | 23 rows, silent since 2026-07-19, CLI-only | `setup_funnel_events` |
| Fix attempts / dispatches | 0 / 0 | `fix_attempts`, `fix_dispatch_jobs` |
| Paid customers / subscriptions | 0 / 0 | `billing_customers`, `billing_subscriptions` |
| Support tickets | 0 | `support_tickets` |
| Team invites sent / accepted | 3 / 2 | `invitations` |
| GitHub stars / forks | 3 / 2 (repo public since 2026-04-16) | `gh repo view` |
| GitHub views (14 d) | 100 views / 25 uniques; referrers Google 3, github.com 2 | `gh api traffic/views` |
| External issues / PRs | 0 issues · 1 PR (KartavyaDikshit) | `gh issue list`, `gh pr list` |
| npm downloads last month | core 1,064 · web 912 · mcp 718 · react-native 675 · cli 317 · mushi-mushi 295 · plugin-sentry 223 · react 220 · node 194 (likely CI-inflated; unverified) | `api.npmjs.org` |
| MCP OAuth clients registered | 18 rows / 10 names, mostly founder probes; 1 plausibly external ("KodikChat Agent") | `mcp_oauth_clients` |
| Public launch (Show HN / Product Hunt / Reddit) | none found | web search |

**Diagnosis in one line:** distribution surfaces were built (registries, plugins, README, docs, llms.txt, pricing, billing, onboarding checklist) but the launch never ran, the funnel is not instrumented, and the one measurable activation cell is 0/4. The failure modes from the benchmark list that apply: *activation untracked*, *no distribution hypothesis executed*, *launching zero times instead of per release*, and a north-star (stars + downloads in `docs/marketing/measurement.md`) that does not lead retention.

## Decision log (founder's words, 2026-09-20)

- **Goal metric (90 d):** "Activated external projects/week" — a stranger's app sends its first real report and the owner sees the diagnosis.
- **ICP:** "Solo builders shipping AI-written apps" — Cursor / Claude Code / Lovable users with real end users, no Sentry, debugging via DMs and console.log.
- **Funnel scope:** "Both in the same phase" — dogfood Mushi's own funnel with the Mushi SDK **and** ship a customer-facing Users & Funnels feature for every project.
- **Budget:** "20+ h/week or budget for help."
- **Monetization (inherited from repo, not re-asked):** free-first this quarter — `docs/marketing/README.md` "Don't chase paid-Cloud conversion yet"; pricing page and Stripe stay live, get a CTA, no price changes.
- **License (inherited, never a growth tactic):** SDKs MIT, server AGPLv3, EE commercial (`COMMERCIAL-LICENSE.md`, ADR in `content/blog/agplv3-relicense.mdx`). No change.
- **Language (assumption, flag to founder):** EN-first; JP is a second, optional track (founder is JP-based, widget already ships `ja`, docs are EN-only).
- **Support inbox:** kensaurus@gmail.com (ADR 0015); never propose `support@kensaur.us`.

## Inventory verdict

| Area | Status | Worst gap | Evidence |
|---|---|---|---|
| Monetization | Built: open-core + freemium hosted (Free Cloud 50 diagnoses, no card) + usage overage, Stripe live | No trial; `ee/` is LICENSE+README only; dead `hobby`/`starter` plan IDs still in `plans.ts` union + DB | `_shared/stripe.ts:191`, `_shared/plans.ts:16`, `pricing_plans` table, `apps/admin/src/components/billing/UpgradePrompt.tsx:171` |
| License | Tri-modal, CI-enforced (`check:license`, `check:spdx-headers`) | Three licenses can confuse a buyer; fine for adoption | `LICENSE:1`, `packages/server/LICENSE`, `COMMERCIAL-LICENSE.md:1` |
| Positioning | Sharp, ICP-named, category coined, tagline CI-enforced | Landing primary CTA is a docs link, not a start; secondary CTA sends teams to a GitHub folder | `packages/brand/src/index.js:87-92`, `apps/docs/lib/landing-copy.ts:106,318-326`, `apps/docs/app/layout.tsx:26-30` |
| ICP signals | 11 frameworks, 30 npm packages, widget i18n en/ja/es/th | Console/docs EN-only, USD-only; ja/es/th widget locales have no funnel behind them | `packages/web/src/i18n/*` |
| Activation path | 0-step no-signup demo exists at `/connect`; real path = signup → project → key → install → first report | Demo buried; new users land on `/dashboard` not `/onboarding`; no SDK snippet on empty Overview; **no "how did you hear about us"**; GitHub/Google OAuth wired but every signup used email | `apps/docs/app/connect/page.tsx:108,316`, `apps/admin/src/App.tsx:307-312`, `OnboardingPage.tsx:554-557`, `OverviewPage.tsx:216` |
| Analytics | **No product analytics anywhere**; `setup_funnel_events` is CLI-only; activation is derived state (`activation-status.ts:37-46`), not events; console dogfoods the SDK so console users already land in `end_user_sessions` under the self project | Visit → Signup → Activated → Habit → Paid is unmeasurable today; no consent banner on own sites | `20260622013932_setup_funnel_events.sql:44-54`, `apps/admin/src/lib/mushi-self.ts:100-155` |
| SEO / AEO | Best-in-class: robots, 2 sitemaps, `llms.txt` + `llms-full.txt` + `llm-md/**` mirror with parity test, JSON-LD Organization/WebSite/SoftwareApplication/FAQPage, canonicals | No `/compare/*`; only one "alternative" page (Sentry); blog has 2 posts; product lives on personal-portfolio subpath with a portfolio cross-sell footer on every page | `apps/docs/app/sitemap.ts`, `apps/docs/public/llms.txt`, `apps/docs/content/use-cases/sentry-alternative.mdx`, `apps/docs/app/layout.tsx` (`KensaurusPortfolioTable`) |
| Distribution | Registries done (official MCP registry, Glama, mcp.so, Smithery, cursor.directory, awesome-mcp-servers #8625 merged); posting scripts exist | **Never launched** (no HN/PH/Reddit); VS Code extension built, `private: true`, never published; awesome-remote-mcp-servers #431 stale; no newsletter/email capture; only 1 of 8 planned posts written | `docs/marketing/GTM-DISTRIBUTION.md:21-39`, `docs/marketing/content-plan.md`, `packages/vscode-extension/package.json` |
| Trust | Security docs, updown.io status page, changelog, real screenshots/GIFs | **No privacy policy, no terms** (testers app links to a dead `/terms`); no testimonials/logos; landing "proof" is a synthetic terminal | `apps/docs/content/security/*`, `apps/testers/.../TesterWelcomeEnroll.tsx:71` |
| Pricing page | 5 tiers, formulas, estimator, competitor anchor (Sentry Team + Seer) | Explainer only, no signup CTA; $15 → $49 jump with no seat-2 step | `apps/docs/content/pricing.mdx`, `apps/docs/lib/public-copy.ts` |
| Numbers | See Context table | Every funnel cell except Signup and Paid is **unmeasured** or 0 | — |

## Positioning statement (Dunford order)

Competitive alternatives → Sentry (what the code threw, Seer $40/active contributor/mo add-on, current pricing since Jan 2026), Jam/Marker.io/Userback/BugHerd (screenshots to a ticket), PostHog session replay, and "do nothing: users DM me, I read console.log".
Unique attributes → starts from the user's own report (sentence + screenshot + console/network tail), a plain-English diagnosis on the free tier and on self-host with your own key, fix context + lessons that persist into the next PR pulled into Cursor/Claude Code over MCP with no second LLM key. Table stakes, not unique: dedupe (Sentry groups issues), MIT SDKs + self-host (Sentry and PostHog too), an MCP server (Sentry and Jam ship one).
Value → the afternoon you lose debugging code you did not write becomes a 10-second read and a paste-ready fix.
Who cares most → solo builders shipping AI-written apps to real users.
Category → the bug mediator for AI-built apps (ADR 0004; keep).

> **For solo builders shipping AI-written apps to real users, Mushi Mushi is the bug mediator that turns what a user felt into a plain-English diagnosis and a paste-ready fix in their editor, unlike Sentry, which starts from what the code threw and sells its AI debugging agent, Seer, as a paid add-on that self-hosted Sentry does not get.**

The hero (`MUSHI_TAGLINE_V2.hero`), README first line, and meta description already carry the first half of this (who it is for and what it does). The Sentry contrast is worded in one place, the canonical answer in `docs/marketing/VOICE.md`, revised 2026-09-21 so it no longer implies Sentry only sees thrown errors. The gap is the CTA and the proof under it, not the sentence.

## Monetization verdict

**Keep** (free-first, freemium ungated demo + Free Cloud, usage overage). Judged against the benchmark row *Freemium, ungated (try before account)*: good 7–9%, great 8–12% free→paid within 6 months, "adoption is the goal; value visible in one session." Activation inside the free window explains most of the variance, and activation is currently 0/4, so touching price now would be the "underpricing / reverse trial as a fix" failure mode. Phase 5 (`plan-pricing`) is parked until ≥ 10 activated external projects exist to price against. Two hygiene items ride along in Phase 1: remove dead `hobby`/`starter` plan IDs, add a signup CTA to `/pricing`.

## Activation & north-star

- **North-star:** activated external projects per week (org ≠ founder's `kenji` org).
- **Setup:** `project_created` → `key_minted` → `sdk_first_heartbeat` (already emitted at `_shared/auth.ts:252`).
- **`activated` (aha):** first `report_received` on the project **and** the owner opens it (`report_opened`) within 7 days of signup. Not signup (9 people did that and 0 came back), not payment (kills it as a leading indicator). Target: top-quartile time-to-value < 5 min via the one-click test report; hard ceiling 24 h.
- **Habit:** ≥ 1 of {`report_opened`, `fix_context_pulled` (MCP `get_fix_context`), `fix_dispatched`} per week for 3 consecutive weeks.
- **Validity check (Lenny × Timen):** once ≥ 30 external projects exist, confirm activated projects show ≥ 2× 30-day retention vs non-activated; if not, move `activated` to `fix_context_pulled`.

| Visit | Signup | Activated | Habit | Paid | Refer |
|---|---|---|---|---|---|
| **unmeasured** (site has no analytics; GitHub 25 uniques/14 d is the only proxy) | 9 all-time · 0/month since Jul | **0 of 4 external** (derived from `reports`) | unmeasured (only founder apps have sessions) | 0 | unmeasured (3 invites, 2 accepted, all founder org) |

Phase 1 turns every "unmeasured" cell into a number before any copy or UX changes ship (workflow-gtm "measured first" gate).

## Research findings (sources verified 2026-09-20; see Sources)

**How Sentry actually grew.** Open source ran inside thousands of companies for years before a hosted tier existed; the hosted product converted the *next* generation of startups, not the existing self-hosters ("the long-tail funnel of what would happen over 10 years"); they picked the ignored problem (JavaScript in the browser) and owned it; community-written SDKs spread it to ecosystems the team never touched; the CEO's line is "packaging, not pricing." Lesson for Mushi: the free/self-host path is the adoption engine, the ICP is the next generation (solo AI-first builders), and the ignored problem is "bugs users felt in code the founder did not write."

**How Langfuse actually grew (2023 → ClickHouse, Jan 2026).** Launched Aug 2023 simultaneously on Show HN + Launch YC + Product Hunt (Product of the Day); 1k stars in 2 months; then a *Launch Week* per major version (Apr 2024, Nov 2024, May 2025), each re-launched on PH; GitHub Discussions as the community home (1,400+ threads); SDK installs 2M/mo (Sep 2024) → 26M/mo (end 2025); Jun 2025 open-sourced all product features under MIT keeping only enterprise security paid; Sep 2025 halved the entry price and made enterprise self-serve; May 2026 they built an agent skill + docs search endpoint so Claude Code instruments Langfuse correctly. Lesson: launch is a cadence keyed to releases, community lives in GitHub Discussions, and agents are now a distribution channel that needs a skill + searchable docs.

**How PostHog got its first 1,000 users.** First 10 by hand from the founders' network; Show HN gave a trickle, not a spike; honest founder-journey posts ("how we pivoted 6 times", "how we raised") kept landing on HN; "no card required" at signup was the single biggest conversion lever; ~70% of early growth was recommendations, 30% content; "depth-first: if a post works, write the next one."

**2026 discovery mechanics.** Developers ask communities (Reddit, HN, Discord) and AI answers (ChatGPT, Perplexity, AI Overviews) that summarize what communities already say; there is no paid shortcut; contribution-not-promotion on Reddit; awesome-lists and MCP registries are what LLMs read when answering "best open-source X"; README is the landing page; stars are vanity, measure installs that complete and weekly active; "a launch gives a spike, the system gives a slope." Benchmarks: Show HN front page 5–30k visits / 50–400 signups, only ~11% of Show HN posts clear 10 points; Product Hunt featured rate ~10%, 1–2% B2B visit→signup, credibility artifact; comparison pages took 78% of clicks from 28% of pages in one test; llms.txt has zero Google effect but coding assistants read it; third-party mentions earn ~6.5× more AI citations than owned pages.

**Competitive reality check (2026, re-checked against vendor pages 2026-09-21).** Sentry Developer plan is free (5k errors, 1 user) and Seer (AI debugging agent) is a $40/active contributor/month add-on to Team, Business or Enterprise, not in self-hosted (legacy $20 + credits pricing ended Jan 2026); Bugsnag and Rollbar have free tiers (Rollbar is cloud-only and its Resolve beta opens fix PRs on paid AI credits; Bugsnag on-premise is Enterprise-only and its pricing lists no AI); Highlight.io was bought by LaunchDarkly and its hosted service shut down 2026-02-28 (OSS hobby self-host remains); PostHog bundles session replay + errors, with "Fix with AI" prompts and beta draft PRs (3 free/mo, then $15). Mushi's defensible angle is not "cheaper Sentry"; it is *user-felt bugs + editor-native fix loop + no second LLM key*, which no comparison page currently states against Seer.

### Gap analysis (research vs repo)

| | Finding |
|---|---|
| **Keep** | Tagline SSOT + CI check; MCP-first install; registries; llms.txt/AEO stack; Free Cloud no-card; no-signup demo; onboarding checklist; dogfood on glot.it/tsumagoi; AGPL/MIT split; `setup_funnel_events` pattern; `end_user_sessions` + `project_activity_summary` RPC as the base of Users & Funnels. |
| **Missing** | A `track()` event API and funnel/paths/people views (customer-facing) and a company funnel by `signup_source`; a signup attribution field; post-signup redirect into onboarding; one-click test report (TTV < 5 min); GitHub OAuth as the first button; lifecycle email (day-2 nudge); privacy + terms; `/compare/*` pages; founder-journey posts; a launch cadence; a community home decision; one growth loop with K-factor events; weekly scorecard. |
| **Replace** | North-star in `docs/marketing/measurement.md` (stars + downloads) → activated external projects/week; landing primary CTA (docs link) → "Try the demo · no signup" + "Start free"; Show HN URL → the demo, never the repo; `FirstRunTour` timer/6-stop → click-triggered ≤ 4 stops. |
| **Reject** | Adding PostHog/Plausible/GA4 (founder wants dogfooding; a vendor would fork the taxonomy); ClickHouse (scale ceiling is years away; Postgres RPCs suffice); license change; paid ads; upvote solicitation; AI-generated comparison pages at scale (Google spam policy, HN removes AI-written posts); reverse trial or credit gimmicks. |

## Channel plan (≤ 2 primary + 1 loop)

| Channel | Why this ICP | 2026 caveat | First action |
|---|---|---|---|
| **1. Launch cadence: Show HN (+ Product Hunt as credibility) per release** | Solo AI-first builders read HN; the runbook and snippets already exist; the no-signup demo satisfies the "runnable thing, no signup wall" rule | Only ~11% clear 10 points; must be human-written, sober, answered for 2 h; URL = demo not repo; one shot per release | Run the pre-launch gate (Workstream C §2), then the Tue/Wed pair from `docs/marketing/launch-week.md` for the next release |
| **2. Comparison + founder-journey content feeding AI answers** | The ICP searches "Lovable app broke in production" and "Sentry alternative for solo founders"; AI engines cite what third parties and honest comparison pages say | ≤ 5 pages, unique, dated, reviewed; no scaled AI content; earn third-party mentions (awesome-lists, newsletters, Reddit contribution) | Write the 5 `/compare/*` pages + first journey post (Workstream C §3–4) |
| **Loop: "Powered by Mushi" mark on the feedback widget (opt-out) + shareable diagnosis permalink** | Every end user of every installed widget sees it (near-100% exposure, 0.5–3% conversion benchmark); a shareable diagnosis is the artifact founders post | Opt-out must be one toggle; no dark patterns; K-factor events must exist first (Workstream A taxonomy) | Ship the mark + `loop_impression/loop_click/loop_signup` events (Workstream C §6) |

Not primary this quarter: registries (done, maintenance only), Discord (no activity signal; community home = GitHub Discussions per Langfuse pattern, Workstream C §7), JP channels (optional track with a trigger), paid anything, VS Code marketplace (publish once, low effort, but not a channel).

**Distribution hypothesis:** *A solo builder who sees a real diagnosis of a real user-felt bug inside their editor within five minutes of `npx mushi-mushi` will install it on their next app and tell the next builder; the way to reach the first hundred of them is a per-release Show HN + honest comparison pages that AI answer engines pick up.*

---

## Workstream A — Measure with our own SDK: `track()`, Users & Funnels, company funnel

### Decisions

| Question | Decision | Why |
|---|---|---|
| Extend `end_user_activity` or new table? | **New `product_events` table + `POST /v1/sdk/events`**; `recordActivity()` untouched | `/v1/sdk/activity` (`routes/rewards.ts:162-218`) drops everything unless rewards are enabled, the end user opted in, and the key has `activity:write`, then runs the points engine. Analytics must work on a default project key. |
| Ingest route | New `functions/api/routes/events.ts` mirroring `routes/sessions.ts:44` (auth + Zod), batch insert | sessions is one-event-per-request upsert |
| Company funnel source | **Derived-first** from `auth.users`, `projects`, `project_api_keys`, `setup_funnel_events`, `reports`, `billing_subscriptions`; `product_events` fills Visit, Fix pulled, Habit, intent clicks | measurable in week 1 without waiting on client instrumentation |
| `signup_source` storage | `auth.users.raw_user_meta_data` via `supabase.auth.signUp({ options: { data } })` (`apps/admin/src/lib/auth.tsx:188`) | no migration; readable by the existing personal-org trigger and a security-definer RPC |
| Taxonomy SSOT | `packages/core/src/analytics-taxonomy.ts` + generated Deno mirror `_shared/analytics-taxonomy.generated.ts` (precedent `_shared/console-routes.generated.ts`) | edge functions cannot import workspace packages |
| `group()` | skip in v1; `identify(userId, { org_id })` traits become person properties | ICP is solo builders |
| Storage engine | Postgres only; revisit at ~1M events/day (partition + rollup, then ClickHouse) | current volume is 26k sessions total |

### Activation events (Setup → Aha → Habit)

| Phase | Event | Derivation / emitter |
|---|---|---|
| Setup | `signup_completed` | `auth.users.created_at` + `raw_user_meta_data.signup_source` |
| Setup | `project_created` | `projects.created_at`; server emit at `routes/projects-crud.ts:814` |
| Setup | `key_minted` | `project_api_keys.created_at`; server emit at `routes/project-keys.ts:188` |
| Setup | `sdk_installed` | `setup_funnel_events.sdk_first_heartbeat` (`_shared/auth.ts:252`) |
| **Aha = `activated`** | `first_report_received` on a non-founder project, SDK-originated | `min(reports.created_at)` per project; server emit at report ingest, dedup on `project_id` |
| Loop | `fix_context_pulled` | MCP `get_fix_context` handler + console "copy fix context" |
| **Habit** | `diagnosis_consumed` = `report_opened` ∪ `fix_context_pulled` ∪ MCP `get_report_detail`, ≥ 1 in 3 of trailing 4 weeks | `product_events` |
| Revenue | `upgrade_completed` | `billing_subscriptions` active and plan ≠ `free_cloud`; emit in `stripe-webhooks` |

### SDK API (add to `packages/core/src/types.ts` near `identify` ~:1411)

```ts
track(event: string, properties?: Record<string, string | number | boolean | null>): void;
setConsent(state: 'granted' | 'denied'): void;
getAnonymousId(): string | null;
// MushiConfig.analytics?: { enabled?, consent?: 'implied'|'required', sampleRate?, respectDoNotTrack?, autoPageviews?, flushIntervalMs?, propertyAllowlist? }
```

| Concern | Implementation |
|---|---|
| Transport | new `packages/core/src/event-tracker.ts` modelled on `session-tracker.ts`; batch ≤ 20 / 5 s / `pagehide` keepalive; `MushiApiClient.postEventsBatch()` beside `postSessionEvent` (`api-client.ts:481`) |
| Offline | do not reuse `queue.ts` (typed to reports, encrypted IndexedDB); spill to `localStorage['mushi_events_spill_<pid>']` cap 200 / 24 h |
| Identity | `anon_id` = existing per-project reporter token (`reporter-token.ts`); `identify()` in `packages/web/src/mushi.ts:1683` also calls `updateEventIdentity` and enqueues `$identify` (server backfills alias) |
| DNT / GPC | same check the session tracker promises (`session-tracker.ts:15`); no events, no anon id |
| Consent | `required` buffers ≤ 50, persists in `localStorage mushi_analytics_consent_<pid>` (mirrors `rewards.ts:67`); rewards consent implies analytics consent (one banner) |
| PII | `createPiiScrubber()` over every string prop (`mushi.ts:197`); drop keys matching `/email|phone|password|token|secret|ssn|address/i` unless allowlisted |
| Validation | name `^[a-z][a-z0-9_]{1,63}$`; depth 1, ≤ 40 keys, ≤ 256 chars/value, ≤ 8 KB; `$`-prefixed keys reserved (`$route`, `$referrer`, `$utm_*`, `$surface`, `$session_id`, `$sdk_version`) |
| Rate limit | client `createRateLimiter({maxBurst:50, refillRate:10})` (`rate-limiter.ts`); server batch ≤ 50 / 64 KB, 3,000 events/min/project via `routes/ingest-rate-limit.ts` |
| Key scope | any project-scoped key via `apiKeyAuth` (`_shared/auth.ts:450-456`); off-switch `project_settings.product_events_enabled` |
| Retention | 90 d default, `project_settings.events_retention_days` override (self project 730) |
| Other SDKs | `packages/react/src/hooks.ts` `useMushiTrack()`; `packages/react-native/src/provider.tsx:210` `track` beside `recordActivity`; `packages/node/src/client.ts` `track(event, { distinctId, properties })` with `$surface:'server'` |

### Server: ingest, schema, RPCs

- **Route** `routes/events.ts` → `registerEventRoutes(app)` in `api/index.ts`. Body `{ anon_id?, user_id?, session_id?, sdk_version?, events:[{name, ts?, properties?, dedup_key?}] }`. Zod → `product_events_enabled` check → `resolveEndUser` (`_shared/end-user-resolver.ts`) → server-side scrub → batch insert → `$identify` backfill `update product_events set end_user_id=$1 where project_id=$2 and anon_id=$3 and end_user_id is null` → `{accepted, dropped}`.
- **Server emitter** `_shared/product-events.ts` `emitProductEvent(db, {projectId?, userId?, anonId?, eventName, properties, surface, dedupKey?})`, fire-and-forget like `emitFunnelEvent` (`auth.ts:252-263`). Call sites: `projects-crud.ts:814`, `project-keys.ts:188`, report ingest, `mcp/index.ts` `get_fix_context`, `_shared/fix-merge.ts`, `stripe-webhooks`.
- **Migration 1 `20260921000001_product_events.sql`**: table `product_events(id bigint identity, project_id uuid fk cascade, event_name text check regex, ts, received_at, session_id, anon_id, end_user_id fk set null, surface check in (web,console,docs,cli,mcp,server,mobile), sdk_version, dedup_key, properties jsonb ≤ 8192 B, unique(project_id, dedup_key))`; indexes `(project_id, ts desc)`, `(project_id, event_name, ts desc)`, `(project_id, coalesce(end_user_id::text, anon_id), ts)`, partial `(project_id, anon_id) where end_user_id is null`, GIN `properties jsonb_path_ops`; RLS select policy identical to `end_user_sessions` (org member via `organization_members`); `end_users.traits jsonb ≤ 2 KB`; `project_settings.product_events_enabled`, `events_retention_days`; nightly pg_cron TTL batched 5k, advisory-locked (pattern `20260622013932:131-170`).
- **Migration 2 `20260921000002_product_events_rpcs.sql`** (security definer, `set search_path = public`): `product_events_summary(p_project_id, p_window_days)`, `product_funnel(p_project_id, p_steps text[], p_from, p_to, p_window interval, p_breakdown text)` (≤ 8 steps, person key `coalesce(end_user_id::text, anon_id)`, per step `{entered, converted, pct, median_secs}`), `product_paths(p_project_id, p_from_event, …)` (`lead()` over session), `product_people(p_project_id, p_filter jsonb, p_limit, p_before)`, `product_retention(p_project_id, p_weeks, p_return_event)` (first-seen-week cohorts, day-7 / week-N).
- **Migration 3 `20260921000003_company_funnel_rpc.sql`**: `company_funnel_weekly(p_weeks, p_source)` reading `auth.users` (excluding operator ids) → `week × {visits, signups, projects, keys, sdk_installed, activated, fix_pulled, habit, paid}` + `by_source`.
- **Admin routes** `routes/events-admin.ts` (`jwtAuth` + `resolveOwnedProject` as in `dashboard.ts:1087`; summary/funnel/paths also `adminOrApiKey({scope:'mcp:read'})` as in `activation.ts:27`): `GET /v1/admin/events/{summary,funnel,paths,people,retention}`. `GET /v1/admin/growth/funnel?weeks=8&source=` behind new `_shared/operator-gate.ts` `requireOperator(c)` (userId ∈ secret `MUSHI_OPERATOR_USER_IDS`). Also gate the existing `get_setup_funnel_counts_7d` leak at `onboarding-setup.ts:167` with the same check.

### Console UI (`apps/admin`)

| Item | Where |
|---|---|
| Nav | `lib/navRegistry.ts`: `nav:users` → `/users` "Users & Funnels" after `/activity` (`:467`), add to `QUICK_SUB_GROUPS['quick-loop']` (`:143`); lazy route in `App.tsx` beside `/activity` |
| Page | `pages/UsersPage.tsx` tabs `overview|funnels|paths|people|retention`; copy the `ActivityPage.tsx` skeleton (`usePageData`, `PageHeaderBar`, `StatGrid/StatCard`, `PageLoadError`, `FreshnessPill`); charts from `components/charts.tsx` (`LineSparkline`, `BarSparkline`, `Histogram`, hand-rolled SVG, no lib) + new `components/charts/FunnelBars.tsx` |
| Funnel builder | `components/FunnelBuilder.tsx`: ordered chips from `summary.top_events`, window select, breakdown property, Run; saved funnels in `localStorage` v1; preset "Signup → Activated" for the self project |
| Growth page | `pages/GrowthPage.tsx` at `/growth`, nav item only when `entitlements.operator` (extend `GET /v1/admin/entitlements`, `modernization-health-super.ts:324`); sparkline "activated external projects/week" on top |
| Signup source | `LoginPage.tsx:582` signup block: select (`cursor_directory`, `github`, `twitter`, `hn`, `search`, `friend`, `other`) + free text → `auth.tsx:188` `signUp(email, password, meta)` |
| Empty state | "No events yet" + copyable `Mushi.track('signup_completed', { plan: 'free' })` + DNT notice |

### MCP + CLI

- `packages/mcp/src/catalog.ts` (+ `server.ts`, `mcp/index.ts`, `feature-groups.ts` group `activity`): `query_funnel(steps[], window, breakdown)`, `get_product_events_summary`, `get_user_paths(from_event)`; all `mcp:read`, readOnly/idempotent hints, following `activation_status` (`catalog.ts:474`, `mcp/index.ts:690`).
- `get_fix_context` handler emits `fix_context_pulled` with `surface:'mcp'`.
- CLI: add `Activation: ingest|dispatch|loop · first report <date>` to `mushi account status` (`packages/cli/src/commands/account.ts:141`) from `GET /v1/admin/activation`.

### Dogfooding taxonomy (`packages/core/src/analytics-taxonomy.ts`; `object_verb`, snake_case, every event carries `$surface`)

| Event | Surface | Required props | Emitter |
|---|---|---|---|
| `landing_view` | docs | `$utm_*`, `$referrer` | new `apps/docs/components/MushiSiteAnalytics.tsx` (client component in `app/layout.tsx`, `trigger:'hidden'`, `analytics.consent:'required'`, `NEXT_PUBLIC_MUSHI_SELF_*` build env) |
| `cta_click` | docs | `cta_id`, `location` | delegated click on `[data-mushi-cta]` (attrs added in `content/index.mdx` / `lib/landing-copy.ts`) |
| `quickstart_view`, `pricing_view`, `connect_demo_click`, `signup_click` | docs | `href` | route match / delegated click |
| `signup_completed` | console | `signup_source`, `utm_source` | `LoginPage.tsx` after `signUp` |
| `project_created`, `key_minted`, `first_report_received`, `fix_merged`, `upgrade_completed` | server | `project_id` | `emitProductEvent` |
| `report_opened` | console | `report_id`, `severity` | report detail page |
| `fix_context_pulled` | console / mcp | `report_id` | copy-context button / MCP handler |
| `fix_dispatched`, `invite_sent`, `upgrade_clicked` | console | `report_id`+`agent` / — / `plan` | dispatch success / members / billing |
| CLI wizard | cli | — | keep `setup_funnel_events`; extend enum with `console_project_created`, `console_key_minted`; dual-write from `emitProductEvent` |

Console wrapper `apps/admin/src/lib/track.ts` → `trackSelf(event, props)` = `getMushiSelf()?.track(...)`. Docs and console share the **same self project**, so the per-project reporter token in same-origin `localStorage` (`/mushi-mushi/` vs `/mushi-mushi/admin/`) is already shared and `identify(user.id)` in `mushi-self.ts` triggers the server backfill. First touch stored as `mushi_first_touch_<pid>`; `LoginPage` reads it into signup metadata. Consent UI: new `components/AnalyticsConsent.tsx` on docs ("first-party, no ads").

### Deploy checklist (full-stack ship discipline)

1. `node scripts/check-destructive-migrations.mjs`; confirm PITR before the retention cron.
2. Apply migrations 1 → 3 with `mcp__supabase__apply_migration` on `dxptnwrhwsqckaftyymj` (name = file stem); then `mcp__supabase__get_advisors` security + performance.
3. RLS proof: `select polname, cmd from pg_policies where tablename='product_events'`; `set role anon; select count(*) from product_events` → denied; member JWT → own-project rows only; service role insert works.
4. `supabase secrets set MUSHI_SELF_PROJECT_ID=… MUSHI_OPERATOR_USER_IDS=…`.
5. `npx supabase functions deploy api --no-verify-jwt && npx supabase functions deploy mcp --no-verify-jwt` (+ `stripe-webhooks` if touched).
6. `pnpm typecheck`; `pnpm --filter @mushi-mushi/{core,web,react,react-native,node,mcp,server} test` (new `core/src/event-tracker.test.ts`, `routes/events.test.ts` mirroring `ingest-rate-limit.test.ts`, funnel SQL fixture with expected counts); `pnpm --filter admin test`; `pnpm --filter docs build`.
7. E2E: `curl -X POST $API/v1/sdk/events -H "x-api-key: <key>" -d '{"anon_id":"t1","events":[{"name":"landing_view"}]}'` → `{accepted:1}` → row visible → `/users?tab=funnels` runs `landing_view → signup_completed` → landing with `?utm_source=e2e`, accept consent, click CTA, sign up with a source → `/growth` shows the row → MCP `query_funnel` returns the same numbers.

### Ordering and effort

| When | Work | Days |
|---|---|---|
| Wk 1 D1–2 | taxonomy + migration 1 + `routes/events.ts` + `_shared/product-events.ts` + 6 server emits; apply + deploy | 1.5 |
| Wk 1 D2–4 | `event-tracker.ts` + web `track/setConsent` + `mushi-self` wrapper + console events + `signup_source` + docs SDK/consent/landing events | 2 |
| Wk 1 D5 | migration 3 + operator gate + `/growth` → **company funnel live** | 1 |
| Wk 2 | migration 2 RPCs + admin routes + `UsersPage` + `FunnelBuilder` + empty states; React/RN/Node `track` | 4 |
| Wk 3 | MCP tools + CLI line + `content/sdks/analytics.mdx` + tests + retention tab | 2.5 |

Risks: rewards coupling (one-way consent share only); static-site consent under-counts Visit (treat Visit→Signup as a lower bound; CloudFront logs later as denominator); sampling is per-person hash, self project at 1.0; PII (client + server scrub, key denylist); founder pollution (company RPC excludes operator ids, `$surface` separates docs/console); unsigned `identify()` (host-asserted, same as sessions, document it); cardinality cap 200 event names/project; funnel SQL correctness proven by fixture before UI depends on it.

---

## Workstream B — Activate: landing conversion, first-run, lifecycle, trust

### Findings that shape it (verified)

| Finding | Evidence | Consequence |
|---|---|---|
| Tagline CI scans READMEs only, not the landing | `scripts/check-tagline-consistency.mjs:35-46,94-97` | H1 stays `MUSHI_TAGLINE_V2.hero`; lead, CTAs, proof line are free to change |
| One-click test report exists but yields a bland diagnosis | `routes/project-integrations.ts:203-259` posts `category:'other'`, "Admin pipeline test…" | reuse the endpoint, swap in a realistic fixture so the first diagnosis is an aha |
| Dashboard already lazily bounces empty users to `/onboarding` | `apps/admin/src/pages/DashboardPage.tsx:172`, `GettingStartedEmpty.tsx:48` | post-signup redirect is a small change plus removing the dashboard flash |
| GitHub OAuth is gated on GoTrue `/auth/v1/settings.external.github` | `apps/admin/src/lib/authProviders.ts:47-69`; `packages/server/supabase/config.toml` has no `[auth.external.github]` | enablement is Supabase dashboard config, then UI ordering |
| Email sender is Resend, duplicated in two places, default from `noreply@mushi-mushi.dev` (unverified domain) | `_shared/notifications.ts:207-233`, `usage-alerts/index.ts:40-60` | extract `_shared/email.ts`; `RESEND_FROM_EMAIL` must be a verified `kensaur.us` sender before any lifecycle send |
| Cron pattern to copy | `invitation-reminders/index.ts` + `migrations/20260507160000_invitation_reminders.sql` (`startCronRun`, `requireServiceRoleAuth`, pg_net `dispatch_*()`, `cron.schedule`) | clone verbatim for `lifecycle-emails` |
| Two dead legal links to two different paths | `apps/admin/src/components/tester/TesterWelcomeEnroll.tsx:71` → `/testers/terms`; `apps/testers/app/join/page.tsx:82` → `/docs/legal/privacy` | create `apps/docs/content/legal/*`, fix both |
| No public stats endpoint; docs CSP blocks third-party badge images | `routes/public.ts`, `landing-copy.ts:157-158` | proof = build-time snapshot with an "as of" date, never live shields |

### 1. Landing (`apps/docs/lib/landing-copy.ts`, `content/index.mdx`, `app/layout.tsx`, `content/_meta.ts`)

Five-second test today: *what* passes (H1), *for whom* is weak (eyebrow only), *outcome* is buried, *proof* fails (feature list), *CTA* fails (three co-equal CTAs, none says free / no-signup / time-to-value; primary goes to a docs page).

| Constant / file | Change |
|---|---|
| `LANDING_HERO.lead` | "For solo builders shipping Cursor- or Claude-written apps to real users. When someone hits a bug, Mushi turns what they felt into a plain-English diagnosis and a paste-ready fix in your editor. Sentry starts from what the code threw; Mushi starts from what the user felt." (revised 2026-09-21 after the competitor fact check) |
| `LANDING_HERO.proofLine` | delete; replace with `<LandingProofLine />` (new `components/landing/LandingProofLine.tsx`, registered in `mdx-components.tsx` and `LANDING_PATHS` in `scripts/check-public-voice.mjs:43-56`) rendering `apps/docs/data/proof-stats.json` `{sessions, reports, projects, asOf}` written by new `scripts/marketing/snapshot-proof-stats.mjs` (service-role read, founder-run, same pattern as `sync-docs-screenshots.mjs`) plus latest release from `data/changelog.json[0]`. Never render stars (3), testimonials, or logos until real. |
| `LANDING_HERO_CTAS` | [0] primary "Start free — first diagnosis in 60 seconds" → `${ADMIN_DEMO_BASE}/signup?src=landing-hero` (same tab: add `sameTab?: true` to the CTA type, branch at `CinematicEditorialHero.tsx:108`); [1] "Try the live demo — no signup" → `/connect`; [2] ghost "Prefer the terminal? `npx mushi-mushi`" → `/quickstart/incident-loop` |
| `LANDING_SIXTY_SECOND_STEPS.steps[1]` | "Send a test report (or ship and wait)" |
| `LANDING_OPERATOR.soloCta` / `LANDING_WHERE_TO_START[2]` | "Start free →" with `?src=landing-closing` / `?src=landing-console` |
| `content/_meta.ts:18-23,52` | `theme.sidebar:false` on landing and pricing (Nextra 4 per-page option); no second root layout |
| `app/layout.tsx:122-132` | move footer into client `components/SiteFooter.tsx` using `usePathname()`; render `KensaurusPortfolioTable` only off `/`, `/pricing`, `/connect`, `/legal/*`, `/security`; add Privacy · Terms · Security · Status · Contact (kensaurus@gmail.com) |
| `lib/public-copy.ts` (beside `PRICING_LEDE:43`), `content/pricing.mdx:13,134-141`, `components/PricingTiersTable.tsx:6-34` | `PRICING_CTA` "Start free — 50 diagnoses/mo, no card" → `/signup?src=pricing`; "Get started" column (Free → signup; Indie/Pro → start free, upgrade later; Enterprise → mailto) |

Decision on the demo: it stays **secondary**. `/connect` installs a read-only MCP against synthetic data (`connect/page.tsx:34-66`), which needs an IDE and a tool call before any aha, and fires no activation event. "Start free" + one-click test report reaches a real diagnosis on the visitor's own project in under a minute and fires the north-star event.

### 2. First-run in the console (`apps/admin`)

| # | Change | Where |
|---|---|---|
| a | Signup defaults `nextPath` to `/onboarding`; email-confirm and OAuth redirects carry it | `pages/LoginPage.tsx:82` (`defaultNextPath`); `lib/auth.tsx:41-43` `getRedirectUrl()` accepts a path; `signUp` (`:188-197`) passes `authRedirectUrl('/onboarding')`; `signInWithGitHub/Google` (`:150-170`) accept `{ next }`; keep `DashboardPage.tsx:172` as fallback |
| b | 3 required steps (`project_created`, `api_key_generated` auto-minted, `first_report_received`); `sdk_installed` becomes optional-recommended | `routes/activation-setup-builder.ts:183-206` (`required:false`; cta "See your first diagnosis") |
| b | Wizard becomes 2 screens: **S1** name project (auto key); **S2** "See your first diagnosis": `Send test report` (`POST /v1/admin/projects/:id/test-report`, `OnboardingPage.tsx:322-342`) → poll `/v1/admin/reports/:id` until classified → diagnosis inline + link to `/reports/:id`; below: `SdkInstallCard compact embedded` (`components/SdkInstallCard.tsx:52-61`) and the Cursor deeplink | `pages/OnboardingPage.tsx` (replace tab machinery `:950-999`, `:1085-1126`) with new `components/onboarding/FirstDiagnosisScreen.tsx`; keep `restartFirstRunTour` footer (`:1141-1151`) |
| b | Realistic synthetic report: move `scripts/marketing/seed-demo.mjs:56-138` fixtures to `_shared/demo-report-fixtures.json`; endpoint picks the iPad-Safari login fixture with `metadata.source:'admin_test_report'`; emit `test_report_sent` (Workstream A adds it to the `setup_funnel_events` CHECK) | `routes/project-integrations.ts:227-245` |
| c | Empty states embed snippet + test button instead of a link | `pages/OverviewPage.tsx:214-220` → `<FirstDiagnosisInline projectId>`; `pages/ReportsPage.tsx:582-596` extend `SdkConnectivityEmptyState` |
| d | Tour click-triggered, 4 stops (`reports`, `dispatch` renamed "Open in your editor", `askMushi`, new `report-diagnosis`); drop `plan`, `mode` | `components/FirstRunTour.tsx:40-89,147-156`; trigger button in `GettingStartedEmpty.tsx` and on S2 |
| e | "How did you hear about us?" select + free text; `?src=` read from `searchParams` (`LoginPage.tsx:57`) | signup form after `:471`; `signUp(email, password, { signup_source, signup_source_detail, signup_src })` → `supabase.auth.signUp({ options.data })`; OAuth: stash in `sessionStorage`, `AuthProvider` calls `supabase.auth.updateUser({ data })` on first session |
| f | GitHub OAuth first, primary in signup mode; email under the "or" divider. **Verified 2026-09-20: the live project has only Google enabled**, so this is a founder config task (create a GitHub OAuth App, paste client id/secret) before any UI change | Supabase Dashboard → Auth → Providers → GitHub (callback `https://dxptnwrhwsqckaftyymj.supabase.co/auth/v1/callback`); add `[auth.external.github] enabled = true` to `config.toml` after `:44`; `LoginPage.tsx:372-390,410-414`; re-check with `curl $SUPABASE_URL/auth/v1/settings -H apikey:… \| jq .external.github` |
| g | MCP-first after key mint: `<ClientConnectButton client={getMcpClient('cursor')}>` (`packages/mcp/src/clients.ts:200-234`) + copyable `npx mushi-mushi setup --ide cursor` on S2; emits existing `mcp_setup_done` | `components/ClientConnectButton.tsx` |

### 3. Lifecycle email

- New `_shared/email.ts` `sendTransactionalEmail({to, subject, text, html, headers})` extracted from the two Resend call sites; precondition: verified sending domain.
- New edge function `functions/lifecycle-emails/index.ts` cloned from `invitation-reminders/index.ts:353-396`; migration `lifecycle_email_sends(user_id, email_key, sent_at, unique)`, `lifecycle_email_optout(user_id, at)`, `dispatch_lifecycle_emails()` pg_net + `cron.schedule('dispatch_lifecycle_emails','37 * * * *')` (copy `20260507160000_invitation_reminders.sql:48-98`). Selection via `auth.admin.listUsers` (confirmed, ≤ 14 d) ⨝ owned projects ⨝ `reports` count; emails via `get_user_emails_by_ids` RPC (`20260621100839`).

| Email | Trigger | Content | Exit |
|---|---|---|---|
| day-0 welcome | `email_confirmed_at` set, ≤ 2 h | snippet, "Send a test report" deep link `/onboarding?action=test-report`, Cursor deeplink | — |
| day-2 nudge | 44–72 h, 0 reports | "No report yet? One click gets you a diagnosis"; reply-to kensaurus@gmail.com | any report / `activated` |
| day-7 stalled | 7–8 d, 0 reports | "What got in the way?" one-question reply email | `activated` |
| day-7 activated | 7–8 d, ≥ 1 report, no `mcp_setup_done` | "Pull the fix into Cursor" | `mcp_setup_done` |

All four are account-service emails; day-2/day-7 carry `List-Unsubscribe` + signed link `/v1/public/email/unsubscribe?t=` (HMAC of user_id with `LIFECYCLE_UNSUB_SECRET`): GET only confirms (mail scanners prefetch links), POST — the button or the RFC 8058 one-click request — writes `lifecycle_email_optout`; toggle in `/settings` notifications. No marketing list, no pixels.

### 4. Trust pages

- `apps/docs/content/legal/_meta.ts`, `legal/privacy.mdx`, `legal/terms.mdx`; register `legal:'Legal'` in `_meta.ts:49-56` and both in `PUBLIC_PATHS` (`check-public-voice.mjs:58`); add `'/legal'` to `DOCS_EXACT` in `scripts/cloudfront-mushi-spa-router.js:45-60` and `cloudfront-mushi-apex-redirect.js`; fix `TesterWelcomeEnroll.tsx:71`; signup submit gets "By creating an account you agree to the Terms and Privacy Policy".
- Privacy outline (structure only, founder supplies legal text): controller + contact; data categories (account, end-user report data via SDK incl. screenshots/console/network/reporter tokens/voice, console telemetry via Sentry, analytics only after consent); roles (project owner = controller, Mushi = processor, DPA summary); sub-processors (Supabase, Anthropic/OpenAI incl. BYOK, Resend, AWS, Sentry, GitHub, Stripe, Firecrawl); GDPR art. 6 bases; transfers + residency; retention (`retention-sweep`, plan tiers); DSAR; Japan APPI section; children; cookies/localStorage; changes/date.
- Terms outline: acceptance; license split; accounts; acceptable use incl. duty to notify end users about screenshot capture; data license to process; free-tier hard stop; paid plans (Stripe, spend cap); AI-output disclaimer; IP; third parties; termination; warranty/liability; governing law (founder placeholder); contact.
- `content/security/index.mdx` grows into the trust summary (posture table: residency, BYOK, BYO storage, retention sweep, nightly RLS coverage, prompt-injection sanitizer, SOC 2 *readiness* not certification, status page, vulnerability contact); reuse `packages/marketing-ui/src/PrivacyPosture.tsx`; add "Security" chip to `LANDING_TRUST_LINKS` (`landing-copy.ts:351-372`).

### 5. Domain

**Recommendation: stay on `kensaur.us/mushi-mushi` this quarter** and spend the days on activation. Reasons: 100 views/14 d means there is no SEO to protect or gain yet; a move costs 2–3 days across three CloudFront functions, OIDC deploy, auth redirect allowlist, OAuth callbacks, Search Console, and every registry; the "portfolio side project" read is mostly fixed by the footer/sidebar change. Cheap brand claim now: register `mushimushi.dev` and 301 it to `kensaur.us/mushi-mushi/*`. Revisit after 4 consecutive weeks with ≥ 1 activated external project/week. All URLs already flow through `MUSHI_CANONICAL_URLS`, so the later flip touches: `packages/brand/src/index.js:133-146`, `deploy-docs.yml:56-58,334-352`, `app/layout.tsx:24`, `lib/structured-data.ts:13-19`, `docs/marketing/canonical-urls.md`, `config.toml:18-23`, `scripts/cloudfront-mushi-*.js`, `data/admin-screenshots.ts:19`, `connect/page.tsx:20`, `apps/admin/src/lib/cliSetupCommands.ts`, `packages/mcp/src/branding.ts`, `usage-alerts/index.ts:37` (already wrong: `app.mushi-mushi.dev`), `invitation-reminders/index.ts:92-98`, sitemap/robots.

### 6. UI/UX scope (activation path only, no redesign)

| Surface | Change | Reuse |
|---|---|---|
| Landing hero | CTA relabel/reorder, proof line | `.landing-hero-cta--primary/secondary/ghost` (`apps/docs/app/globals.css:1232-1265`), `landing-trust__chip` |
| Landing/pricing shell | `sidebar:false`, conditional footer | Nextra theme options |
| Signup | GitHub primary, source select, legal line | `Btn`, `Input`, `Select` (`components/ui/fields`) |
| Onboarding S2 | test-report → polling → inline diagnosis card; snippet; Cursor button | `Card`, `Btn`, `ResultChip`, `ContainedBlock`, `Skeleton`, `SdkInstallCard`, `ClientConnectButton` |
| Overview/Reports empty | inline block | `EmptySectionMessage` (`components/ui/empty-section-message.tsx`), `Card` |
| Tour | 4 stops, click-trigger | existing coach-mark primitive |

Follow-ups after approval, not in this workstream: `audit-ui-states` for S2 polling states (queued / classifying / quota exhausted / classifier failed / offline); `enhance-web-ui` for the sidebar-less landing typography; `audit-responsive` at 1024–1280.

### 7. Ordering and effort (working days)

| Week | Slice | Days |
|---|---|---|
| 1 (cut time-to-first-report) | 2a redirect · 2b two-screen wizard + realistic fixture + inline diagnosis · 2f GitHub OAuth · 1 hero CTAs + `?src` · 2e source field | 4.5 |
| 2 | 2c empty states · 2g Cursor deeplink · 4 legal pages + footer + dead links · pricing CTA | 3 |
| 3 | 3 lifecycle emails | 3 |
| 4 | 2d tour · 1c sidebar/footer · 1e proof line + snapshot script · security summary | 3 |

Depends on Workstream A for the `setup_funnel_events` CHECK extension (`test_report_sent`, `diagnosis_viewed`) and the `activated` predicate used as the lifecycle exit.

---

## Workstream C — Be found, launch as a cadence, one loop

### Findings that change the plan (verified)

| # | Finding | File |
|---|---|---|
| 1 | `search_mushi_docs` (the MCP tool agents use) returns dead links: both static indexes point at `/guides/*` and `/reference/*`, which do not exist under `apps/docs/content/` (`quickstart/ concepts/ sdks/ admin/ …`) | `packages/mcp/src/docs-index.ts:24-60`, `functions/mcp/docs-index.ts` |
| 2 | The public `/launch-week` page says "Launch Week 1 ran June 2026" and lists Show HN / Product Hunt / Reddit; no HN, PH, or Reddit post for Mushi was found by web search. Features shipped; the posts did not. Credibility risk if an HN reader clicks it | `apps/docs/content/launch-week.mdx:23-38` |
| 3 | "Live demo, no signup" is asserted in `snippets.md`, `STOREFRONTS.md`, and the Show HN body, but the keyless `/connect` demo needs `NEXT_PUBLIC_MUSHI_DEMO_*`, which are commented out in `apps/docs/.env.example:27-31` | gate item #1 |
| 4 | Bluesky queue: 4 of 5 items scheduled Apr 2026 never posted | `docs/marketing/social/queue.json` |
| 5 | Widget "Powered by" footer exists as `brandFooter`, default `false`, plain text, no link, no event | `packages/web/src/widget-render.ts:227`, `widget.ts:216,291`, `packages/core/src/types.ts:202` |
| 6 | GitHub Discussions already enabled; linked only from `roadmap.mdx:20`; Discord only from `operating/status.mdx`; README links neither | — |
| 7 | JSON-LD `sameAs` claims `https://x.com/mushimushi_dev`; STOREFRONTS says the handle was never reserved | `apps/docs/lib/structured-data.ts:31` |

### 1. Launch cadence (three releases, one post each)

| Release | ~Day | Ships | Launch post | Journey post |
|---|---|---|---|---|
| R1 "Proof" | 14 | no-signup demo verified in incognito; `npx mushi-mushi` on a fresh app to first report filmed (< 5 min); hero GIF in both `TODO(loop-video)` slots; `search_mushi_docs` fixed; VS Code extension published (`VSCE_PAT`/`OVSX_PAT` + `publish-vscode-extension.yml`) or "deferred" written in `GTM-DISTRIBUTION.md` and not mentioned on HN; ToS/privacy live (B); issue SLA in `CONTRIBUTING.md:219`; `launch-week.mdx` rewritten honestly; `sameAs` fixed; Bluesky queue cleared; Workstream A activation SQL returns a number | **Show HN** (Tue, 12–17 UTC) | #1 (day 7, before HN) |
| R2 "Found" | 45 | 5 compare/how-to pages; Mushi setup skill audited for Claude Code/Cursor; Cursor plugin submitted | **Product Hunt** + r/cursor, r/ClaudeAI value threads + Console.dev / TLDR Web Dev pitch with the HN number | #2 (HN retro, day 21) |
| R3 "Loop" | 75 | powered-by mark + 3 K-factor events; console opt-out; Discussions as community home | dev.to + normal HN submission of journey post #3 (not Show HN) | #3, #4 |

Reconcile `docs/marketing/launch-week.md`: keep the presence rule (reply < 10 min), hard rules 1–7, Friday retro, Sunday post-mortem (create `docs/marketing/post-mortems/`); change the goal framing from stars/Trending to activated external projects, retire the 500-star bar in `measurement.md`, split the 5-day blast into the cadence above, PH moves to R2, Reddit becomes value threads over the two weeks after HN; "URL = demo" only once finding #3 is fixed, otherwise URL = repo with `npx mushi-mushi` in README line one. Rewrite the Show HN section of `snippets.md` from v1 positioning ("user-friction layer that complements Sentry", "SOC 2 evidence pack") to ADR 0004.

**Show HN title candidates (< 80 chars):** "Show HN: Mushi Mushi – Open-source bug reports that explain why AI-written code broke" · "Show HN: I built a bug reporter that gives a plain-English diagnosis for apps Cursor wrote".

**First-comment outline (human, sober, no mascot):** (1) widget → report with screenshot/console/network → plain-English diagnosis + fix prompt for Cursor/Claude Code; (2) why: I ship apps mostly written by Cursor, a user DM "it's broken" costs an afternoon on code I didn't write; (3) what's open: MIT SDKs, AGPLv3 server, one-command self-host, free 50 diagnoses/mo no card; (4) three factual lines vs Sentry Seer ($40/active contributor/mo add-on to Team, Business or Enterprise, not in self-hosted, exception-first), PostHog (replay + errors; "Fix with AI" prompts and beta draft PRs, 3 free/mo then $15, that start from captured exceptions), Jam.dev (human screen-recording for teams, not end-user capture + diagnosis); (5) honest state: 9 signups, 0 external projects with reports, what I want tested is diagnosis quality on a repo I've never seen; (6) links: demo, `npx mushi-mushi`, repo, 2-minute video; (7) known limits: docs EN-only, file references need repo indexing, diagnosis quota.

**PH outline:** tagline ≤ 60 "Bug reports that explain why your AI-built app broke"; description = items 1, 3, 4; gallery = hero GIF (`record-readme-gif.mjs`) + 3 stills (`capture-admin-screenshots.mjs`); maker comment = item 5; topics Developer Tools, Open Source, AI.

**Reddit angles (thread first, link in comments):** r/cursor "How I handle 'it's broken' DMs for apps Cursor wrote — report → fix-prompt loop over MCP"; r/ClaudeAI "A subagent that pulls a user's bug report + fix context into Claude Code" (paste `plugins/mushi-debugger/agents/mushi-debugger.md`); r/lovable, r/boltnewbuilders (check rules) "Your Lovable app broke for a real user: a debug checklist when you didn't write the code" → the how-to page; r/opensource, r/mcp existing snippets minus mascot; r/webdev, r/reactjs journey post #2 only.

Files: `docs/marketing/snippets.md`, `launch-week.md`, `apps/docs/content/launch-week.mdx`, `apps/docs/content/blog/*.mdx`, `docs/marketing/posts/*.md`.

### 2. Founder-story content (PostHog pattern; hand-written, one per release)

| # | Title | Publish |
|---|---|---|
| 1 | "I shipped a bug tool for 5 months and got 9 signups. Here's what the data said." | day 7 |
| 2 | "Show HN, by the numbers: what N visitors did on a no-signup demo" (real referrers from `gh api …/traffic/referrers`) | day 21 |
| 3 | "Nobody wanted a Sentry alternative. Here's what solo builders asked for instead." | ~day 50, after ≥ 10 conversations |
| 4 | "The first stranger's bug: what Mushi's diagnosis got right and wrong on a repo I'd never seen" (fallback: "90 days in the open: activated projects, not stars") | ~day 80 |

Location: `apps/docs/content/blog/<slug>.mdx` + `blog/_meta.ts`; mirror `docs/marketing/posts/<slug>.md` with `canonical_url` to the docs URL (fix `01-auto-fix-loop.md`, which canonicalises to the repo); publish via `node scripts/marketing/post-devto.mjs <slug> --publish`; one Bluesky item per post with a real `scheduled_for`. `content-plan.md`: these four replace the 8 feature posts.

### 3. Comparison pages (5, `docs-comparison-pages` rules: honest, unique, dated, reviewed quarterly)

New `apps/docs/content/compare/` (`_meta.ts`, `index.mdx` so the sitemap includes the folder per `sitemap.ts:16`, `_facts.ts` typed like `migrations/_catalog.ts` with `reviewedAt` + `sourceUrl` per fact, rendered via existing `components/ComparisonTable.tsx`; Sentry rows reuse `LANDING_COMPARISON_ROWS`). Root `_meta.ts:46` already has the `-- Compare` separator.

| Route | Fact table needs |
|---|---|
| `/compare/sentry-vs-mushi` | Developer free 5k errors; Seer $40/active contributor/mo add-on; what each captures; fix loop; self-host; Mushi free 50 diagnoses/mo |
| `/compare/jam-vs-mushi` | human-recorded team reports vs end-user capture + diagnosis + MCP; pricing tier |
| `/compare/posthog-session-replay-vs-mushi` | replay + error tracking free tier; "works alongside" stated honestly |
| `/compare/sentry-alternatives-for-solo-founders` | Sentry, Bugsnag, Rollbar, Highlight.io, PostHog, Mushi: free caps, self-host, AI fix, "pick this if…" |
| `/use-cases/lovable-app-broke-in-production` (how-to) | debug checklist when you didn't write the code; Mushi appears in one step |

Registration: `PUBLIC_PATHS` in `check-public-voice.mjs:58-129` → `pnpm gen:llms-txt` → `scripts/generate-llms-full.mjs` (parity test pins page count) → FAQPage JSON-LD via `lib/structured-data.ts` → visible "Facts checked YYYY-MM-DD" line.

### 4. AEO and third-party mentions

- Fix `search_mushi_docs`: generate the index at build time from `apps/docs/public/llms.txt` (or `llm-md/*.md` title + first paragraph) via new `scripts/gen-mcp-docs-index.mjs` with a CI `--check` like `check-mcp-catalog-sync.mjs`; delete the hand-maintained arrays in both `docs-index.ts` files.
- Agent skill (Langfuse pattern): `skills/mushi-setup` already exists (`npx skills add kensaurus/mushi-mushi`, documented in `content/sdks/skills.mdx`); audit it for Next/Vite/Expo/Lovable-export paths and make it call `search_mushi_docs` instead of embedding docs. Verify `packages/cursor-plugin/skills/mushi-triage/SKILL.md` tool names against the 72-tool catalog with `scripts/check-cursor-plugin.mjs`, then submit. List `.claude-plugin/marketplace.json` + `plugins/mushi-debugger/` in awesome-claude-code.
- Nudge awesome-remote-mcp-servers #431 once; submit OpenAlternative (alt to Sentry, Jam), LibHunt, StackShare, awesome-selfhosted (needs the demo), one per week, issue-first, tracked in `docs/marketing/awesome-list-submissions.md`.
- Console.dev + TLDR Web Dev pitch after R1 with the HN number (template in `snippets.md`, rewritten to v2).

### 5. The one loop: "Bug reports by Mushi" mark on the widget

Rejected for now: "Fixed by <reporter>" attribution (needs Releases + opt-in + merged fix; too deep at 0 activated), public diagnosis permalink (no share endpoint in `routes/public.ts`, PII review needed; R3 optional, demo project only), invite teammate (exists, ICP is solo, K≈0).

Spec: footer becomes a link `https://kensaur.us/mushi-mushi/?utm_source=widget&utm_medium=powered-by&ref=<hashed projectId>`; copy "Bug reports by Mushi" in `packages/web/src/i18n/{en,ja,es,th}.ts:188`; default **on** for Free Cloud projects via runtime config (`docs/SDK_RUNTIME_CONFIG.md`), off for self-host and paid; console toggle in project settings (opt-out, one click); the MIT `brandFooter` config remains a hard override. Events (names from Workstream A's taxonomy): `loop_impression` once per widget session (batched with heartbeat), `loop_click` (beacon), `loop_signup` (signup carrying the `ref`). K = `loop_signup / activated external projects`. Files: `widget-render.ts:227`, `widget.ts:216,291`, `types.ts:202`, `packages/core/src/presets.ts:93`, emit in `routes/public.ts`, attribute in `routes/onboarding-setup.ts`, update snapshot `packages/web/src/__snapshots__/styles.test.ts.snap`.

### 6. Community home: GitHub Discussions

Already enabled; indexed by Google and answer engines; async suits a solo JP-based founder; Langfuse precedent. Discord stays as an unpromoted link. Monday ritual (20 min): answer everything; turn each support email/DM into a Q&A thread with permission; "This week in Mushi" in Announcements; pin "Show and tell: your first report". Files: Community section in `README.md`, `CONTRIBUTING.md:219`, `.github/ISSUE_TEMPLATE/config.yml` contact link → Discussions, replace the Discord table in `drip-channels.md`.

### 7. JP track (optional)

Trigger: any JP-origin activated project, JP referrers in GitHub Insights / console country breakdown, or 4 consecutive weeks at 0 EN activations after R2. Minimal files: `README.ja.md` (hero + quickstart), one page `apps/docs/content/ja.mdx` (Nextra i18n is not configured in `next.config.mjs`, so one page beats a locale tree), a Zenn article (journey post #1 translated), a Qiita quickstart, X-JP by hand. Widget already ships `ja`; say so. Kana always むしむし per `VOICE.md`.

### 8. Weekly loop (five lines) and scorecard

| Line | Source |
|---|---|
| 1 Activated external projects this week | `company_funnel_weekly` (A) or the SQL below |
| 2 Funnel by source: signups → project → `sdk_first_heartbeat` → first real report → diagnosis viewed | `auth.users`, `projects`, `setup_funnel_events`, `reports`, `product_events` |
| 3 Top drop-off | `select public.get_setup_funnel_counts_7d();` (operator-gated after A) |
| 4 Launch/loop results: referrers, `loop_*` counts, HN/PH stats | `gh api repos/kensaurus/mushi-mushi/traffic/referrers`, `product_events` |
| 5 One experiment + one post next week; append a row | new `docs/marketing/scorecard.md` (append-only); `measurement.md` rewritten to point at it and drop the star bar |

```sql
-- activated external projects per ISO week
select date_trunc('week', first_real) as week, count(*)
from (
  select r.project_id, min(r.created_at) as first_real
  from reports r
  join projects p on p.id = r.project_id
  join organizations o on o.id = p.organization_id
  where o.name <> 'kenji'  -- replace with operator user-id exclusion once MUSHI_OPERATOR_USER_IDS exists
    and coalesce(r.custom_metadata->>'source','') not in ('mushi-marketing-seed','admin_test_report')
  group by r.project_id
) t group by 1 order by 1;
```

### 9. Effort against 20 h/week

Writing (journey posts, compare pages, snippets) 6 h · launch presence 2–8 h (8 on HN/PH weeks) · engineering (gate items, docs-index generator, loop + events) 6 h · weekly loop + listings 2 h. Buy if budget exists: a video editor for the 20–30 s incident-loop clip (the Cursor session must be filmed live) and PH stills; a native JP copy check only if the JP trigger fires. Never buy upvotes, PH hunters, or ads.

---

## Findings

| # | Area | Gap | Evidence | Sev | Direction |
|---|---|---|---|---|---|
| 1 | Measurement | Funnel unmeasurable; activation derived not evented; `setup_funnel_events` CLI-only and silent since Jul 19 | `activation-status.ts:37-46`, `20260622013932:44-54` | P0 | Workstream A wk 1 |
| 2 | Activation | 0/4 external projects ever sent a report; new users land on `/dashboard`; test report yields a bland diagnosis | live SQL, `App.tsx:307`, `project-integrations.ts:231` | P0 | Workstream B wk 1 |
| 3 | Distribution | Never launched; `/launch-week` claims otherwise; Bluesky queue unposted | web search, `launch-week.mdx:23-38`, `queue.json` | P0 | Workstream C R1 |
| 4 | Positioning/CTA | Landing primary CTA is a docs link; no "Start free"; no proof | `landing-copy.ts:18-37,318-326` | P1 | B §1 |
| 5 | Attribution | No `signup_source`; no UTMs on CTAs | `LoginPage.tsx` | P1 | A §7 + B §2e |
| 6 | Trust | No privacy/terms; dead legal links; unverified sender domain | `TesterWelcomeEnroll.tsx:71`, `notifications.ts:207` | P1 | B §3–4 |
| 7 | Auth | GitHub OAuth is **disabled on the live project** (`/auth/v1/settings` 2026-09-20: `google:true`, no `github`, `passkeys_enabled:false`), so the GitHub button never renders for a developer ICP; every signup used email | `authProviders.ts:47-69`, live GoTrue settings, `auth.users` | P1 | B §2f |
| 8 | AEO | `search_mushi_docs` dead links; `sameAs` X handle unverified | `docs-index.ts:24-60`, `structured-data.ts:31` | P1 | C §4, R1 gate |
| 9 | Content | 2 blog posts; 1 of 8 planned; no `/compare/*` | `content/blog/`, `content-plan.md` | P2 | C §2–3 |
| 10 | Loop | `brandFooter` off, unlinked, no events | `widget-render.ts:227` | P2 | C §5 (R3) |
| 11 | Community | Discussions enabled but unlinked; Discord activity unknown | `roadmap.mdx:20` | P2 | C §6 |
| 12 | Monetization hygiene | dead `hobby`/`starter` plan IDs; pricing page without CTA | `plans.ts:16`, `pricing.mdx` | P3 | Phase 1 hygiene |
| 13 | Data leak | `get_setup_funnel_counts_7d` returned to every user | `onboarding-setup.ts:167` | P2 | A §3 operator gate |
| 14 | North-star doc drift | `measurement.md` still targets 500 stars; `NORTH-STAR.md` Phase-1 metric = time-to-first-diagnosis < ~2 min | `measurement.md:12-24`, `NORTH-STAR.md:61-64` | P2 | rewrite both in Phase 1 |

## Phased burndown (approve per phase; `workflow-gtm` executes in order)

| Phase | Scope | Execution skills | Done when |
|---|---|---|---|
| **1 — Measure & message** (wk 1–2) | Workstream A wk 1 (taxonomy, `product_events`, server emits, `signup_source`, `/growth`); Workstream B §1 landing CTAs + proof line + pricing CTA; rewrite `measurement.md`, `NORTH-STAR.md` Phase-1 metric, `launch-week.mdx`; remove dead plan IDs; write `docs/plan-gtm.md` (this document) + `docs/marketing/scorecard.md` | `audit-analytics`, `enhance-web-conversion`, `audit-registry-listing` → `enhance-readme`, `docs-adr` (record north-star + domain decision) | every funnel cell has a number or an honest lower bound; `/growth` renders by `signup_source` |
| **2 — Activate** (wk 1–4, overlaps) | Workstream B §2 first-run (redirect, 2-screen wizard, realistic test report, GitHub OAuth, empty states, tour), §3 lifecycle email, §4 legal + security pages; Workstream A wk 2–3 (`UsersPage`, RPCs, MCP tools, SDK `track` in React/RN/Node) | `enhance-onboarding`, `audit-ui-states`, `enhance-lifecycle-email`, `enhance-web-forms` | a fresh signup sees a diagnosis in < 60 s; `first_report_received` fires; day-2 email sends and exits |
| **3 — Be found** (wk 3–7) | Workstream C §3 five compare/how-to pages, §4 docs-index fix + skill audit + listings, `sameAs` fix | `docs-comparison-pages`, `plan-aeo-readiness` → `enhance-web-seo`, `docs-writer` | 5 pages live, in sitemap + llms.txt; `search_mushi_docs` 0 dead links |
| **4 — Launch & loop** (wk 2 → 12) | R1 Show HN (wk 2–3) → R2 Product Hunt + Reddit + newsletters (wk 6–7) → R3 loop (wk 10–11); journey posts 1–4; Discussions ritual; weekly scorecard | `docs-launch-kit`, `enhance-growth-loops`, `iterate-gtm-weekly` | three launch posts shipped; loop events counted; 12 scorecard rows |
| **5 — Monetize** (parked) | trigger: ≥ 10 activated external projects | `plan-pricing` → approval → `enhance-web-conversion` (pricing), `enhance-lifecycle-email` (upgrade nudges) | not before the trigger |

Execution note: Phase 1 and the week-1 slice of Phase 2 are the same calendar week (A wk 1 + B wk 1 ≈ 9 working days at 20 h/week ≈ 3.5 weeks); the workflow-gtm gate "measured first" is satisfied by A's derived-first company funnel landing before any B copy ships.

## 30 / 60 / 90

| Day | Metric | Target | Owner skill |
|---|---|---|---|
| 30 | Funnel cells measured (Visit lower bound, Signup, Project, Key, Activated, Fix pulled, Paid) | 7/7 | `audit-analytics` |
| 30 | Time from signup to first diagnosis on screen (median, new external signups) | < 5 min (benchmark top quartile), hard ceiling 24 h | `enhance-onboarding` |
| 30 | Pre-launch gate | 10/10 items | `workflow-launch-ready`, `docs-launch-kit` |
| 30 | Show HN posted, journey posts live | 1 + 2 | `docs-launch-kit` |
| 30 | Activated external projects/week | measure baseline (today 0) | `iterate-gtm-weekly` |
| 60 | Compare/how-to pages live, in sitemap + llms.txt | 5 | `docs-comparison-pages` |
| 60 | Third-party listings resolved (OpenAlternative, #431, awesome-selfhosted, newsletter pitched) | 3–4 | `plan-aeo-readiness` |
| 60 | Activated external projects/week | any week ≥ 1; report the range | `iterate-gtm-weekly` |
| 60 | Product Hunt listed; Users & Funnels shipped to all projects | 1; shipped | `docs-launch-kit`, A |
| 90 | Powered-by loop live with 3 events; K measured | shipped; baseline K | `enhance-growth-loops` |
| 90 | Journey posts | 4 | `docs-writer` |
| 90 | Day-7 return of new external signups | measure (benchmark: ≥ 7% = top quartile) | `iterate-gtm-weekly` |
| 90 | Discussions threads from non-founder accounts; JP trigger evaluated | baseline; decision recorded | `docs-adr` |

## Weekly GTM review (after Phase 4)

Funnel by source · activation cohort (signup week → activated %) · top drop-off step · one experiment shipped · one launch or post. Five lines appended to `docs/marketing/scorecard.md` every Monday; production defects stay on `iterate-post-launch`.

## Verification (end-to-end, per phase)

1. **Repo gates after each slice:** `pnpm typecheck`; package tests listed in A §deploy; `pnpm --filter @mushi-mushi/docs build`; `pnpm check:public-voice`; `pnpm check:tagline`; `pnpm gen:llms-txt --check`; `node scripts/check-mcp-catalog-sync.mjs`.
2. **Schema live (full-stack ship discipline):** migrations applied on `dxptnwrhwsqckaftyymj` with matching files in `packages/server/supabase/migrations/`; `get_advisors` clean; RLS proofs from A §deploy; edge functions `api`, `mcp`, `lifecycle-emails` redeployed; secrets set.
3. **Funnel proof:** open the landing in a fresh profile with `?utm_source=e2e` → accept consent → click "Start free" → sign up with GitHub and source "Hacker News" → land on `/onboarding` → Send test report → diagnosis renders < 60 s → `select event_name, properties->>'$surface' from product_events order by ts desc limit 10` shows `landing_view, cta_click, signup_completed, project_created, key_minted, first_report_received` → `/growth` shows the row under source `hn` → MCP `query_funnel` returns the same counts → day-2 email dry-run selects then skips this user (activated).
4. **Customer feature proof:** on a founder app (glot.it), `Mushi.track('checkout_started')` → `/users?tab=funnels` runs `session_start → checkout_started` with a breakdown → `/users?tab=people` lists the identified user.
5. **Launch gate:** demo loads in incognito with no signup; `npx mushi-mushi` on a fresh Next.js app reaches a first report in < 5 min (screen-recorded); `/launch-week` rewritten; legal pages return 200; `search_mushi_docs` returns 0 dead links (curl each URL).
6. **Browser walkthroughs** use headed `playwright-cli` per `protocol-browser-anti-stall`, with a clean console.
7. **Completion claims** follow `verification-before-completion`: each phase reports the highest proven rung (implemented → scoped verified → repository green → deployed verified → observed stable) and invokes `completion-judge` before closing.

## Sources (verified 2026-09-20)

- https://review.firstround.com/sentrys-path-to-product-market-fit/ — Sentry: OSS adoption first, hosted converts the next generation, JavaScript-first, "we removed the market"
- https://blog.sentry.io/driven-by-open-source/ — Sentry: community SDKs, first paying customer Feb 2013, hosted tier built over Christmas 2012
- https://shiftmag.dev/milin-desai-sentry-open-source-business-model-739/ — Sentry CEO: "packaging, not pricing", maximum adoption over maximum dollars
- https://langfuse.com/handbook/chapters/story — Langfuse timeline: Show HN + Launch YC + PH (Aug 2023), Launch Weeks, Discussions, 2M→26M installs/mo, MIT open-sourcing Jun 2025, price halving Sep 2025, ClickHouse Jan 2026
- https://langfuse.com/blog/joining-clickhouse · https://clickhouse.com/blog/clickhouse-raises-400-million-series-d-acquires-langfuse-launches-postgres — acquisition facts, 20k stars, 26M+ SDK installs/mo
- https://www.youtube.com/watch?v=vNCY9kXXyDQ — Langfuse (May 2026): agent skill + docs search endpoint for coding agents
- https://posthog.com/founders/first-1000-users · https://newsletter.posthog.com/p/the-stuff-nobody-tells-you-about · https://www.howtheygrow.co/p/how-posthog-grows-the-power-of-being — PostHog: first users by hand, journey posts, no-card signup, ~70% recommendations
- https://www.infrasity.com/blog/open-source-marketing-strategy (Jun 2026) — 2026 discovery via communities + AI answers; README as landing page; awesome-lists, MCP registries, OSS directories, newsletters; stars are vanity
- https://tech-insider.org/sentry-vs-bugsnag-vs-rollbar-2026/ · https://last9.io/blog/sentry-pricing/ — Sentry Developer plan free (5k errors), Seer $40/active contributor/mo since Jan 27 2026; Bugsnag/Rollbar free tiers (third-party; superseded by the primary sources below)
- Primary sources re-checked 2026-09-21 (the compare pages cite these): https://sentry.io/pricing/ · https://docs.sentry.io/pricing/ · https://develop.sentry.dev/self-hosted/ · https://www.bugsnag.com/pricing/ · https://docs.bugsnag.com/on-premise/ · https://rollbar.com/pricing · https://rollbar.com/resolve · https://rollbar.com/blog/sentry-alternatives/ · https://github.com/highlight/highlight · https://launchdarkly.com/pricing/ · https://posthog.com/pricing · https://posthog.com/docs/error-tracking · https://posthog.com/docs/self-driving/pricing
- `C:\Users\kensa\.claude\skills\plan-gtm\references\benchmarks-2026.md` — every conversion, activation, Show HN, PH, comparison-page, badge, and referral number quoted above, with its primary sources
- Repo: `docs/marketing/*`, `docs/strategy/NORTH-STAR.md`, `docs/adr/INDEX.md`, live Supabase and GitHub queries listed in Context

## Execution handoff

Approve a phase → `workflow-gtm` runs it (Step 2 `audit-analytics` first), writes `docs/plan-gtm.md` from this file on the first run, appends the scorecard weekly, and re-reads the funnel table before and after each phase. Nothing in this plan is applied until then.
