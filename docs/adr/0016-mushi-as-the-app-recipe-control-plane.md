# 0016. Mushi as the app recipe control plane

Status: Proposed — owner decision 2026-10-02, pending owner signature            Date: 2026-10-02

Amends: [0004](0004-lead-with-the-bug-mediator-category.md) (scope, not
category). Supersedes: none. Plan: [Plan 019](../execplans/app-recipe-control-plane.md).

## Context

The owner, 2026-10-02: *"Mushi should be a one-stop platform where users
integrate and control the app styles, systems, push the changes and find
deviance."* and *"Make gates, CI/CD and the pipeline all visual on Mushi, to
reflect and find issues per project — how each schema and design system feeds
in as the 'recipe for the app', and how deploy, build, env are set."* Offered
a narrow "design-drift findings only" option and a full control plane, the
owner chose the full control plane.

Mushi already holds about half of a recipe, scattered across features:

- inventory and story nodes (`graph_nodes`, `inventories`);
- gates (`gate_runs`, `gate_findings`, `metric_series`);
- CI status (`fix_attempts.check_run_*`, `sdk_upgrade_jobs.check_run_*`);
- env presence (`/sdk-diagnostics`);
- integration presence (`project_settings`) and health (`integration_health_history`);
- a reviewed-PR writer (`createPrFromFiles`).

No surface joins them, and two collectors have never produced a real value:
`backend_schema_snapshots` has 0 rows, and all 50
`sdk_upgrade_jobs.deploy_status` values are `unknown`.

A control plane runs into these lines, quoted as they stand today:

- VISION §1.4, *Explicitly NOT*: "The enterprise SRE running Sentry + Datadog + Firebase who wants a fourth integration hub."
- VISION §1.7 / AGENTS.md tripwire 1: "We will not require a monitoring stack to get value. Standalone-first, always."
- VISION drift test, mirrored in AGENTS.md: "Does this help a solo vibe-coder understand and fix a bug faster, without leaving their editor?"
- ADR 0004, rejected: "'Integration hub' / 'synthesis layer' — … it presumes the reader already runs a monitoring stack, so it fails the standalone-first buyer."
- VISION §2.1, Bucket C: "Enterprise plumbing (SSO/audit/retention/region, Helm) stays operator-only."

## Decision

Each project gets an **App Recipe**: one versioned, per-project record of the
following:

- data schema;
- design system (DTCG tokens plus a component list);
- routes and user stories;
- gates;
- CI/CD;
- build and deploy targets;
- env-var presence (never values);
- integrations.

The console renders the recipe as one visual Recipe page. Every element has
the same three parts:

1. **A source.** Wherever possible it is a table Mushi already has.
2. **A drift check.** Drift becomes `gate_findings` under new gate names.
3. **A change path.** A change only ever goes out as a reviewed draft PR through
   `createPrFromFiles`. Mushi never writes directly to a repo, a provider or a
   secret.

**Portfolio-native from day one** (owner scope expansion, 2026-10-02): *"one person could make multiple apps, services, libraries and websites, so Mushi should help them manage all of it simply"*.

- **An organization is the portfolio.** Recipe rows carry `organization_id`, and projects gain a `kind` (app, site, service or library).
- **Shared things are first-class `portfolio_resources` that projects use:** auth providers, Supabase projects, Stripe accounts, domains, deep-link domains, push keys, Slack channels and repos.
- **Cross-project concerns are rules over resources and over findings grouped by rule.** Examples: divergent auth settings, broken cross-app deep links, SDK skew, CI cost per repo, and the same misconfiguration in several repos (fixed once, as one draft PR per repo).
- **No second recipe model.**

The broader portfolio-operator scope (GTM, analytics, marketing, cross-app notifications) is **Plan 020 (in progress)**. It builds on this record and does not redefine it.

**One connector interface.** Every source feeds a recipe through `RecipeConnector`, an edge adapter in the ADR 0013 pattern behind one registry; an unknown kind is a 400. It has four capabilities:

- `snapshot` (read);
- `drift` (pure);
- `propose` (file edits, opened as a PR only by the GitHub connector);
- `act` (an API mutation).

The planned connectors are GitHub, Supabase, Sentry and a generic signed HTTP connector first; then Vercel, Expo/EAS, App Store Connect, Play Console, Stripe and PostHog, each added when a pilot needs it. Legacy systems push through webhook, OTel or CSV ingest. Third-party code never runs on Mushi's edge.

**Auth model: least privilege, read by default.**

- Credentials are Vault refs, at organization or project level, with separate read and write refs.
- A probe records the scopes actually granted, and a missing scope disables only its capability.
- Every `act` needs a human approval in the console bound to the exact payload. None ships enabled in v1.

**Positioning — the recipe is context, not the category.** The category and
north star do not change. The recipe sits in Bucket B (the depth). It is what
lets a diagnosis say *"this broke because `profiles.locale` was dropped on
Tuesday"* or *"this button uses a colour that is not in your tokens"*, and lets
the fix arrive as a PR that respects the app's own system. The answers to the
quoted lines:

- **Integration hub / fourth hub.** Connectors are the closest this comes to a hub, so they carry the strictest rule: a connector exists only to feed a diagnosis or a fix, and Mushi still works with none connected. Every element is optional. An empty element
  renders as "not connected" with a one-line reason. A project with only the
  SDK still gets a recipe: routes from discovery, env presence from
  sdk-diagnostics.
- **Standalone-first.** No element requires Sentry, Supabase, Vercel or any
  provider.
- **Drift test.** Each element must name the diagnosis or fix it improves. CI
  minutes and cost fail the test on their own, so they ship as an
  Advanced-mode card framed as "why your fix is slow to land". They never lead.
- **The front door stays the diagnosis.** The Recipe page is not in the hero,
  the README first screen or the npm description.

