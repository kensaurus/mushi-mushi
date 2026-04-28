# @mushi-mushi/cloud

Marketing landing + sign-up + billing dashboard for **Mushi Mushi Cloud**
(`mushimushi.dev`). Next.js 15 App Router + Supabase Auth (SSR cookies)
+ Stripe metered billing.

## What's in here

| Route                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `/`                  | Marketing landing — `Hero` → **`MushiCanvas`** (`#loop` anchor) → `Pricing` → `ClosingCta` → `MarketingFooter` |
| `/signup`            | Email + password + org name → Supabase Auth signup |
| `/signup/check-email`| Post-signup email-verification waiting state       |
| `/login`             | Sign in with Supabase Auth                         |
| `/dashboard`         | First project's billing state, usage, Stripe portal entry |

The landing page composes its hero / canvas / closing CTA / footer from
the shared **[`@mushi-mushi/marketing-ui`](../../packages/marketing-ui)**
package — same source-of-truth as the admin SPA's public homepage, so a
brand tweak ships once and renders everywhere. The marketing surface in
`app/page.tsx` is a thin wrapper:

1. **`<MarketingShell>`** (`app/_components/MarketingShell.tsx`) — wraps
   the surface in `<MarketingProvider>` with a Next.js-flavoured `Link`
   adapter (anchors / mailto / external pass through to plain `<a>`,
   internal routes go through `next/link`) and the URL helpers from
   `lib/links.ts`.
2. `<Hero />` → `<MushiCanvas />` (lazy-loaded React Flow scene with five
   stage cards — Capture / Classify / Dispatch / Verify / Evolve — a paper
   edge animation, a CSS-only stage drawer, and a log ticker) → custom
   `Pricing` block → `<ClosingCta />` → `<MarketingFooter apiBaseUrl={…} />`.

