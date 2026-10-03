# Portfolio Operator — Mushi for one person running many apps, sites and services

> Status: `IN PROGRESS`. Researched 2026-10-02. Phases 0–4 are built (checked against the code 2026-10-03; see [PLANS.md](./PLANS.md) Plan 020 for what is built, and §12.1 below); apply and deploy are tracked per release batch. Phase 2 detectors listed in §4.2 but not in the code (e.g. `dead_app_live_spend`, `provider_key_invalid`, `key_in_client_bundle`) are still open.
> Registered as Plan 020 in [PLANS.md](./PLANS.md). The sequencing gate was struck and the §15 decisions taken on 2026-10-02: [ADR 0017](../adr/0017-strike-the-plan-019-020-sequencing-gate.md).
> Foundation: [Plan 019 — App Recipe Control Plane](./app-recipe-control-plane.md) and [ADR 0016](../adr/0016-mushi-as-the-app-recipe-control-plane.md). The owner delegated its acceptance on 2026-10-02 (Phases 1, 1b and P1 proceed; 2, P2, 3 and any `act` stay gated), though the file still reads "Proposed". This plan **builds on** Plan 019's recipe data model, connector interface (§2b), `portfolio_resources` and portfolio rollup (§3b). It does not redefine any of them.
> Positioning companion: [`docs/marketing/portfolio-positioning.md`](../marketing/portfolio-positioning.md).
> Scope: `packages/server` (new detectors, rule sets and routes on top of Plan 019), `apps/admin` (store ops, radar and digest views), `packages/mcp`, `packages/cli`, docs and marketing pages.

## Goal

Make Mushi the place where a solo **portfolio operator** finds out what is broken, drifting or quietly costing money across every app they run, and gets a reviewed fix: a draft PR, a paste-ready prompt for Cursor or Claude Code, or an owner-approved action.

The diagnosis stays the front door. A portfolio operator is the same vibe coder from VISION §1.4, a year later, with five apps instead of one. Every module below must answer the drift test per app: *does it help them understand and fix a bug faster, or catch a hole before a user hits it?* A hole found before a user hits it is a bug fixed in zero minutes. That is the only extension of the test this plan relies on, and it needs the owner's ADR (see the positioning doc).

## Boundary with Plan 019

| Plan 019 owns (020 only consumes) | Plan 020 owns |
|---|---|
| The recipe data model, `mushi.recipe.json`, the five render states, `deriveElementState()` | The **tech-debt radar**: detector rules (`rule_id`s) that run on 019's connectors and write 019's `gate_findings` / `portfolio_findings` |
| The `RecipeConnector` interface, the registry, contract tests, Vault credential refs, `connector_actions` approval (§2b) | New **capabilities and rule sets** on 019's connector kinds (`app_store_connect`, `play_console`, `supabase`, `github`, `stripe`, `posthog`), and the case for any new kind |
| `portfolio_resources`, `/portfolio`, the "fix once" list, repeated-finding grouping, SDK skew, integration holes, CI cost per repo (§3b) | **Store ops** (listing as code, claims vs code, screenshots, locales, review risk, name parity, batched releases) |
| Cross-project rules: shared-auth divergence, billing consistency, deep-link probes, shared channels (§3b) | **Spend** across apps (LLM, API, storage, CI) and its caps |
| Push and legacy adapters (`/v1/ingest/recipe`, `/events`, `/csv`, OTel) | **Repo understanding**: digest and architecture diagram, including a public growth page |
| | **GTM and analytics**: cross-app sign-up and activation funnels, cross-promotion, the operator digest, SEO for this capability |
| | **Cross-app identity, customer credits and end-user notifications**: mostly partner decisions, plus the divergence and setup checks |

Where a row below says "→ 019 §x", Plan 020 adds nothing but a pointer.

---

## 1. Problem statement and ICP evolution

### 1.1 The case study: one owner, one day (2026-10-02)

The owner runs:

- 5 store apps: glot.it, Help Her Take Photo, lets-talk / cooler-heads, the-wanting-mind, yen-yen;
- websites: the kensaur.us portfolio, solo-boss-cloud, tsumagoi, hear-hear, the Mushi docs;
- 6 Supabase projects, plus AWS, Vercel / CloudFront and Sentry.

In one day of audits, the following turned up. Security holes that may not yet be fixed and deployed are described generically on purpose: this repository is public.