**Sequencing gate (owner may strike).** Two slices sit outside the gate:

- Plan 019 Phase 1 (no migration, existing data);
- Phase 1b, the design-token slice. glot.it's new design system is being
  designed now and should be ingested from its first commit.
- Phase P1, the portfolio rollup of Phase 1 recipes. It needs no migration.

These gated phases start when either of these happens first:

- Phase 2 (connectors and the CI, deploy, schema and env collectors);
- Phase P2 (cross-project rules);
- Phase 3 (push-changes).

The conditions are:

- at least 3 external projects are activated;
- an owner-dated review.

Today's north-star count is 0 activated external projects.

## Proposed VISION.md / AGENTS.md diff (for owner approval — not applied)

This diff touches none of the strings that
`scripts/check-positioning-consistency.mjs` guards: `northStar`, `category`,
the "vibe coder" anchor, and the three will-nots. It only inserts text and
splits none of them. Checked 2026-10-02: the guard exits 0 on a scratch copy of
`VISION.md` and `AGENTS.md` with this diff applied.

```diff
 VISION.md §1.5, after "That is the word: **understandable.**"
+
+**The recipe.** Mushi keeps each app's recipe — its schema, design tokens,
+routes, gates, CI, deploy targets and which env vars exist — so a diagnosis
+can point at what changed, and a fix lands as a reviewed PR that respects the
+app's own system. For someone running several apps, the recipes roll up into
+one portfolio that shows what the apps share and where they disagree. The
+recipe is optional context: every part of it is a "connect when you want"
+on-ramp, never a prerequisite.

 VISION.md §2.1, Bucket B row
-| **B. The Depth** (earns trust, shown second) | Multi-framework SDKs, dedup via knowledge graph, "where it stops" honesty table, self-host, BYOK, Sentry enrichment. | README mid-body, landing second screen, `docs/` |
+| **B. The Depth** (earns trust, shown second) | Multi-framework SDKs, dedup via knowledge graph, the app recipe (schema, tokens, routes, gates, CI, deploy, env presence) and its drift, "where it stops" honesty table, self-host, BYOK, Sentry enrichment. | README mid-body, landing second screen, `docs/` |

 AGENTS.md "Positioning" block, after the "Category we own" paragraph
+**The app recipe** (ADR 0016) is diagnosis context, not a new category: every
+recipe element is optional, renders "not connected" when empty, and changes
+ship only as reviewed draft PRs. It never leads a public surface.
```

No tagline change is proposed. A recipe-led tagline was considered: "Your AI
shipped it. Mushi keeps the recipe and tells you why it broke." It was rejected
because it makes the recipe the premise. That repeats the 0004 drift and would
require a `packages/brand` change.

## Rejected alternatives

- **Design-drift findings only.** Ingest tokens and flag off-token colours as
  findings, with no recipe page and no push. It was smaller and safer, and the
  owner rejected it. It leaves the schema, CI, deploy and env views scattered
  across five pages. It also cannot "push the changes", which is half of the
  ask.
- **A Backstage-style catalog: a `catalog-info.yaml` per service, many
  services, ownership and scorecards.** It is built for the 50-engineer org
  that VISION §1.4 excludes. A vibe-coder has one app and no platform team.
- **Direct writes to providers** (Vercel env API, GitHub secrets values,
  Supabase DDL). These are faster, but irreversible and invisible to the owner.
  PRs are the review step a solo builder already has.
- **Project-only now, portfolio later.** This means retrofitting `organization_id`, shared resources and cross-project rules onto tables with data in them. The owner's own organization already has 7 projects, so the portfolio is the real shape.
- **One more `project_settings` column per vendor** (today's pattern: Sentry, Slack, Linear, GitHub). It does not scale to ten vendors, cannot model one credential shared by three apps, and has no capability or scope model.
- **Run third-party connector code (plugins) on the edge.** That is supply-chain risk on a multi-tenant edge. Out-of-tree sources use the signed HTTP protocol instead.
- **A new token format.** Rejected for W3C DTCG 2025.10, which both Mushi
  (`packages/brand/tokens/brand.tokens.json`) and glot.it already emit.

## Consequences and risks

- **Positioning drift.** This is the 0004 failure mode, now from inside. The
  mitigations are the drift-test line per element, the "never leads" rule, and
  the proposed AGENTS.md line.
- **Activation.** This work does not move the north star directly. The
  sequencing gate keeps Phases 2 and 3 behind it.
- **Solo-founder bandwidth.** Plan 019 is three phases. Only Phase 1 is cheap,
  and it reuses existing reads.
- **Security of pushing into user repos.** The rules:
  - draft PRs, left in draft;
  - a recipe-declared path allowlist;
  - never a secret value (permanent);
  - `mushi.recipe.json` treated as untrusted input (size cap, secret scan,
    wrapped before any prompt).

  Not in v1, as later opt-ins for the owner to decide:
  - migration-file PRs, which are an ordinary file write and not DDL against
    production;
  - `.github/workflows/**` PRs. These need the per-project `workflow` scope, so
    they are off by default.
- **Scope explosion toward a Port-style developer portal.** A portfolio rule or connector earns its place only by changing a diagnosis or a fix. Vendors are added one at a time for a pilot.
- **Connector upkeep.** Vendor API churn lands on one person; contract tests and the generic HTTP and push adapters cap it.
- **Cross-organization leakage.** Account-level keys resolve by owner today, so portfolio access must intersect with organization membership, with a denial test.
- **SSRF.** Probes now fetch user-supplied URLs, so a single safe fetch refuses private and metadata ranges.
- **Silent fail-open** (shipped 4× here). "Never scanned" must render
  differently from "no drift". Phase 1 is a failure if an empty collector
  shows green.