The package depends on [`@xyflow/react`](https://reactflow.dev),
[`framer-motion`](https://www.framer.com/motion), and the shared
`@mushi-mushi/brand` editorial tokens. Mushi Editorial CSS variables
(`--mushi-paper`, `--mushi-ink`, `--mushi-vermillion`, …) come from
`@mushi-mushi/brand/editorial.css`; the canvas + stage / log-ticker
animation styles come from `@mushi-mushi/marketing-ui/styles.css` — both
imported once in `app/globals.css`. Tailwind v4's `@source` directive is
pointed at `../../packages/marketing-ui/src/**/*` so utility classes used
inside the package are emitted in this app's CSS.

The page is editorial-light by design — the brand package ships dark-mode
tokens behind an explicit `[data-mushi-theme="dark"]` attribute, so
OS-level dark preference never flips the marketing surface.

### Outbound URLs — single source of truth

Every external CTA on the landing page (`Docs`, `Self-host guide`,
drawer `Learn the details`, footer GitHub / Changelog / Contact, every
`mailto:`) is computed by `lib/links.ts`. Three env-overridable helpers
keep the URLs honest as the deployment topology changes:

| Helper            | Default                                    | Override env                |
| ----------------- | ------------------------------------------ | --------------------------- |
| `docsUrl(path?)`  | `https://kensaur.us/mushi-mushi/docs`      | `NEXT_PUBLIC_DOCS_URL`      |
| `repoUrl(path?)`  | `https://github.com/kensaurus/mushi-mushi` | `NEXT_PUBLIC_REPO_URL`      |
| `contactEmail()`  | `kensaurus@gmail.com`                      | `NEXT_PUBLIC_CONTACT_EMAIL` |

Adding a new outbound link? **Don't hardcode strings** — extend
`lib/links.ts` so the next rebrand / subpath migration is one file, not
twelve.

### Live gateway-health pill

The marketing footer renders `<StatusPill />` (from
`@mushi-mushi/marketing-ui`), which polls the public `/health` endpoint
on `NEXT_PUBLIC_API_BASE_URL` (passed in via the `apiBaseUrl` prop on
`<MarketingFooter />`) every 60 s and renders one of three states:

* `Checking gateway…` — initial render, neutral pulse.
* `Gateway healthy · <region>` — emerald pulse, `{ status: 'ok' }` from `/health`.
* `Gateway unreachable` — muted red, on non-2xx / network error / 6 s timeout.

This replaced a hardcoded `Sentry · Langfuse · GitHub healthy` span
that always rendered green even when the gateway was down — exactly
the kind of dead UI that erodes trust on a marketing page.

## Sign-up flow

1. User submits the `/signup` form (org + email + password). If they
   came from a tier CTA (`/signup?plan=starter` or `?plan=pro`), the
   plan flows into a hidden form field and onto Supabase
   `user_metadata.signup_plan` so the choice survives email verification.
2. `supabase.auth.signUp()` fires Supabase Auth's confirmation email.
3. The Supabase-side trigger `on_new_user_create_project` (already in
   the schema) provisions a `projects` row + adds the user to
   `project_members`.
4. User clicks the link → lands on `/dashboard`.
5. `/dashboard` calls `GET /v1/admin/billing` against the gateway.
6. "Add a card" / "Subscribe to Pro" button calls
   `POST /v1/admin/billing/checkout` with the persisted `plan_id`
   (`starter` default, `pro` if it was set on signup) → redirects to
   Stripe Checkout. The button reads `json.data.url` from the wrapped
   admin envelope (`{ ok, data: { url, plan_id } }`) — reading
   `json.url` was a previous bug that silently no-op'd both the
   Checkout and Billing Portal buttons.
7. After payment, Stripe webhook → `stripe-webhooks` Edge Function
   upserts `billing_subscriptions` to `active`.

## Billing model

Four tiers, seeded in `pricing_plans` (see `packages/server/supabase/migrations/20260419000000_billing_plans.sql`):

| Tier       | Base / month | Included reports | Overage / report | Retention | Notable feature flags                       |
| ---------- | -----------: | ---------------: | ---------------: | --------: | ------------------------------------------- |
| Hobby      |        $0.00 |            1,000 |          (none)  |    7 days | 3 seats max                                 |
| Starter    |       $19.00 |           10,000 |         $0.0025  |   30 days | BYOK, plugins, audit log, 48h SLA           |
| Pro        |       $99.00 |           50,000 |         $0.0020  |   90 days | + SSO, intelligence reports, 8h SLA         |
| Enterprise |  Sales-led   |        Unlimited |   Custom         |  365 days | + self-hosted, SOC 2, 4h SLA                |

Hourly `usage-aggregator` Edge Function pushes per-day report counts
to Stripe Meter Events with idempotent identifiers. The admin
`/billing` page reads the same `pricing_plans` rows and renders them
as an always-visible **"Plans at a glance"** comparison table (4 tiers
side-by-side, feature-grouped, "Your plan" highlight), a per-project
**`PlanBenefitsList`** (✓/— entitlements spelling out retention, seats,
BYOK, plugins, audit log, intelligence reports, SSO, SOC 2, self-hosted,
SLA hours), and a real **`LLM $X.XX`** cost chip from
`llm_invocations.cost_usd`. The admin shell header also mounts a
**`PlanBadge`** (tier-toned pill next to the project switcher, deep-links
to `/billing`) so paid members always see their tier and free users see
quota usage without opening the billing page.

## Required environment variables

```bash
# --- required ---
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…
NEXT_PUBLIC_API_BASE_URL=https://<ref>.functions.supabase.co

# --- highly recommended in non-prod (drives Supabase magic-link `emailRedirectTo`) ---
# In prod this defaults to https://kensaur.us/mushi-mushi; in local dev, set to
# http://localhost:3002 so the confirmation email lands you back on the dev box.
NEXT_PUBLIC_CLOUD_URL=http://localhost:3002

# --- optional, with sensible defaults ---
# Hosted admin console root. Defaults to the unified deployment topology;
# override only if you front the admin SPA from a different domain.
NEXT_PUBLIC_APP_URL=https://kensaur.us/mushi-mushi/admin
NEXT_PUBLIC_DOCS_URL=https://kensaur.us/mushi-mushi/docs
NEXT_PUBLIC_REPO_URL=https://github.com/kensaurus/mushi-mushi
NEXT_PUBLIC_CONTACT_EMAIL=kensaurus@gmail.com
```

> **Magic-link gotcha.** `/signup` asks Supabase to email a confirmation
> link with `emailRedirectTo = ${NEXT_PUBLIC_CLOUD_URL}/auth/callback`. The
> handler that exchanges the PKCE `code` for a session lives at
> `app/auth/callback/route.ts` — without it, the magic link silently 404s.
> If you fork this app, make sure your Supabase project has **Email ➝ Confirm
> Email** enabled and that PKCE is the chosen flow (Supabase default since 2024).

## Editorial brand across the auth surface

`/login`, `/signup`, `/signup/check-email`, and `/dashboard` all wear the
same washi/sumi/vermillion editorial palette as the marketing landing —
no more dark indigo islands. The shared chrome lives in
`app/_components/AuthShell.tsx`:

* `<AuthShell chapter title subtitle>` — paper sheet with a header pill,
  vermillion **Chapter NN / …** overline, serif title, ledger-mono labels.
* `<AuthField id label hint>` — labelled input wrapper.
* `authInputClass`, `authPrimaryBtnClass`, `authGhostBtnClass` —
  field/button class strings so server-action `<form>` elements stay
  simple `<input>` / `<button>` markup.
* `<AuthError>` — vermillion-tinted error banner; replaces the old
  red-500/40 alert so the failure tone matches the brand.

The `/dashboard` page composes these primitives plus a vermillion ledger
bar on the **Reports · last 30 days** card (fills as usage approaches
the free-tier ceiling), serif status word, and a Stripe-branded
checkout/portal CTA pair gated on `signup_plan` (Starter vs Pro copy).

## Unified `kensaur.us/mushi-mushi/*` topology

The marketing page (`apps/cloud`), admin console (`apps/admin`), and
docs site (`apps/docs`) all live on a single CloudFront distribution at
`kensaur.us`, with three path-prefix cache behaviors funnelling to the
right origin:

| Path                              | Origin              | Cache policy        |
| --------------------------------- | ------------------- | ------------------- |
| `/mushi-mushi/admin/*`            | S3 (admin SPA)      | CachingOptimized    |
| `/mushi-mushi/docs/*`             | S3 (docs static)    | CachingOptimized    |
| `/mushi-mushi/*` *(default)*      | Vercel (cloud SSR)  | CachingDisabled     |

Behavior priority is *most-specific first*; CloudFront matches the first
PathPattern that fits, so admin + docs win their slots and everything
else (the cloud landing, `/login`, `/signup`, `/dashboard`,
`/auth/callback`) falls through to the Vercel origin.

### Build-time prefix flip

Both Next.js apps use `MUSHI_BASE_PATH` to flip `basePath` + `assetPrefix`
on a per-build basis:

```bash
MUSHI_BASE_PATH=/mushi-mushi      pnpm --filter @mushi-mushi/cloud build  # production
MUSHI_BASE_PATH=/mushi-mushi/docs MUSHI_ASSET_PREFIX=/mushi-mushi/docs \
                                  pnpm --filter @mushi-mushi/docs  build  # docs (static export)
```

Leaving the env unset (local `pnpm dev`) keeps everything served at `/`.
Vite admin reads `VITE_BASE_PATH=/mushi-mushi/admin/` in CI; locally it
defaults to `/`.

### Deploy workflows

Three independent GitHub Actions workflows ship the three apps, then the
cloud workflow runs the idempotent CloudFront updater:

| Workflow                    | Trigger                          | What it does                                           |
| --------------------------- | -------------------------------- | ------------------------------------------------------ |
| `deploy-admin.yml`          | push touching `apps/admin/**`    | builds Vite, syncs to `s3://…/mushi-mushi/admin/`, updates `mushi-mushi-spa-router` + `mushi-mushi-spa-response` CloudFront Functions, invalidates `/mushi-mushi/admin/*` |
| `deploy-docs.yml`           | push touching `apps/docs/**`     | builds Nextra static export, syncs to `s3://…/mushi-mushi/docs/`, updates `mushi-mushi-docs-router` + `mushi-mushi-docs-response`, invalidates `/mushi-mushi/docs/*` |
| `deploy-cloud.yml`          | push touching `apps/cloud/**`    | builds + deploys to Vercel via CLI, then runs `scripts/cloudfront-mushi-update-distribution.mjs` to (a) ensure the Vercel origin exists on the distribution, (b) re-prepend the three `/mushi-mushi/*` cache behaviors in priority order |

The CloudFront updater is idempotent — it patches the existing distribution
config rather than replacing it — so re-runs are safe and the script
exits 0 if the desired state already matches.

### Required GitHub Secrets

Beyond the existing `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
`CLOUDFRONT_DISTRIBUTION_ID` / `VITE_SUPABASE_*` / `SENTRY_*` admin
secrets, the cloud + docs deploys add:

| Secret                       | Used by             | Notes                                                                |
| ---------------------------- | ------------------- | -------------------------------------------------------------------- |
| `VERCEL_TOKEN`               | `deploy-cloud.yml`  | Vercel CLI auth token (`Settings → Tokens`)                          |
| `VERCEL_ORG_ID`              | `deploy-cloud.yml`  | from `apps/cloud/.vercel/project.json` after first `vercel link`     |
| `VERCEL_PROJECT_ID_CLOUD`    | `deploy-cloud.yml`  | same file as above                                                   |
| `VERCEL_CLOUD_HOSTNAME`      | `deploy-cloud.yml`  | the production Vercel hostname, e.g. `mushi-mushi-cloud.vercel.app`  |

`deploy-docs.yml` uses only the existing AWS secrets — the docs site is
fully static, so no third-party host is involved.

### First-time bootstrap

If you're deploying the unified topology for the first time on a fresh
distribution, run the workflows in this order:

1. Run `deploy-admin.yml` (creates the two admin CloudFront Functions).
2. Run `deploy-docs.yml`  (creates the two docs CloudFront Functions).
3. Link `apps/cloud` to a Vercel project and capture the IDs into the
   four `VERCEL_*` secrets above.
4. Run `deploy-cloud.yml`  (deploys to Vercel and patches CloudFront
   origins + behaviors).

After step 4, `kensaur.us/mushi-mushi/` should resolve to the cloud
landing, `kensaur.us/mushi-mushi/admin/` to the admin SPA, and
`kensaur.us/mushi-mushi/docs/` to the docs site — all served from a
single distribution and a single TLS certificate.

### Vercel project + env-var bootstrap (one-time)

Phase 4 of the production-readiness 12/10 PDCA pass is the only step
that breaks the *current* topology (today `kensaur.us/mushi-mushi/`
serves the legacy admin SPA from S3). Before triggering
`deploy-cloud.yml` for the first time, an operator must:

```bash
# 1. From a workstation that has the Vercel CLI logged in:
cd apps/cloud
vercel link --yes --project mushi-mushi-cloud   # create + link

# 2. Capture the IDs the GitHub Actions workflow needs.
cat .vercel/project.json   # { "orgId": "team_…", "projectId": "prj_…" }

# 3. Mint a long-lived PAT at https://vercel.com/account/tokens
#    Scope: full account; Expires: 90 days minimum.

# 4. Set the four GitHub Actions secrets so deploy-cloud.yml can run.
gh secret set VERCEL_TOKEN            --body "<pat>"        --repo kensaurus/mushi-mushi
gh secret set VERCEL_ORG_ID           --body "<orgId>"      --repo kensaurus/mushi-mushi
gh secret set VERCEL_PROJECT_ID_CLOUD --body "<projectId>"  --repo kensaurus/mushi-mushi
gh secret set VERCEL_CLOUD_HOSTNAME   --body "mushi-mushi-cloud.vercel.app" --repo kensaurus/mushi-mushi

# 5. Set Vercel project env vars (production scope).
vercel env add NEXT_PUBLIC_API_BASE_URL  production  # https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api
vercel env add NEXT_PUBLIC_CLOUD_URL     production  # https://kensaur.us/mushi-mushi
vercel env add NEXT_PUBLIC_APP_URL       production  # https://kensaur.us/mushi-mushi/admin
vercel env add MUSHI_BASE_PATH           production  # /mushi-mushi
vercel env add NEXT_PUBLIC_SUPABASE_URL  production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
```

Pre-flight before triggering the cutover (this fixes QA report **C3**
— the Cloud `apiBaseUrl()` default `api.mushimushi.dev` has no DNS, so
billing CTAs fail silently without `NEXT_PUBLIC_API_BASE_URL`):

* `vercel ls --token=$VERCEL_TOKEN apps/cloud` → preview deploy returns
  200 against `/`, `/login`, `/signup`, `/dashboard`.
* `node scripts/smoke-prod-flow.mjs` against the preview URL exits 0.

Only then run `deploy-cloud.yml` — it triggers Vercel deploy *and* the
CloudFront origin swap that flips the `/mushi-mushi/*` default behavior
from S3-legacy-admin to Vercel-cloud-app. Rollback is a single re-run
of `scripts/cloudfront-mushi-update-distribution.mjs` against the
previous DefaultCacheBehavior config (saved as workflow artifact at
the start of every run).
