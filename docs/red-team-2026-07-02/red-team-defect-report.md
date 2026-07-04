# Mushi Mushi Site Red-Team + Anti-Slop — Defect Report

**Scope:** https://kensaur.us/mushi-mushi/ (docs marketing site, admin console auth/connect surface, Supabase backend for project `dxptnwrhwsqckaftyymj`)
**Date:** 2026-07-02
**Method:** Headed Playwright session (manual clicks, console-error checks, screenshots) on the funnel pages (landing, connect, pricing, cloud, admin login/signup, roadmap, changelog, drift) + an automated HTTP/link sweep across all 169 docs routes + source-level verification against the actual `packages/server`, `packages/mcp`, and native SDK packages + Supabase MCP logs/advisors on the live backend.
**Companion doc:** [`../archive/plan-antislop/2026-07-site-redteam.md`](../archive/plan-antislop/2026-07-site-redteam.md) for prose/visual slop burndown.

## Launch verdict

**Not ready for a major launch push** until the Critical items below ship. None of them are large — the whole Critical list is copy, a routing constant, and a two-line pricing calc fix — but each one erodes trust on the primary funnel (operator onboarding, pricing honesty, and version credibility) the moment a real visitor clicks through.

## Coverage matrix

| Section | Routes | Method | Result |
|---|---|---|---|
| Landing + trust strip | 1 | Headed browser, every card clicked | 1 broken CTA (#1) |
| Connect | 1 | Headed browser, lanes + copy buttons | Pass (client picker, MCP/CLI/Skills lanes, copy buttons all work; placeholder key in deeplink is by design for the public demo) |
| Pricing | 1 | Headed browser, estimator interacted (Monthly + Annual) | 2 defects — hardcoded copy (#6) + estimator calc bug (#7) |
| Cloud | 1 | Headed browser + source review | 1 defect — phantom Discord claim (#9) |
| Admin auth (signup/login) | 2 | Headed browser, invalid-email + feedback-widget probe | 1 critical defect — feedback widget 401s pre-auth (#2), HTML5 validation confirmed working |
| Admin demo-link routes (from 44 admin docs pages) | 41 unique | Automated HTTP sweep | All 200 (SPA shell serves; auth gate behavior already confirmed via #2's login page) |
| Quickstart | 15 | Automated HTTP + source review | Pass on links; native-SDK version pins stale (#5) |
| Concepts | 20 | Automated HTTP + source review (architecture.mdx cross-checked against `fix-worker`) | 1 defect — autofix approval claim (#4) |
| SDKs | 31 | Automated HTTP + source review | 1 broken link, present in every page's sidebar (#3); MCP tool count on `/connect` verified **accurate** (68, computed from `catalog.ts`, not hardcoded) |
| Migrations | 15 | Automated HTTP sweep | Pass |
| Admin docs | 44 | Automated HTTP + source review (screenshot captions cross-checked against edge functions) | 1 defect — Stagehand caption (#8) |
| Roadmap / Changelog / Launch Week / Blog | 6 | Headed browser + source review | 1 defect — stale MCP "72-tool" claim (#3 root cause), version banner confirmed stale on every page including changelog itself (#2) |
| Global banner (all 169 pages) | — | Headed browser (pricing + changelog pages) | Critical — v0.8.0 banner vs. v1.22.5 latest release (#2) |
| Backend (Supabase) | — | MCP `get_logs` / `get_advisors` / `execute_sql` | 1 high-severity backend defect — pipeline-recovery cron always 401s (#10); 0 ERROR-level security advisories, 205 WARN-level (pre-existing GraphQL-exposure noise, out of scope — recommend `plan-rls-audit`) |

Total unique doc/content pages verified reachable: **169/169** (via HTTP status) + **41/41** admin live-demo routes. One dead link found and traced to a CloudFront routing edge case (#3).

## Critical

### #1 — "I operate the console" landing CTA lands on documentation, not the live app

The third card in the landing page's "Where to start" grid promises *"Create a project, connect GitHub, and walk through the onboarding checklist"* with the command `mushi login && mushi status`, but its `href` is the relative path `/admin/onboarding`.

```58:62:apps/docs/lib/landing-copy.ts
    title: 'I operate the console',
    desc: 'Create a project, connect GitHub, and walk through the onboarding checklist.',
    href: '/admin/onboarding',
    cmd: 'mushi login && mushi status',
```

`WhereToStartGrid` renders this as a raw `<a href>` (root-relative, ignoring the docs `basePath`), so it resolves to `kensaur.us/admin/onboarding`. The apex-redirect CloudFront Function ([`scripts/cloudfront-mushi-apex-redirect.js`](../../scripts/cloudfront-mushi-apex-redirect.js)) matches `/admin/` against its `DOCS_NESTED_PREFIXES` list *before* it ever checks `SPA_PREFIXES`, so this URL always 301s to `/mushi-mushi/docs/admin/onboarding` — the **documentation page about onboarding**, not the live console. A first-time operator clicks "operate the console" and lands on a doc page telling them what the console *would* look like.

![Operator CTA lands on docs, not the live console](./screenshots/defect-01-operate-console-cta-lands-on-docs.png)

**Fix:** point the card at the fully-qualified live URL so the apex-redirect script (which only rewrites root-relative apex paths) never gets a chance to intercept it. `ADMIN_DEMO_BASE` (`'https://kensaur.us/mushi-mushi/admin'`) already exists for exactly this purpose and is used by `DocsMediaShowcase.tsx` and `AdminDocHero.tsx`. *(Fixed — see Remediation.)*

### #2 — Global "v0.8.0 · shipped" banner is stale by 14 minor versions

Every page on the docs site — including the changelog page that lists the real release history — shows this banner:

```51:59:apps/docs/app/layout.tsx
const banner = (
  <Banner storageKey="v0-8-0-wave-c">
    <span className="docs-banner-eyebrow">v0.8.0 · shipped</span>
    Native mobile SDKs, optional Sentry enrichment, and bring-your-own keys/storage.{' '}
```

The changelog's own top entry is `v1.22` (packages published at `1.22.5`), with `SSR / non-DOM safety` and `Public-API error isolation` as the two headline highlights. Scrolling the same page that displays the "v0.8.0" banner shows a `v1.22` heading a few hundred pixels down — a visitor doesn't need to check source, the contradiction is on-screen.

![Banner claims v0.8.0 while the changelog on the same page shows v1.22](./screenshots/defect-03-version-banner-vs-changelog.png)

**Fix:** rewrite the banner copy to the real latest release and rotate `storageKey` so previously-dismissed visitors see it again. *(Fixed — see Remediation.)*

### #3 — `/sdks/mcp-tools.generated` 404s from every single page's sidebar

The docs sidebar (present on all 169 pages, plus two inline links from `admin/mcp.mdx` and `sdks/skills.mdx`) links to "MCP tools (generated)" at `/sdks/mcp-tools.generated`. Live fetch confirms a genuine CloudFront/S3 404, not a caching artifact:

```
$ curl -sD - https://kensaur.us/mushi-mushi/docs/sdks/mcp-tools.generated
HTTP/2 404
x-cache: Error from cloudfront
```

Root cause: the file is named `mcp-tools.generated.mdx` (auto-generated by `scripts/gen-mcp-tools-doc.mjs`), so its route contains a literal dot. The docs router CloudFront Function decides whether to append `.html` using a "does this URI already have a file extension" heuristic:

```55:62:scripts/cloudfront-mushi-docs-router.js
  // 3. Has a file extension: pass through (assets, JSON, sitemap, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }
  // 4. Clean URL with no extension: append `.html` so S3 finds the static export.
  request.uri = uri + '.html';
```

`/sdks/mcp-tools.generated` matches that regex (`.generated` looks like an extension), so the function skips appending `.html` and requests the literal S3 key `sdks/mcp-tools.generated`, which doesn't exist — only `sdks/mcp-tools.generated.html` does. Every visitor who clicks the sidebar link to the generated tool catalog — the single most concrete reference for "which MCP tools actually exist," which is also the natural place to go verify the roadmap's "72-tool" claim (#4 below) — hits a dead page.

**Fix:** renamed the route to remove the dot (`mcp-tools-generated`) rather than adding a special case to a CloudFront regex shared by all 169 routes. *(Fixed — see Remediation.)*

## High

### #4 — Roadmap claims a "72-tool" MCP surface; canonical count is 68

```47:47:apps/docs/content/roadmap.mdx
- **MCP 72-tool surface** — `@mushi-mushi/mcp@0.16`, `mcp:read` + `mcp:write` scopes, 10 feature groups
```

The canonical tool count, computed once and re-used everywhere else, is `TOOL_CATALOG.length + TDD_TOOL_CATALOG.length + CODEBASE_TOOL_CATALOG.length` = 39 + 22 + 7 = **68**, matching `TOOL_COUNT` in `mcp-admin.ts` and the `/connect` page's stats strip (which is *not* hardcoded — it imports and sums the same catalog arrays, so it's correct and needs no fix). Only `roadmap.mdx` has drifted.

**Fix:** updated the roadmap line to 68. *(Fixed — see Remediation.)*

### #5 — Architecture doc overstates the human-approval gate on autofix

```42:42:apps/docs/content/concepts/architecture.mdx
- `fix-worker → GitHub` only fires after a human approves the triage decision.
```

`fix-worker` actually dispatches automatically whenever autofix is enabled and the estimated cost is under budget; a human approval gate only kicks in when the cost exceeds `autofix_approval_cost_threshold_usd`:

```359:376:packages/server/supabase/functions/fix-worker/index.ts
      if (budget.requiresApproval && !dispatchApproved) {
        const approvalReason =
          'Estimated dispatch cost exceeds approval threshold — approve in console before PR creation.';
```

As written, the doc describes a more conservative (and less autonomous) system than what ships, which undersells the product's actual autofix capability and would confuse anyone reading the architecture page to understand why a PR appeared without them clicking "approve."

**Fix:** reworded to describe the budget/approval-threshold gate accurately. *(Fixed — see Remediation.)*

### #6 — Native SDK quickstarts pin versions that don't exist

Four docs pages pin native package versions to `0.8.0`, a number that traces back to the stale global banner (#2), not to any real release:

| File | Line | Claims | Actual latest |
|---|---|---|---|
| `content/quickstart/flutter.mdx` | 9 | `mushi_mushi: ^0.8.0` | `0.3.0` (`packages/flutter/pubspec.yaml`) |
| `content/sdks/flutter.mdx` | 12 | `mushi_mushi: ^0.8.0` | `0.3.0` |
| `content/quickstart/android.mdx` | 15 | `implementation("dev.mushimushi:sdk:0.8.0")` | `0.4.0` (`packages/android/build.gradle.kts`) |
| `content/sdks/ios.mdx` | 11 | `from: "0.8.0"` | `0.4.0` (`packages/ios/MushiMushi.podspec`) |

A developer who copy-pastes these gets a dependency resolution error (`0.8.0` was never published for any of the three native packages) on the very first step of onboarding.

**Fix:** updated all four to the real latest versions. *(Fixed — see Remediation.)*

### #7 — Admin doc screenshot caption invents a "Stagehand walker"

```165:170:apps/docs/data/admin-screenshots.ts
  drift: {
    image: 'inventory-dark.png',
    alt: 'Drift scanner — live app vs contract snapshot',
    caption: 'Stagehand walker compares inventory + OpenAPI + DB schema',
```

The actual `drift-walker` edge function triggers `contract-graph-builder` to build a snapshot, then runs `walkContractDrift` (a Thompson-sampled path-priority walker) — there's no Stagehand anywhere in the pipeline:

```1:9:packages/server/supabase/functions/drift-walker/index.ts
 * drift-walker — Phase 4b
 *
 * Supabase Edge Function that:
 *   1. Triggers contract-graph-builder to build/refresh the snapshot
 *   3. Runs walkContractDrift (Thompson-sampled path priority — Phase 4c)
```

I verified the live rendered `/docs/admin/drift` page still shows this caption, so it's not a stale local file — it's on production.

**Fix:** updated the caption to name the real components. *(Fixed — see Remediation.)*

## Medium

### #8 — Pricing page: "$15–$15" range is nonsensical

```73:73:apps/docs/content/pricing.mdx
A typical vibe-coder project on Indie runs **200–400 diagnoses / month** → **$15–$15** (within included quota).
```

Both ends of the diagnosis range (200 and 400) fall inside Indie's 500-diagnosis flat-fee tier, so a range template that was presumably meant to show cost-at-low-end vs. cost-at-high-end collapses to the same number on both sides — reading as a copy-paste error rather than a deliberate "it's flat" statement.

**Fix:** reworded to state the flat rate directly instead of a degenerate range. *(Fixed — see Remediation.)*

### #9 — Pricing estimator "Estimated total" ignores the Annual toggle

This one is a real interactive bug, not copy drift — reproduced live by toggling the estimator on `/pricing`. At 300 diagnoses/month with **Annual** selected, the breakdown shows:

```
Base (Indie) · annual: $12.50
Billed $150/yr ($12.50/mo equivalent)
─────────────────────────────
Estimated total: $15.00 / mo   ← wrong, should be $12.50
```

Root cause: `estimateCost()` always uses the raw monthly `tier.baseUsd`, and the component never threads the `annual` flag into it — only the separate `displayBaseUsd()` call (which drives the line *above* the total) respects the toggle.

```32:39:apps/docs/components/PricingEstimator.tsx
  const activeTier = getTierById(activeTierId)
  const { total, overage, capped } = estimateCost(activeTier, diagnoses)
  const displayBase = displayBaseUsd(activeTier, annual)
```

```44:55:apps/docs/lib/pricing-estimator.ts
export function estimateCost(tier: PricingTier, diagnoses: number): CostEstimate {
  const overCount = Math.max(0, diagnoses - tier.included)
  if (tier.overageUsd === null) {
    return { total: tier.baseUsd, overage: 0, capped: overCount > 0 }
  }
```

Effect: every annual-billing visitor sees the bottom-line "Estimated total" overstated by the 2-months-free discount — $2.50/mo too high on Indie, ~$8.17/mo too high on Pro — directly under a section literally named "Pricing estimator," on the page whose entire purpose is pricing trust.

**Fix:** flagged for `docs-writer`/frontend follow-up (needs `estimateCost` to accept the annual-adjusted base rather than `tier.baseUsd`, plus a unit test — out of scope for this pass's "copy + routing constant" critical-fix budget, tracked below in Remediation as not yet fixed).

### #10 — Cloud page promises a "community Discord" that doesn't exist

```124:124:apps/docs/lib/public-copy.ts
    cloudNotes: 'All SDKs, hosted admin, community Discord, plain-English reads',
```

There is no Mushi Mushi Discord server anywhere in the codebase or marketing plan. The only Discord references in the repo (`docs/marketing/drip-channels.md`) are a list of *other* communities' servers (MCP, Claude Code, Supabase, Cursor) where the marketing team plans to drop showcase links — not a Mushi-owned community. A prospective Free Cloud user reading this benefit and looking for an invite link would find nothing. GitHub Discussions is the actual, already-linked (from `roadmap.mdx`) community channel.

**Fix:** replaced with "GitHub Discussions." *(Fixed — see Remediation.)*

## Backend / infrastructure (found during this audit, outside the docs/marketing surface but worth flagging since the task asked to report any errors found)

### #11 — `pipeline-recovery` cron has been silently failing every 5 minutes since at least June 30

While checking Supabase logs for the test bug report submitted during the feedback-widget probe (#12 below), `get_logs(service: 'edge-function')` showed a recurring pattern: batches of exactly 13 `POST /fast-filter → 401` requests clustered every ~300 seconds (14:49:55, 14:54:54 UTC on 2026-07-02, and matching clusters going back to at least 2026-06-30 15:15–15:35 UTC per `cron_runs`).

Root cause, confirmed by source: the `mushi-pipeline-recovery-5m` pg_cron job (added specifically to rescue reports stuck in `new`/`queued`/`failed` state) calls `fast-filter` via `net.http_post` with only a `Content-Type` header — no `Authorization`:

```104:108:packages/server/supabase/migrations/20260418005900_pipeline_recovery_cron.sql
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/fast-filter',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('reportId', rec.id::text, 'projectId', rec.project_id::text)
    );
```

The migration's own comment says this is fine because "`fast-filter` is deployed with `verify_jwt: false`" — but `verify_jwt` only controls Supabase's *platform-level* JWT check, not the function's own application-level guard. `fast-filter` independently calls `requireServiceRoleAuth(req)`, which unconditionally 401s when the `Authorization` header is empty:

```93:111:packages/server/supabase/functions/_shared/auth.ts
export function requireServiceRoleAuth(req: Request): Response | null {
  ...
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Requires valid internal caller token' } }),
```

Net effect: the recovery job that exists specifically to un-stick reports has never successfully recovered a single one since it was deployed — it fires, gets 401'd, and (because `net.http_post` is fire-and-forget) reports success in its own `cron_runs` audit trail regardless. Any report whose first classification attempt fails for an unrelated transient reason has no working fallback and will burn through `processing_attempts < 3` against a guaranteed-401 endpoint before going permanently untriaged. I did not find evidence of *currently* stuck reports in the two production projects I could query (both `reports` and `processing_queue` are empty of stale rows at the time of this audit), so today's user-visible impact looks limited to intermittent recovery races rather than a mass backlog — but the mechanism is provably non-functional and should not be trusted as a safety net.

**Not fixed in this pass** — this is a backend/pipeline change (add the `Authorization: Bearer <service-role-key>` header, sourced the same way the rest of the function already reads `SUPABASE_SERVICE_ROLE_KEY` from its Vault-backed config) outside the docs/marketing scope this plan approved. Flagging for a dedicated backend fix + `apply_migration` deploy in a follow-up turn.

### #12 — Confirmed: feedback widget's 401 discards the bug report (data loss)

This was found during Phase 1 and is restated here with the backend confirmation: the `BetaBanner` component renders globally, including on the *unauthenticated* admin login page, and its "Report a bug" action calls the JWT-gated `/v1/support/contact` endpoint. I submitted a test report (`RT-TEST-` prefixed) through this exact flow from the logged-out login page and confirmed via `execute_sql` against `support_tickets` that **no row was written** — the report is silently discarded from the visitor's perspective (they see a raw JSON 401 body) and from the backend's perspective (nothing lands anywhere, not even a failed-attempt row).

![Feedback widget renders a 401 with raw JSON on a logged-out page](./screenshots/defect-02-feedback-widget-401-on-logged-out-page.png)

**Not fixed in this pass** (component/route change, larger than the "copy + routing constant" scope approved for this turn) — recommend either hiding the "Report a bug" affordance on unauthenticated routes, or making `/v1/support/contact` accept anonymous submissions (the route's own comments indicate anonymous support was the original intent).

### Also observed, lower confidence / not root-caused

- Recurring `GET /api/v1/admin/inventory/542b34e0-… → 403` roughly every 40 seconds in the same log window — consistent with a stale/expired session polling a permission-gated endpoint (e.g., a left-open browser tab or dashboard widget). Did not chase further since it doesn't reproduce from a fresh, unauthenticated session and isn't part of the funnel scope; worth a look if it persists.
- Two `POST /mcp → 401` calls in the same window — most likely an external MCP client testing with a stale/placeholder key rather than a Mushi-side bug.
- Supabase advisors: **0 ERROR-level** findings. 205 WARN-level findings, almost entirely `pg_graphql_anon_table_exposed` / `pg_graphql_authenticated_table_exposed` (tables visible in the auto-generated GraphQL schema to `anon`/`authenticated` roles) plus a handful of `function_search_path_mutable` and one `extension_in_public` (`pg_net`). These are the standard Supabase GraphQL-introspection noise that shows up on most projects with `pg_graphql` enabled regardless of RLS correctness, and a full pass requires checking each table's actual RLS policies rather than the advisor's blanket warning — out of scope for a site red-team. Recommend routing to the `plan-rls-audit` skill as a dedicated follow-up.

## Verified accurate (checked, not defects)

- **169 docs routes**, all HTTP 200 except the one fixed in #3.
- **146/146** relative internal markdown links across all `.mdx` content resolve to real pages (aside from #3).
- **41/41** admin "open live demo" routes referenced from `data/admin-screenshots.ts` resolve to the SPA shell (200); the SPA's own auth gate was exercised directly via #12's probe.
- `/connect` page's "MCP tools" stat (**68**) — computed live from `TOOL_CATALOG.length + TDD_TOOL_CATALOG.length + CODEBASE_TOOL_CATALOG.length`, not hardcoded. The plan's preliminary static-analysis note that this page claimed "71+" did not reproduce against current source; only `roadmap.mdx` (#4) has actually drifted.
- **51 edge functions**, native iOS/Android/Flutter packages, pricing tiers, and the "comprehension layer / vibe coder / standalone-first" positioning all match `VISION.md` and the underlying code.
- Signup form: HTML5 native validation correctly blocks an invalid email with a browser tooltip (screenshot on file, `signup-invalid-email-state.png`).
- Zero console errors observed on landing, connect, pricing, cloud, roadmap, and changelog pages during the headed session.

## Methodology notes

- The plan's "full matrix" scope called for clicking through 170+ individual routes in a headed browser. In practice that was executed as a hybrid: every funnel page (landing, connect, pricing, cloud, admin auth, roadmap, changelog, drift) got full manual headed-browser interaction with console-error checks and screenshots; the remaining ~160 lower-traffic docs pages were verified via an automated HTTP-status + internal-link-resolution sweep (which catches the class of defect that matters most at this volume — dead links and 404s — see #3) plus targeted source review for any page whose prose makes an architecture or count claim. This trade-off was made to cover the full route surface within the session rather than partially covering it with manual clicks alone.
- Backend verification used Supabase MCP (`get_logs`, `get_advisors`, `execute_sql`) against project `dxptnwrhwsqckaftyymj`, matching `AGENTS.md`'s designation of that project as Mushi Cloud.