| # | Finding | Class |
|---|---|---|
| 1 | **2.7 TB of orphaned Supabase Storage**, billed for months. Rows were deleted from `storage.objects` with SQL, which Supabase documents as leaving the file in the bucket ([docs](https://supabase.com/docs/guides/storage/management/delete-objects): "Deleting objects via a SQL query will not remove the object from the bucket and will result in the object being orphaned"). | Cost |
| 2 | **A secret-reading RPC became callable by `anon` again** when database functions were copied between projects. The grant came along with the copy. | Security |
| 3 | **Edge functions in an app that is no longer in use** were still deployed without auth and spending paid API keys. | Security + cost |
| 4 | **A revoked BYOK key broke RAG silently.** Mushi's own health probe never reads `byok_keys` (§4.1). | Silent failure |
| 5 | **Mushi SDK version skew** across apps: web 1.26–1.29. | Drift |
| 6 | **Private-repo CI spend concentrated in 2 repos.** | Cost |
| 7 | **App Store and Google Play names out of sync** for the same app. | Store |
| 8 | **A Sentry webhook that had never worked** since it was configured. | Silent failure |
| 9 | **A fix agent wrote a file it never saw.** The codebase index used the wrong default branch and had been frozen since June. | Silent failure |
| 10 | **Autofix spend caps unset** on every dogfood project. | Cost |
| 11 | **Live store listings made claims the code contradicts**: "photos never leave your phone" and "open source" (Help Her Take Photo); "never" claims (yen-yen); "162 lessons" and "native speaker audio" (glot.it). Some also contradicted the apps' own privacy labels. | Store + legal |
| 12 | **iOS screenshots were Android emulator captures.** | Store |
| 13 | **The `ja` locale was missing** from listings, for an owner based in Japan. | Store |
| 14 | **yen-yen's Play service account lacked "Manage store presence"**, so listing automation could not work. | Store + credentials |
| 15 | **An App Store rejection traced back to code**: a default persona, a missing AI-data disclosure, a privacy URL that did not render, and BYOK purchase steering. | Store review |

None of these threw an error. None would reach Sentry or Mushi's bug widget. Each was found by hand, by an agent session that held credentials for many accounts at once, and each was cheap to fix once seen. That is the gap.

### 1.2 ICP evolution

| Stage | Who | Pain | What Mushi gives them |
|---|---|---|---|
| **Stage 1 (today's ICP, unchanged)** | A solo vibe coder with one app and real users | "Something broke and I don't understand the code" | The diagnosis: plain English, a fix prompt, an optional draft PR, in the editor |
| **Stage 2 (this plan)** | The same person with 2–10 apps, sites and services across several providers | "Something is broken, drifting or billing me somewhere, and I can't watch all of it" | The same diagnosis per app, plus a portfolio view, a radar for holes that never throw, store ops, and fixes batched across repos |
| Not targeted | Platform teams with a service catalog | Ownership, on-call, scorecards per team | Backstage, Port, Cortex (Plan 019 §8 non-goals) |

**Activation stays Stage 1.** A portfolio operator is activated one app at a time. Nothing in this plan may add a step before a first diagnosis.

---

## 2. Landscape

Full research notes are in the Sources section. Prices are from vendor pages unless marked *(secondary)*.

### 2.1 Pain point → best existing tool → gap for a solo portfolio operator

| Pain point | Best existing tool(s) | Gap for one person running many apps from an AI editor |
|---|---|---|
| Many store apps + websites in one view | Expo EAS (25 projects on Free; remote MCP reads builds, TestFlight crashes and store reviews); read-only founder dashboards (SidePop, MakerPulse) | EAS is Expo-only: Capacitor apps and websites are invisible. The dashboards show revenue and fix nothing. |
| Schema, backend, database | Supabase Advisors + Supabase MCP (`get_advisors`), Neon branching | Per project. MCP `project_ref` scoping drops account-level tools, so a fleet view needs a riskier unscoped token. Storage orphaning is not flagged. |
| Updates (deps, SDKs, OTA) | Renovate / Dependabot, EAS Update, Capgo | Per repo; no cross-repo rollup; no link between "bumped" and "live". |
| Sign-ups and auth | Clerk (satellite domains $10/mo each), Supabase Auth OAuth 2.1 server (Beta), Auth0 Free (1 tenant) | One identity across apps is possible, but nobody checks that five apps' auth settings agree. |
| Credits between apps | **Spend:** Vantage (MCP), Langfuse / Helicone. **Customer credits:** RevenueCat (entitlements shared within one project), Stripe Billing, Polar | Anthropic's Usage & Cost Admin API is unavailable to individual accounts. Stripe credit grants cannot act as cross-app tokens. No one ties spend to the app and key that burned it. |
| GTM, marketing, cross and deep links | PostHog (free MCP), Plausible, Dub (iOS deferred deep links "coming soon"), Branch; Firebase Dynamic Links shut down 2025-08-25 | Per project; no cross-app funnel; no check that a sibling app's links still resolve. |
| Linking notifications | OneSignal (free push now 1,000 MAU per org across all apps), Knock, Novu, Courier, Expo Push | End-user notification products; nothing gives the operator one digest across apps. |
| Triage via Cursor / Claude Code | Sentry Seer + MCP, Vercel Agent, Copilot coding agent, Linear agents | Seer sees only what throws ($40 per contributor on a paid plan). Copilot's agent "cannot make changes across multiple repositories in one run". |
| Release | fastlane, EAS Submit, Codemagic, Bitrise (app caps) | Scripts and pipelines per app; no portfolio release calendar; no "this fix is live in which app" view. |
| Guards, gates, CI/CD | GitHub rulesets (org-level is Enterprise-only), Trunk, Mergify, Socket, Snyk (Free capped at 5 projects) | Gates are copied per repo; cost is invisible; a 10-repo portfolio outgrows free tiers. |
| Analytics + pipeline | PostHog, Amplitude | Per project. |
| Integratable and pluggable | Zapier MCP, Pipedream Connect, n8n | Generic plumbing that does not know what a bug or a recipe is. |
| Old systems and infra | OpenTelemetry OTLP, webhooks | A protocol with no diagnosis of its own. |
| Suggest fixes for holes and tech debt | Aikido (free: 10 repos, MCP, autofix), Supabase Advisors, vibe-app scanners ($19–39/mo) | Each sees one layer. None sees the store listing, the billing, the webhook and the RLS together. |
| Repo understanding | Gitingest, GitDiagram, DeepWiki, Repomix, Google Code Wiki | None connects understanding to live bugs, diagnoses or fix PRs, or to a portfolio of repos. |

### 2.2 Is it true that "no other integrator does this"?

**Only in its narrow combined form.** No product found does all four of these:

1. it sees many apps across vendors;
2. it catches holes that never throw (orphaned storage, anon-callable RPCs, store-claim mismatches, a dead webhook);
3. it fixes them as PRs or editor prompts;
4. it is priced for one person.

Every piece exists separately, and the honest wording is **"no one bundles this for a solo operator"**, not "no one does this". The closest competitors, ranked:

1. **A coding agent composing vendor MCPs.** This is the real competitor. Claude Code or Cursor with the Supabase, Expo, Vercel, Sentry, PostHog and RevenueCat MCPs can do most single checks today; that is exactly how today's audit was done. It lacks memory across sessions, scheduled detection, cross-vendor rules and least-privilege credentials, and it holds every key at once. Mushi's moat is the **rules plus the schedule plus the fix loop**, not access.
2. **Sentry (Seer + MCP)** spans every project in an org and opens fix PRs, but only for what throws.
3. **Expo EAS + Expo MCP** reads builds, TestFlight crashes and both stores' reviews, so it is the closest store-ops overlap. It is Expo-only, with no websites and no backend.
4. **Aikido Security** has repos, cloud config, secrets, an MCP and autofix on a free tier. It does not know Supabase RPC semantics, stores, billing or cost.
5. **Port** is the only IDP a solo developer can use free (15 seats), with an MCP and AI agents. It is a blank modelling canvas with no bug intake.

Also considered: Better Stack (uptime, logs, AI SRE, MCP; no fix PRs), Vercel Agent (Vercel only), Replit and Lovable security scanners (their own hosting only), Datadog Bits AI ($500/mo floor), Resolve.ai, Cleric and Traversal (enterprise).

### 2.3 What the owner did not list — ranked by pain × frequency for a solo operator

Pain 1–5 (5 = business-ending), frequency 1–5 (5 = weekly). Score = pain × frequency.

| Rank | Need | Pain | Freq | Score | Evidence | Mushi decision |
|---|---|---|---|---|---|---|
| 1 | **Leaked or revoked keys, secrets rotation** | 5 | 4 | 20 | AI-assisted commits leak secrets at 3.2% vs 1.5%; a pushed OpenAI key ran up $12k in 48 h | Build detectors (key validity, exposure, unused keys); partner GitHub secret scanning / GitGuardian for leak detection |
| 2 | **Cost / FinOps across clouds and LLM APIs** | 4 | 4 | 16 | A forgotten NAT gateway; a $100k Netlify bill; finding #1 | Build per-app spend rollup and caps; partner Vantage for cloud bills |
| 3 | **Store review compliance and policy deadlines** | 4 | 4 | 16 | Apple rejected 1.93M of 7.7M submissions in 2024; Play target API 36 since 2026-08-31 | Build (store ops, §5) |
| 4 | **Privacy labels and policies that match the code** (ATT, Data safety, GDPR / APPI) | 4 | 3 | 12 | Mozilla: ~80% of top Play apps had false or misleading Data safety labels; finding #11 | Build claims-vs-code; partner Termly / iubenda for policy text |
| 5 | **Dependency and security advisories across repos** | 3 | 4 | 12 | Escape.tech: 2,000+ vulns and 400+ exposed secrets across 5,600 vibe-coded apps | Integrate Socket / Renovate / Aikido findings through ingest; do not build a scanner |
| 6 | **Uptime and status pages** | 3 | 3 | 9 | Commodity | Partner (Better Stack, OpenStatus); ingest their webhooks as reports |
| 7 | **LLM eval and cost per app** | 3 | 3 | 9 | — | Partner Langfuse / Helicone; roll their cost into spend |
| 8 | **Support inbox unification** | 3 | 3 | 9 | — | Partner (Crisp, Plain, Chatwoot all have MCPs); ingest as reports |
| 9 | **Data export and erasure across apps** (DSAR, account deletion) | 4 | 2 | 8 | Apple 5.1.1(v) and Play both require in-app account deletion | Detector: deletion path exists per app; no DSAR product |
| 10 | **App store review replies** | 2 | 4 | 8 | Play API: 2,000 replies/day, last 7 days only | Turn reviews into reports (intake); reply through the operator's own key later |
| 11 | Feature flags and kill switches | 3 | 2 | 6 | — | Partner (PostHog flags, GrowthBook); detector "no kill switch for paid-API features" |
| 12 | Churn / retention | 3 | 2 | 6 | — | Partner RevenueCat / PostHog |
| 13 | Account / bus-factor risk (Apple, Google, AWS account loss) | 5 | 1 | 5 | An indie dev lost an Apple account with 5 apps and $30k held; AWS deleted a 10-year account | Build a small accounts register and export pack (names, recovery contacts, 2FA declared; never secrets) |
| 14 | Backups / DR | 5 | 1 | 5 | Supabase backups exclude Storage API objects | Detector only: "PITR off" and "Storage not backed up" per project |
| 15 | Domain / DNS / TLS expiry | 4 | 1 | 4 | Expired domains of once-popular launches | Build: public RDAP and TLS probes, no credentials, cheap |
| 16 | i18n coverage | 2 | 2 | 4 | Finding #13 | Detector (listing and app locale coverage) |
| 17 | Open-source license compliance | 2 | 1 | 2 | — | Partner FOSSA / ScanCode |

**Top 10 by score:** keys and secrets; spend; store compliance; privacy-claims match; advisories across repos; uptime; LLM eval and cost; support inbox; data deletion; review replies.

**Low frequency but business-ending, handled anyway:** account / bus-factor loss (§11), backups / DR and domain / TLS expiry (§4.2). Each scores low because it is rare, but one occurrence can end the business, and each is cheap to cover: a form, a few rules and public probes.

---

## 3. Capability map

Paths: **F** = `packages/server/supabase/functions`, **M** = `packages/server/supabase/migrations`, **A** = `apps/admin/src`. Citations checked against this worktree on 2026-10-02.

Decision key: **Build** = Mushi's own code; **Integrate** = consume another tool's data through a Plan 019 connector or ingest; **Partner** = point the operator at another product and check that it is set up, without competing.

| Pain point | Module | Existing pieces | Gap | Decision and reasoning |
|---|---|---|---|---|
| Many apps in one view | Portfolio (→ 019 §3b) | `organizations` (M/20260428000000_organizations.sql:11), `projects.organization_id` (:27); `GET /v1/admin/portfolio` (F/api/routes/dashboard.ts:1133) over `org_portfolio_summary` (M/20260921000010_funnel_definitions_and_bot_sessions.sql:158); `ProjectSwitcher` / `OrgSwitcher` (A/components/ProjectSwitcher.tsx:35, OrgSwitcher.tsx:51); MCP `list_projects`, `get_account_overview` (packages/mcp/src/catalog.ts:376, :389) | Today's rollup is sessions, users and tickets only: no gates, CI, deploy or health | **Build, in Plan 019 P1.** 020 adds radar and spend columns to the same cards |
| Schema, backend, database | Radar (Supabase detectors) | `backend-drift-scanner` (F/backend-drift-scanner/index.ts:269) with the read-only Supabase MCP client; `getSupabaseAdvisors` | Never scanned in prod: 0 snapshots, 0 `supabase_project_ref`; it also skips silently | **Build** detectors on 019's Supabase connector (§4). Advisors are integrated, not re-implemented |
| Updates | Release (→ 019 deploy truth) | `sdk-upgrade-worker` (F/sdk-upgrade-worker/index.ts:38), `sdk-versions-cron`, `sdk-release-sync` (deploy status F/sdk-release-sync/index.ts:89-134) | All 50 upgrade jobs show `deploy_status = unknown`; only Mushi's own SDK is bumped | **Build** a portfolio "upgrade once" batch on 019 Phase 3. **Integrate** Renovate / Dependabot PR state for other dependencies |
| Sign-ups and auth | Identity (§7) | Cross-app reporter identity `mushi_get_my_cross_app_reports` (M/20260619131625_cross_app_app_domain.sql:6); `GET /v1/tester/cross-app-reports` (F/api/routes/community.ts:96). `end_users` are per project | No view of each app's auth setup or sign-up rate | **Partner** for identity (Supabase OAuth server, Clerk). **Build** the sign-up funnel per app (analytics row) and divergence checks (→ 019 §3b shared-auth rule) |
| Credits between apps: spend | Spend (§6) | Autofix caps (M/20260615045657_console_dx_enhancement.sql:13-15) enforced in F/_shared/autofix-budget.ts:17; `monthly_llm_budget_usd` (M/20260521211000_org_budget_column.sql:9) | Caps NULL on every dogfood project; the LLM budget is **stored but never enforced** (only read in F/api/routes/costs.ts:602) | **Build.** Mushi's own spend first, then each app's keys |
| Credits between apps: customer credits | Identity and credits (§7) | Rewards / reputation (F/api/routes/rewards.ts:446-740), points per end user per project | No shared wallet; not a billing system | **Partner**: RevenueCat for mobile, Stripe or Polar for web. **Build** only the consistency checks (→ 019 §3b billing rule) |
| GTM, marketing, links | GTM (§8) | `product_events` (M/20260921000001_product_events.sql:13), `POST /v1/sdk/events` (F/api/routes/events.ts:308), funnel / paths / retention (F/api/routes/events-admin.ts:195-291) | Per project; no cross-app funnel; no cross-promo registry | **Build** the cross-app funnel rollup and cross-promo checks. **Integrate** PostHog (019 kind). **Partner** Dub / Branch for links. Deep-link probes → 019 §3b |
| Linking notifications | Notifications (§9) | Slack (F/_shared/slack.ts:597), Discord / Teams (F/_shared/team-notify.ts:102), plugin fan-out (F/_shared/plugins.ts:200), web push, Telegram | Operator alerts are per project and per event | **Build** one operator digest across the portfolio. **Partner** for end-user push (Expo, OneSignal, Novu) |
| Triage via Cursor / Claude Code | Core (unchanged) | fast-filter (F/fast-filter/index.ts:135) → classify-report (F/classify-report/index.ts:149) → fix-worker (F/fix-worker/index.ts:180) → `createPrFromFiles` (F/_shared/github-pr.ts:258); MCP catalog | Every MCP tool except two takes one `projectId` | **Build** portfolio MCP tools (`get_portfolio` is 019 P1; 020 adds `get_radar`, `get_store_status`, `get_repo_digest`) |
| Release | Release + store ops (§5) | `release-builder`, `releases`, `sdk-release-sync` | No store state; no batched release view | **Build** the release calendar and store state (read). Submission stays in the host's CI |
| Guards, gates, CI/CD | Gates (→ 019 §1.4–1.5) | `gate_runs` / `gate_findings` (M/20260504000000_v2_bidirectional_graph.sql:100, :145), `metric_series` (M/20260520230000_metric_series_anomalies.sql:2), `POST /v1/ingest/metrics` (F/api/routes/public.ts:1711) | Gates are per repo; no shared pack | **Build** a portfolio gate pack: one step in each repo's existing job (ci-cost rule 3) that pushes into ingest |
| Analytics and pipeline | GTM (§8) | As above | — | **Build** narrowly (sign-up → activation per app). Do not build a general analytics product |
| Integratable, pluggable | Connectors (→ 019 §2b) | `CloudAgentAdapter` pattern; `@mushi-mushi/adapters`; 13 plugin packages | — | → 019. 020 proposes three new connector kinds (§4.4) |
| Old systems | Legacy (→ 019 push adapters) | `POST /v1/ingest/spans`; plugin-sdk signing | — | → 019 |
| Holes and tech debt | Radar (§4) | `gate_findings`, `code-health` (F/api/routes/code-health.ts:185), `inventory-gates` | The detectors that would have caught today's findings either don't exist or fail open | **Build.** This is the differentiated module |
| Repo understanding | Atlas (§10) | `/explore` (A/App.tsx:435, A/pages/ExplorePage.tsx), codebase-understand routes, MCP `ask_codebase` … `analyze_codebase_impact` (catalog.ts:1123-1168) | Index capped at 300 files; graph table empty; push indexing never fires | **Build** a digest and diagram that read GitHub directly at a pinned SHA, then fix index coverage |
| Store listings, reviews, compliance | Store ops (§5) | Nothing (no store API code in the repo) | Everything | **Build** on 019's `app_store_connect` / `play_console` connectors, read-only first |
| Domains, TLS, accounts | Resilience (§4, §11) | Nothing | Everything | **Build** cheap public probes and a register |

---

## 4. The tech-debt radar

The radar is a set of **detectors**. Each one is a pure rule over Plan 019 snapshots, public probes or Mushi's own tables. Each writes a `gate_findings` row (or a `portfolio_findings` row if it is genuinely cross-project) with a `rule_id`, a severity, a plain-English reason and a fix path: a draft PR, a prompt for the editor, or a command.

Every detector follows 019's five states. A detector that has never run renders **`unknown`, never green**. A detector whose source failed renders `error`.

### 4.1 Prerequisites: Mushi's own fail-open detectors

A radar that reports other apps' holes while its own probes fail open is the silent fail-open pattern again (shipped four times in this repo). These come first, in Phase 0:

| # | Mushi's own gap | Evidence | Fix |
|---|---|---|---|
| P-1 | The health probe never reads `byok_keys`; LLM keys are probed from env only, on one anchor project | F/integration-health-probe/index.ts:236-245 (`Deno.env.get('ANTHROPIC_API_KEY')`); `byok_keys` appears 0 times in the file | Probe every active `byok_keys` row with a cheap call; a 401 writes `byok_key_invalid` and a health row with `status='error'` |
| P-2 | `monthly_llm_budget_usd` is stored but never enforced | M/20260521211000_org_budget_column.sql:9; only read in F/api/routes/costs.ts:602 | Enforce in the LLM call path next to `autofix-budget.ts`, or relabel the setting as "alert only" |
| P-3 | `contract-graph-builder` references a nonexistent `projects.settings`, `inventory_nodes` and `execute_sql`, swallows its errors, and inspects Mushi's own DB; `drift-walker` depends on it | F/contract-graph-builder/index.ts:31-37, :62, :69, :86 | Fix or retire both; a retired detector is removed from the UI, not left green |
| P-4 | `backend-drift-scanner` skips silently when unconfigured and has never produced a snapshot | F/backend-drift-scanner/index.ts:77-79 | → 019 Phase 2 (Supabase connector); until then the schema element renders `not_connected` |
| P-5 | Push indexing requires an App installation ID, which no project has, and has no branch filter; the indexer falls back to `main` | F/webhooks-github-indexer/index.ts:893, :1368-1430 | §10.3 |
| P-6 | Autofix caps are NULL on all dogfood projects | `project_settings.autofix_max_spend_usd` | Default a cap at project creation; render "no cap" as a finding |

### 4.2 Detector catalog — today's findings as the canonical examples

| Today's finding | `rule_id` | Source (019 connector or probe) | What it checks | Fix path | Phase |
|---|---|---|---|---|---|
| #1 Orphaned storage | `storage_orphaned_bytes` | Supabase connector (read-only SQL + usage) | Billed storage size vs `sum(storage.objects.metadata->>'size')` per bucket; a gap above 10% or 10 GB is a finding | Prompt: list orphaned paths via the Storage API and delete through the API; never SQL | 2 |
| #1 (the cause) | `storage_sql_delete` | GitHub connector (files at pinned SHA) or the host CI step | `delete from storage.objects` in migrations, functions or scripts | Draft PR replacing it with a Storage API call | 1 (host CI scan) |
| #2 Secret RPC callable by anon | `rpc_secret_reachable_by_anon` | Supabase connector (`pg_proc`, `has_function_privilege`) | A `SECURITY DEFINER` function that reads Vault or a secrets table and is executable by `anon` or `public` | Migration *file* (`revoke execute … from anon, public`) as a draft PR (019 opt-in) or a prompt | 2 |
| #2 (portfolio) | `function_grant_divergence` | Supabase connector across projects | The same function name with different grants in two projects of one organization | One "fix once" group | P2 |
| #3 Unauthenticated paid functions | `edge_fn_unauthenticated_paid` | Supabase connector (functions list, `verify_jwt`) + GitHub (function source) | `verify_jwt = false` and the source reads a paid-provider key, with no auth check found | Prompt or PR adding the auth guard; or undeploy | 2 |
| #3 (dead app) | `dead_app_live_spend` | Mushi SDK heartbeats + Supabase connector + spend | No SDK heartbeat, report or page view for 30 days while functions, crons or keys stay live | Checklist: pause project, undeploy functions, revoke keys | 2 |
| #4 Revoked key | `byok_key_invalid` / `provider_key_invalid` | Mushi (P-1); the app's own keys through a probe the operator opts into | A 401 or 403 from the provider on a cheap call | Rotate prompt; link to the provider console | 0 (Mushi), 2 (apps) |
| #5 SDK skew | → 019 §3b SDK skew | — | — | 019's "upgrade once" | 019 P1 |
| #6 CI spend concentration | → 019 §3b CI cost per repo; 020 adds `ci_cost_concentration` | GitHub connector (runs, durations) | Top 2 repos > 60% of estimated minutes; workflows without `concurrency`, `timeout-minutes` or path filters | Draft PR per workflow (019 `.github/**` opt-in) or a prompt | P2 |
| #7 Store names differ | `store_name_mismatch` | Public lookup (iTunes Search API; Play listing page) — no credentials | Display names, developer names and icons differ between stores for one bundle pair | Listing-as-code PR (§5.2) | 1 |
| #8 Webhook never worked | `webhook_never_delivered` | Mushi tables: `integration_health_history` + inbound delivery counts | An inbound integration configured more than 7 days ago with 0 accepted deliveries, or only signature failures | "Send test event" + the exact setup step that is missing | 1 |
| #9 Wrong default branch | `index_branch_mismatch`, `index_stale` | GitHub connector + `project_codebase_files` | Indexed branch ≠ the repo's `default_branch`, or the newest indexed commit is older than 14 days while the repo moved | Re-index; fix-worker refuses to edit a file it has not read at the pinned SHA | 0 |
| #10 Caps unset | `spend_cap_unset` | Mushi `project_settings` | NULL autofix cap or LLM budget | One-click set to a suggested default | 0 |
| #11 Claims vs code | `listing_claim_contradicts_code`, `privacy_label_mismatch` | §5.3 | — | §5.3 | 2 |
| #12 Wrong-platform screenshots | `screenshot_platform_mismatch`, `screenshot_stale` | §5.4 | — | §5.4 | 2 |
| #13 Missing locale | `listing_locale_missing` | Public listing + app locale files | A locale the app ships (or the operator's own) with no listing | Listing-as-code PR with a draft translation | 1 |
| #14 Service account scope | `store_credential_scope_missing` | 019 `probe()` on the Play connector | The granted permission set lacks what an enabled capability needs | Name the missing permission and where to grant it | 2 |
| #15 Review rejection from code | `review_risk_*` | §5.5 | — | §5.5 | 2 |

Detectors for the missing needs (§2.3):

| Need | `rule_id` | Source | Phase |
|---|---|---|---|
| Domain expiry | `domain_expiring` | Public RDAP lookup for each domain in `portfolio_resources` | 1 |
| TLS expiry and security headers | `tls_expiring`, `security_headers_missing` | Public probe through 019 `safe-fetch` | 1 |
| Key exposure and unused keys | `key_unused_90d`, `key_in_client_bundle` | Spend data; host CI scan of built bundles for key patterns | 2 |
| Backups | `pitr_disabled`, `storage_not_backed_up` | Supabase connector | 2 |
| Account deletion path | `account_deletion_missing` | Inventory routes + store listing (deletion URL) | 2 |
| Store policy deadlines | `play_target_sdk_behind`, `ios_sdk_behind` | GitHub connector (`build.gradle`, `app.json`, `eas.json`) vs a dated policy table Mushi maintains | 1 |
| Kill switch | `paid_feature_no_kill_switch` | GitHub connector + recipe manifest | 2 |

### 4.3 How the radar presents

- **Per app**: findings appear on the Recipe page (019 §3) and as context in `get_fix_context`, capped like the 019 `recipe` block.
- **Per portfolio**: grouped on `/portfolio` by `rule_id` (019's "fix once" list), with an estimated monthly cost where one exists (storage bytes × list price, idle function invocations × provider price).
- **In the editor**: MCP `get_radar({ scope: 'project' | 'organization', severity? })` returns findings with fix prompts; `explain_finding(id)` returns the plain-English diagnosis. Both are wrapped as untrusted output.
- **Never green by default**: the radar header counts `unknown` detectors as "not checked yet", with the step that turns each one on.

### 4.4 New connector kinds proposed to Plan 019's registry

Plan 019's `ConnectorKind` union already includes `app_store_connect` and `play_console`. 020 proposes three more, each read-only and each needing the owner's agreement before it is added to the union:

| Kind | Why | Credential |
|---|---|---|
| `public_probe` | RDAP, TLS, iTunes Search API, public Play listing, `.well-known` files. No credentials at all, so it can run in Phase 1 for every project | None; through `safe-fetch` |
| `llm_usage` | Per-key spend from the OpenAI Usage API and the Anthropic Usage & Cost Admin API (org accounts only) | Admin or usage-read key in Vault |
| `revenuecat` | Entitlement and offering consistency across apps (§7) | Read-only REST v2 key |

### 4.5 Legacy, MCP and auth

- **Legacy systems** use 019's push adapters. A VPS cron or a Jenkins job posts findings to `/v1/ingest/recipe` in the same shape, so a legacy server gets the radar without Mushi holding its credentials.
- **MCP is the agent surface.** Every radar, store and digest capability ships first as an MCP tool, because the operator works in Cursor or Claude Code. The console is the review and approval surface.
- **Least privilege** follows 019 §2b: read and write refs are separate; `probe()` records granted scopes; `act` needs an approved `connector_actions` row whose payload hash matches. Plan 020 adds no new credential path.

---

## 5. Store ops

The owner wants store operations "doable from Mushi in the future". Today's store audit (findings #7, #11–15) is the case study.

### 5.1 Constraints that shape the design

- **Plan 019 Decision 8:** no App Store Connect, Play or EAS credentials in v1. The ASC row in 019's catalog lists propose and act as "None". Store ops therefore starts with **public data and repo files**, adds read credentials in 019 Phase 2, and writes only through the host's own CI.
- **Google Play API ToS** bar using the Publishing API to publish "on behalf of a third party through a developer tool or service" ([terms](https://developers.google.com/android-publisher/terms)). CI tools stay compliant because the operator's own service account, triggered by the operator, does the publishing.
- **Apple team API keys cannot be scoped to one app.** One leaked key exposes every app on the team. Review replies reportedly need an Admin-role key.
- **Apple's DPLA** limits who may act as an Authorized Developer; a SaaS vendor holding a key is a grey area.
- **Rate limits:** Play 3,000 queries/min per bucket, and review replies are 2,000/day, 350 characters, last 7 days only. ASC is about 3,600 requests/hour per key (community-reported).

**Owner decision S-1 (proposed):** listings live as code in the host repo. Mushi proposes changes as draft PRs to those files, and the host's **existing** CI step pushes them with the operator's own key (fastlane `deliver` / `supply`, or EAS Submit metadata). Mushi holds at most a **read-only** key per store. Direct API writes come later, as 019 `act` capabilities, one per action, each approved.

### 5.2 Listing as code (repo ↔ ASC / Play)

- **Format:** fastlane's `metadata/` layout (`fastlane/metadata/<locale>/name.txt`, `subtitle.txt`, `description.txt`, `keywords.txt`, `release_notes.txt`; `fastlane/metadata/android/<locale>/…`). It is the de facto standard and works with EAS too. `mushi.recipe.json` gains a `store` block that points at it (a pointer, per 019 Decision 1):

  ```json
  { "store": { "listingDir": "fastlane/metadata", "ios": { "bundleId": "…", "appleId": "…" },
               "android": { "package": "…" }, "locales": ["en-US", "ja"], "brandName": "…" } }
  ```

- **Sync direction.** Repo → store is the source of truth. Store → repo is a one-time import (`mushi store pull`, run locally with the operator's key, so Mushi never holds a write credential) and a read-only drift check afterwards: `listing_drift` when the live listing differs from the repo.
- **Change path.** Edits arrive as draft PRs to `listingDir` (019 Phase 3 allowlist), and the operator's CI publishes after merge.

### 5.3 Claims vs code (the differentiated detector)

No tool found checks that what a store listing *says* matches what the app *does*. Finding #11 shows why it matters: a false claim is a review risk, a consumer-law risk and a trust risk.

1. **Extract claims.** An LLM pass over the listing text, the privacy policy and the declared privacy labels returns structured claims: `{ claim, kind: data_collection | data_sharing | on_device | open_source | content_count | feature | absolute ("never", "always", "no") , quote }`.
2. **Gather evidence.** For each claim, look in the code index and the repo at a pinned SHA:
   - network calls and upload code paths (for "photos never leave your phone");
   - the repository's licence and visibility (for "open source");
   - content counts from the app's own data files or the database (for "162 lessons");
   - feature flags and assets (for "native speaker audio");
   - SDKs that collect data, compared with the privacy labels and the Data safety form.
3. **Verdict per claim:** `supported`, `contradicted` (with file:line evidence), or `unverifiable`. An unverifiable absolute claim ("never") is itself a finding: absolutes are the riskiest copy.
4. **Output:** `listing_claim_contradicts_code` or `privacy_label_mismatch`, with the suggested listing edit as a draft PR, or the code change if the claim is the intent.

Guardrails: listing text and policies are untrusted input (wrapped before prompts); the verdict cites evidence or says `unverifiable`; it is never a legal opinion, and the console says so.

### 5.4 Screenshot freshness

- `screenshot_platform_mismatch`: image dimensions and device-frame heuristics (status bar shape, navigation bar, aspect ratio) against the store's device class. iOS screenshots taken on an Android emulator are flagged.
- `screenshot_stale`: the screenshots predate the last N releases, or the routes they show no longer exist in the inventory.
- Fix path: a prompt, or a QA story that captures fresh screenshots (`qa-story-runner` evidence already stores screenshots), proposed into `listingDir` as a draft PR.

### 5.5 Review-risk prediction

- A dated **policy table** Mushi maintains (App Store Review Guidelines sections, Play policies, SDK and target-API deadlines), each row with an effective date and a source URL. It is checked monthly, and every row shows when it was last verified.
- Checks are mapped from finding #15, plus the common rejection reasons:
  - `review_risk_ai_disclosure`: the app sends user data to an AI provider, but no in-app disclosure or consent screen is found;
  - `review_risk_privacy_url`: the declared privacy URL does not return 200 with a rendered policy (a public probe);
  - `review_risk_purchase_steering`: code paths link to external purchase or "bring your own key" flows that Apple 3.1.1 may treat as steering;
  - `review_risk_default_persona`: hard-coded demo identities or personas shipped in production builds;
  - `account_deletion_missing`, `play_target_sdk_behind`, `ios_sdk_behind` (§4.2).
- Output is a **pre-submission checklist** per release with a risk level. It is advisory; Mushi never claims to predict Apple.

### 5.6 Locale coverage and name parity

- `listing_locale_missing`: locales the app ships, or the declared `locales`, with no listing.
- `store_name_mismatch` (Phase 1, public data): App Store vs Play display name, developer name and icon hash for each declared bundle pair. The canonical name is the manifest's `brandName`; the owner's rule (2026-10-02) is that the Google Play title is canonical everywhere. The check knows the iOS limits: name and subtitle are 30 characters each, and a name change needs a new version in review, so the fix is folded into the next store batch.

### 5.7 Batched release orchestration that respects CI cost

- A **release calendar** across the portfolio: for each app, what is merged but not yet built, built but not submitted, in review, live and at what rollout %, plus OTA updates. Read from 019 deploy truth plus the store connectors (read).
- **Batches, not drips.** Mushi suggests one release batch per window (the owner's ci-cost rule 7): fixes merged across apps are grouped, JS-only fixes go out as OTA (EAS Update / Capgo), and native changes wait for a store batch. It shows the estimated CI minutes of releasing now vs at the next batch.
- Submission runs in the **host's CI**; Mushi only proposes the batch (a PR that bumps versions and release notes in `listingDir`). Promoting a Play track or changing the rollout % are later 019 `act` capabilities, each approved.

---

## 6. Spend: the credits each app burns

Plan 020 leads with this reading of "managing the credits used between each", because today's evidence is here (findings #1, #3, #4, #6, #10).

- **Per-app spend ledger.** Sources:
  - Mushi's own LLM cost per project (already logged per call);
  - `llm_usage` connector for the operator's own OpenAI / Anthropic keys, attributed to apps by key;
  - Supabase usage per project (storage, egress, function invocations);
  - GitHub CI minutes estimated per repo (019);
  - Vercel / AWS bills through an ingest of the provider's CSV or a Vantage export (partner) — no AWS credentials in Mushi.
- **Caps.** Mushi's own caps get enforced first (P-2, P-6). For the operator's keys, Mushi cannot enforce a cap; it alerts at thresholds and links to each provider's own limit setting. The finding is `provider_limit_unset` where the provider supports one.
- **Attribution rule.** One key per app per provider is the recommended pattern; `key_shared_across_apps` is an `info` finding, because a shared key makes spend unattributable and one leak hits every app.

---

## 7. Cross-app identity and customer credits (partner-first)

- **Identity.** Mushi is not an identity provider. Recommended patterns, documented with their trade-offs:
  - Supabase: one auth project acting as an OAuth 2.1 / OIDC provider for the others (Beta at the time of writing; no extra cost beyond MAU);
  - Clerk: one application plus satellite domains ($10/mo each), with sign-in on the primary domain;
  - Auth0: one tenant shared by every app (Free tier).

  Mushi builds the **checks** (→ 019 §3b shared-auth divergence: redirect URLs, providers enabled, email templates, MFA settings) and the **sign-up funnel per app** (§8).
- **Customer credits.** RevenueCat shares entitlements only inside one project, so a "portfolio pass" means putting the apps in one RevenueCat project. Stripe credit grants are monetary, metered-only and capped at 100 unused per customer, so they cannot act as cross-app tokens; Polar's Benefits and credits feed meters on the web. Mushi checks consistency (→ 019 §3b billing rule; `revenuecat` connector) and does not hold balances.
- **Mushi's own seed.** The cross-app reporter identity (`mushi_testers.auth_user_id`, the cross-app reports RPC) is the one place Mushi already spans apps for an end user. It stays scoped to reporting and rewards; it is not grown into a general account system.

---

## 8. GTM, analytics and cross-promotion

- **Cross-app funnel rollup.** Org-level view over `product_events`: for each app, sign-ups → first meaningful action → day-7 return, side by side. Same definitions per app (one `funnel_definitions` row per org, applied per project). Sources: Mushi's events, or PostHog through the 019 connector for apps already on PostHog.
- **Cross-promotion registry.** The recipe's `links` block (019) lists sibling apps. 020 adds checks:
  - every "more apps" link resolves to a live listing;
  - UTM / campaign parameters exist on each link;
  - deep links into sibling apps pass 019's `.well-known` probes.

  Link creation and attribution stay with Dub or Branch (partner).
- **Operator GTM digest.** A weekly per-app line: sign-ups, activation, store rating change, new reviews turned into reports, open radar findings. It is the portfolio version of the existing `gtm-weekly` review.
- Not built: ad attribution (AppsFlyer / Adjust), a marketing CMS, email campaigns beyond the existing lifecycle emails.

## 9. Notifications

- **For the operator (build):** one daily digest across the portfolio, on the channels Mushi already has (Slack, Discord, Teams, Telegram, web push, email). It contains new reports, radar findings by severity, releases in flight and spend anomalies. Each app's alerts carry the app's name, so a shared channel stays readable (019's shared-channel rule).
- **For end users (partner):** Expo Push, OneSignal, Novu or Courier. Mushi checks setup only: push key or certificate expiry where a connector exposes it; one push key shared across apps (019 rule).

## 10. Repo understanding: digest and diagram

### 10.1 Landscape

| Tool | Produces | Notable mechanics | Growth loop |
|---|---|---|---|
| Gitingest (15.8k★) | Text digest with an estimated token count | Include/exclude globs, `.gitignore`, 10 MB/file and 10k-file caps; PAT used once, not stored | Swap "hub" for "ingest" in a GitHub URL |
| GitDiagram (17.7k★) | Clickable architecture diagram, video, `.md` page | One LLM call returns a graph AST; the server **validates every path against the real tree**, then compiles Mermaid deterministically; cached in R2; free remote MCP | hub→diagram URL swap; Show HN 222 pts |
| DeepWiki (Cognition) | Wiki, diagrams, Q&A | `.devin/wiki.json` steering file; free no-auth MCP; private repos via paid Devin | URL swap; 50k pre-indexed repos; a badge in ~12.6k READMEs. Known risk: hallucinated pages with no takedown path |
| Repomix (28.6k★) | One packed file | Per-file and total token counts, `--token-budget`, Secretlint, ~70% compression; local MCP | Web UI, extension |
| Google Code Wiki (preview) | Auto wiki + diagrams | Regenerated after each change | Public pages |
| Sourcegraph, Swimm | Enterprise search and docs | — | Sales-led; CodeSee was acquired by GitKraken in 2024 |

None of them connects understanding to live bugs, diagnoses or fix PRs, or to a portfolio of repos. That is Mushi's angle.

### 10.2 What Mushi has today

- `/explore` (A/App.tsx:435, A/pages/ExplorePage.tsx) with overview, ask, tour, domains, knowledge, graph, layers, search and index tabs.
- Routes in F/api/routes/codebase-understand.ts: chat (:176), chat stream (:356), summary (:683, :689), tour (:702), domains (:809). Search in F/api/routes/project-codebase.ts:830.
- `codebase-analyze-worker` (F/codebase-analyze-worker/index.ts:29); tables `project_codebase_files` (M/20260416300000_phase2_knowledge_graph.sql:125), `project_codebase_graph` and analyze jobs (M/20260616024828_codebase_graph.sql:3, :27).
- MCP: `ask_codebase` (catalog.ts:1123), `get_file_summary` (:1132), `get_codebase_tour` (:1141), `search_codebase` (:1150), `get_codebase_domains` (:1159), `analyze_codebase_impact` (:1168), `get_blast_radius` (:140). On the hosted server the codebase tools load only with `features=all` (F/mcp/feature-groups.ts:25).
- Nothing like a digest (Repomix / Gitingest) or a graph → Mermaid export exists. The closest pieces are the per-file summary (codebase-understand.ts:594), the tour and the domains.
- `get_blast_radius` walks `graph_nodes`, not files. The only report → files path is `analyze_codebase_impact` (F/_shared/codebase-impact-resolve.ts:55).

**Blockers, stated honestly:**

1. The indexer caps a sweep at **300 files** (F/webhooks-github-indexer/index.ts:1113, `MUSHI_REPO_INDEX_SWEEP_FILE_CAP`). glot.it is indexed 300 of 4,714 files. Files are picked by `_shared/sweep-file-priority.ts`. A partial run still sets `last_indexed_at`, so at a 24-hour staleness window and 5 repos per hour, a big repo gains about 300 files a day.
2. Mushi's own index was frozen since June by a wrong default branch. The fix is in the current batch (`_shared/github-branch.ts`) and is not on master yet. The indexer still falls back to `main` (:893; `project_repos.default_branch` defaults to `'main'`, M/20260418001900:27).
3. Push indexing takes any branch's `payload.after` with no branch filter (:1382), so a feature-branch push overwrites the single index.
4. Indexing needs a PAT or a GitHub App installation. **No App installations exist**, and the push path requires one (:1392-1399), so push-triggered indexing never fires for PAT-only projects, which is every project today.
5. The sweep embeds chunks **before** hashing them (:1194 vs :1212), so unchanged content is never skipped and every sweep pays for embeddings again.
6. The import-edge regex runs over a 600-character preview, and chunks start at the first symbol, so imports in files that contain symbols are lost. The graph under-reports edges.
7. `_shared/codebase-graph-build.ts` is a hand copy of `packages/codebase-graph/src/build-from-index.ts`, which risks drift.
8. `project_codebase_graph` has 0 rows in production, and the file index holds code symbols only (no config, workflows or CSS).

### 10.3 Proposal

1. **`get_repo_digest` (MCP) and "Copy digest" (console).** It does not depend on the index. It reads the GitHub tree and contents at a pinned SHA through the existing token resolution, the same way `sdk-upgrade-worker` does.
   - Scope: a path, the files a report touches (resolved through `analyze_codebase_impact` / `codebase-impact-resolve.ts`, because `get_blast_radius` returns graph nodes, not files), or the whole repo.
   - Available on the hosted MCP's default feature set, not only behind `features=all`, so a new user sees it without configuration.
   - **Token budgeting**: per-file and total token counts are shown; a `budget` parameter drops the lowest-priority files first (generated files, lockfiles, assets, then by distance from the scope), and the digest lists what it dropped.
   - Secret scan (019's `_shared/secret-scan.ts`) runs before anything is returned; matching files are replaced with a notice.
   - Output wrapped as untrusted; cached per (repo, SHA, scope, budget).
2. **AI architecture diagram with clickable nodes.**
   - GitDiagram's pattern: the LLM returns a graph AST (nodes, edges, `path`), the server **rejects any node whose path is not in the tree**, and a deterministic compiler emits Mermaid or React Flow. Clicking a node opens the file, its findings and its open reports.
   - Regenerated on push when push indexing works, otherwise daily at most and on demand; stored per SHA.
   - Overlay: reports and radar findings per node, which none of the competitors can show.
3. **Optional public page per repo (growth loop).**
   - Opt-in per repo. Default: public repos only. A private repo's page exists only after an explicit consent step that previews exactly what will be public: diagram nodes and paths, no file contents.
   - A URL pattern (`kensaur.us/mushi-mushi/r/<owner>/<repo>`), a `.md` twin for agents and answer engines, and a README badge.
   - Known risk: a wrong diagram on a public page. Mitigations: path validation, a "generated from `<sha>`" label, an owner "regenerate" and "unpublish" button, and a report-this-diagram link.
4. **Index coverage fixes, as a parallel track (not a prerequisite):**
   - cap strategy: raise the cap per plan tier, and index by priority (stack-frame files, recently changed files, entry points) until the budget is spent, recording coverage (`indexed / eligible`) so the console can show "300 of 4,714 files";
   - correct coverage state: a partial sweep records `indexed / eligible` and does not mark the repo fresh;
   - incremental indexing: on push, re-index only changed paths, and only for the default branch (blocker 3). This needs the App, or a repo webhook on the PAT path. Otherwise a daily diff against the last indexed SHA;
   - cost: hash before embedding, so unchanged chunks are skipped (blocker 5); a monthly embedding budget per project, enforced like P-2;
   - graph accuracy: extract imports from the full file, not the 600-character preview (blocker 6); make the edge build use `packages/codebase-graph` directly instead of the hand copy (blocker 7);
   - the `index_branch_mismatch` / `index_stale` detectors (§4.2), plus a fix-worker guard: no edit to a file it has not read at the pinned SHA.

---

## 11. Accounts and resilience register

A small, owner-facing register on `/portfolio`:

- each account the portfolio depends on (Apple, Google Play, AWS, Supabase organizations, Vercel, domain registrar, Stripe), its owner email, whether 2FA is declared on, and a recovery contact;
- **names and metadata only, never secrets**;
- an **export pack** (a Markdown file) the owner can store offline or hand to a trusted person;
- detectors: `account_single_owner` (one human, no recovery contact), `registrar_autorenew_off` (declared), `domain_expiring`.

This is low frequency and high pain (§2.3, the business-ending callout). It is cheap, because it is a form and a few rules.

---

## 12. Phasing

Plan 019's sequencing gate (ADR 0016) applies to every gated 020 phase: gated phases start when at least 3 external projects are activated or the owner sets a review date. Today's north-star count is **0 activated external projects**.

| Phase | Gate | Delivers | Depends on |
|---|---|---|---|
| **0 — One app activated** | Outside | Mushi's own fail-open fixes (P-1 … P-6); `get_repo_digest` + "Copy digest"; the diagram v0 (private, console only); detectors that need only Mushi's tables: `spend_cap_unset`, `webhook_never_delivered`, `index_branch_mismatch`, `index_stale` | Nothing new; 019 Phase 1 helps |
| **1 — Portfolio rollups** | Outside (no new credentials) | On 019 P1: radar and spend columns on `/portfolio` cards; the `public_probe` detectors (`store_name_mismatch`, `listing_locale_missing`, `domain_expiring`, `tls_expiring`, `security_headers_missing`, `review_risk_privacy_url`); host-CI scan rules (`storage_sql_delete`, `play_target_sdk_behind`, `ios_sdk_behind`); the operator digest; the public diagram page (opt-in, public repos) | 019 P1 |
| **2 — Credentialed detectors and store ops (read)** | Gated | On 019 Phase 2 connectors: Supabase security and storage detectors; spend ledger with `llm_usage`; listing as code (`store` manifest block, `mushi store pull`, `listing_drift`); claims vs code; screenshots; review-risk checklist; release calendar (read) | 019 Phase 2 |
| **3 — Cross-app identity, credits, links, notifications** | Gated | Cross-app funnel rollup; cross-promo checks; `revenuecat` connector; identity setup guides; the shared-auth and billing rules land via 019 P2 | 019 P2 |
| **4 — Act** | Gated + separate owner decision | Listing PRs published by host CI; batched release proposals; the first store `act` capabilities (promote a track, change rollout %), each through `connector_actions` approval | 019 Phase 3 + the first `act` decision |

**Why digest and diagram come first.** They need no SDK install, no new credentials and no migration. They are useful on day one to anyone who connects a GitHub repo, so they help activation. And the opt-in public page is a growth loop that Gitingest, GitDiagram and DeepWiki have shown works.

### 12.1 Phase 0 checklist

Checked against the code on 2026-10-03.

- [x] P-1: probe `byok_keys` in `integration-health-probe`; a revoked key writes an `error` health row and `byok_key_invalid`; Deno test with a 401 fixture (`integration-health-probe/byok-health.test.ts`).
- [x] P-2: enforce `monthly_llm_budget_usd` in the shared LLM path (`_shared/llm-budget.ts`, called from `llm-failover.ts` and `byok.ts`); `llm-budget-enforcement.test.ts`.
- [x] P-3: `contract-graph-builder` rebuilt over `_shared/contract-snapshot.ts` (an unset source reads `not_configured`); it and `drift-walker` check every read and write and answer 500 / 502 with the failed step.
- [x] P-6: default autofix caps for new projects (`20261002140200`); `spend_cap_unset` for existing projects flags a missing auto-fix cap (auto-fix on or off) or a missing monthly AI budget, with "Apply suggested caps" on the finding (2026-10-03).
- [x] `index_branch_mismatch` / `index_stale` detectors (`_shared/radar.ts`) and the fix-worker read-before-write guard (`_shared/fix-file-guard.ts`).
- [x] `webhook_never_delivered` over `integration_health_history` and inbound delivery counts.
- [x] `_shared/repo-digest.ts`; MCP `get_repo_digest`; console "Copy digest" on `/explore` and on report detail (`CopyRepoDigestButton` with the report id).
- [x] Diagram v0 (`_shared/repo-diagram.ts`, `ExploreDiagramPanel` on `/explore`).
- [ ] Catalog, manifest and docs synced: `sync-mcp-discovery-card --check` needs a regeneration after the 2026-10-03 gate-findings changes, and `check:admin-docs-coverage` warns about `/recipe`, `/design`, `/analytics`, `/growth` and `/email/reporter` pages.

### 12.2 Release batching

Each phase ships as one release batch (ci-cost rule 7), folded into the same batch as the matching Plan 019 phase where one exists.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| **Focus.** "Operating layer for everything" turns Mushi into a Port-style portal and pulls it off the wedge, as ADR 0004 records happening once already | Every detector names the bug it prevents. The diagnosis stays the hero. Portfolio pages stay Bucket B / C. Partner wherever a mature product exists (§3 decisions). Gated phases wait on activation |
| **Security of acting across many accounts.** One layer holding credentials for every app is one blast radius (Lovable's April 2026 platform-level isolation failure is the cautionary case) | Read-only by default; separate read and write refs; `probe()` shows real token power; no `act` without a hash-matched approval; public probes wherever possible; the account-key organization intersection (019 §3b); never store secrets in the register |
| **Unscopable vendor tokens** (Apple team keys, Supabase PATs, Vercel tokens) | Read endpoints only; the Supabase MCP in `read_only` mode; listing writes go through the host CI's own key (S-1); the console states each token's real power before connect |
| **Store ToS** (Play's third-party publishing clause, Apple DPLA, rate limits) | S-1: the operator's own key publishes, from the operator's CI. Mushi reads, proposes PRs and, later, runs approved single actions. Reply volume respects Play's quota |
| **False positives in claims vs code** | Evidence or `unverifiable`, never a bare verdict; dismissals are recorded and tracked as a metric; not legal advice, and the console says so |
| **Public diagram pages wrong or leaking** | Opt-in; public repos by default; consent preview for private repos; path validation; SHA label; unpublish |
| **Cost** (LLM for claims and diagrams; embeddings; probes) | Cache per SHA; budgets per project, enforced (P-2); daily cadence at most; public probes are cheap; diagram and claims runs are on demand or per release, not per push |
| **Policy table rot** (store rules change) | Each row has a source URL and a last-verified date; rows older than 90 days render `unknown` |
| **Connector maintenance on a solo founder** | 019's contract tests; add connectors only when a pilot needs one; legacy push adapters for the long tail |
| **Silent fail-open** (5th time) | P-1 … P-6 first; every detector has a never-run `unknown` state and a test for it |

## 14. Success metrics

| Metric | Target | Source |
|---|---|---|
| **North star: activated external projects per week** (unchanged) | Phases 0–1 must not lower it; Phase 0 digest and diagram should raise sign-up → activation | `product_events` funnel |
| Portfolio coverage: share of an operator's projects with no `unknown` detectors | 80% for the owner's 7-project organization by end of Phase 2 | Radar state |
| Holes closed: radar findings fixed within 14 days (by PR, prompt or setting) | ≥ 50% of `high` findings | `gate_findings` + PR state |
| Precision: findings dismissed as wrong | < 20% per detector; a detector above 40% for a month is turned off and reworked | Dismissal events |
| Money found: estimated monthly waste surfaced (orphaned storage, idle functions, unused keys) | Reported per operator; the owner's own baseline is finding #1 | Spend ledger |
| Store: contradicted claims on live listings | 0 for the owner's 5 apps after Phase 2 | Claims vs code |
| Repo understanding: digests and diagrams generated; public pages published; sign-ups attributed to a public page | Tracked from Phase 1; no target until a baseline exists | `product_events` |

## 15. Owner decisions needed

1. **ICP evolution and the drift-test extension** (an ADR; see the positioning doc). This includes whether "a hole found before a user hits it" counts as passing the drift test.
2. **S-1: listings as code, published by the host's CI**, with Mushi read-only on store accounts until a later `act` decision.
3. **New connector kinds** `public_probe`, `llm_usage` and `revenuecat` added to Plan 019's union.
4. **The public diagram page** (opt-in, public repos by default) as a growth loop.
5. **P-2:** enforce `monthly_llm_budget_usd`, or relabel it "alert only".
6. **Registration** of this file as Plan 020 in PLANS.md.

## Sources

Checked 2026-10-02. *(secondary)* = aggregator, not vendor page.

- Supabase storage orphaning: https://supabase.com/docs/guides/storage/management/delete-objects · https://supabase.com/docs/guides/troubleshooting/storage-unexpectedly-high-usage-or-exceed_storage_size_quota-errors-ae21a5 · backups exclude Storage: https://supabase.com/docs/guides/platform/backups
- Supabase MCP and pricing: https://supabase.com/docs/guides/getting-started/mcp · https://supabase.com/pricing · OAuth server: https://supabase.com/docs/guides/auth/oauth-server
- IDPs: https://www.port.io/pricing · https://www.docs.port.io/agent-management/port-mcp-server/overview · https://www.cortex.io/pricing · https://www.opslevel.com/pricing · https://roadie.io/pricing · https://backstage.io/docs/ai/mcp-actions
- Platforms: https://vercel.com/docs/ai-tooling/vercel-mcp · https://vercel.com/changelog/vercel-agent-has-updated-pricing · https://docs.railway.com/ai/mcp-server · https://render.com/docs/mcp-server · https://coolify.io/cloud · https://firebase.blog/posts/2025/10/firebase-mcp-server-ga · https://appwrite.io/docs/tooling/ai/mcp-servers · https://neon.com/pricing
- CI and gates: https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets · https://socket.dev/pricing · https://snyk.io/plans/ · https://mergify.com/pricing
- Agents: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent · https://linear.app/integrations/agents · https://mcp.sentry.dev/ · https://sentry.io/pricing/
- Integration: https://zapier.com/mcp · https://pipedream.com/pricing · https://n8n.io/pricing/ · https://opentelemetry.io/docs/specs/status/
- Mobile and stores: https://docs.expo.dev/mcp/ · https://expo.dev/pricing · https://docs.fastlane.tools/app-store-connect-api/ · https://docs.codemagic.io/billing/pricing/ · https://bitrise.io/pricing · https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api · https://developer.apple.com/videos/play/wwdc2025/324/ · https://developers.google.com/android-publisher/edits · https://developers.google.com/android-publisher/quotas · https://developers.google.com/android-publisher/reply-to-reviews · https://developers.google.com/android-publisher/terms · https://developer.apple.com/forums/thread/727332 · https://developer.apple.com/forums/thread/731014
- Store policy: https://developer.android.com/google/play/requirements/target-sdk · https://developer.apple.com/news/upcoming-requirements/ · https://developer.apple.com/support/offering-account-deletion-in-your-app/ · https://support.google.com/googleplay/android-developer/answer/13327111 · https://appleinsider.com/articles/25/05/30/millions-of-apps-were-denied-by-apple-in-2024-amid-fraud-crackdown · https://www.mozillafoundation.org/en/privacynotincluded/articles/mozilla-study-data-privacy-labels-for-most-top-apps-in-google-play-store-are-false-or-misleading/
- ASO and reviews: https://appfollow.io/blog/app-store-mcp-servers · https://www.apptweak.com/en/pricing
- Billing and credits: https://www.revenuecat.com/docs/welcome/projects · https://www.revenuecat.com/docs/tools/mcp · https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits · https://docs.stripe.com/billing/entitlements · https://polar.sh/docs/features/benefits · https://www.paddle.com/pricing · https://getlago.com/pricing
- Auth: https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains · https://clerk.com/pricing · https://auth0.com/pricing · https://workos.com/pricing · https://stytch.com/pricing
- Analytics, links, notifications: https://posthog.com/pricing · https://posthog.com/docs/model-context-protocol · https://dub.co/docs/concepts/deep-links/deferred-deep-linking · https://firebase.google.com/support/dynamic-links-faq/ · https://www.appsflyer.com/zero-update-2026/ · https://onesignal.com/blog/whats-changing-on-onesignals-free-plan/ · https://knock.app/pricing · https://novu.co/pricing · https://www.courier.com/pricing
- Solo operators and vibe-coding incidents: https://developer.apple.com/forums/thread/811793 · https://www.theregister.com/2025/08/06/aws_wipes_ten_years/ · https://www.indiehackers.com/post/aws-cost-insights-from-building-cloudwise-9818a8adad · https://www.producthunt.com/p/sidepop · https://www.superblocks.com/blog/lovable-rls-breach · https://bastion.tech/blog/lovable-april-2026-data-breach · https://escape.tech/state-of-security-of-vibe-coded-apps · https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-codegen-vulnerability-debt-2026 · https://aiweekly.co/alerts/github-ai-api-key-leaks-surge-23x-in-ten-months *(secondary)*
- Security and cost tools: https://help.aikido.dev/ai-and-dev-tools/aikido-mcp.md · https://www.gitguardian.com/pricing · https://vantage.sh/blog/anthropic-support · https://platform.claude.com/docs/en/manage-claude/usage-cost-api · https://langfuse.com/pricing · https://betterstack.com/pricing · https://fossa.com/pricing/
- Repo understanding: https://github.com/coderamp-labs/gitingest · https://github.com/ahmedkhaleel2004/gitdiagram/blob/main/docs/architecture.md · https://news.ycombinator.com/item?id=42521769 · https://docs.devin.ai/work-with-devin/deepwiki · https://docs.devin.ai/work-with-devin/deepwiki-mcp · https://news.ycombinator.com/item?id=45002092 · https://github.com/yamadashy/repomix · https://developers.googleblog.com/en/introducing-code-wiki-accelerating-your-code-understanding/ · https://www.gitkraken.com/blog/gitkraken-acquires-codesee · https://sourcegraph.com/pricing · https://github.com/Egonex-AI/Understand-Anything
