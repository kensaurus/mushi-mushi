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

The landing page's interactive **MushiCanvas** lives in
`app/_components/MushiCanvas/` (lazy-loaded React Flow scene with five
stage cards — Capture / Classify / Dispatch / Verify / Evolve — a paper
edge animation, a CSS-only stage drawer, and a log ticker). It depends on
[`@xyflow/react`](https://reactflow.dev), [`framer-motion`](https://www.framer.com/motion),
and the shared `@mushi-mushi/brand` editorial tokens. Mushi Editorial CSS
variables (`--mushi-paper`, `--mushi-ink`, `--mushi-vermillion`, …) come
from `@mushi-mushi/brand/editorial.css` and are imported once in
`app/globals.css`. The page is editorial-light by design — the brand
package ships dark-mode tokens behind an explicit `[data-mushi-theme="dark"]`
attribute, so OS-level dark preference never flips the marketing surface.

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

The marketing footer renders `<StatusPill />` (in `app/_components/`),
which polls the public `/health` endpoint on `NEXT_PUBLIC_API_BASE_URL`
every 60 s and renders one of three states:

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
NEXT_PUBLIC_APP_URL=https://app.mushimushi.dev

# --- optional, with sensible defaults ---
NEXT_PUBLIC_DOCS_URL=https://kensaur.us/mushi-mushi/docs
NEXT_PUBLIC_REPO_URL=https://github.com/kensaurus/mushi-mushi
NEXT_PUBLIC_CONTACT_EMAIL=kensaurus@gmail.com
```

## Deployment

Deploys to Vercel as a standard Next.js App Router site. Edge runtime
is **not** required — server actions run in Node so the Stripe-key API
calls land server-side.

### Unified `kensaur.us/mushi-mushi/*` topology (work-in-progress)

The marketing page (`apps/cloud`), admin console (`apps/admin`), and
docs site (`apps/docs`) are migrating onto a single host so the user
sees one URL family:

| Path                              | App           |
| --------------------------------- | ------------- |
| `/mushi-mushi/`                   | apps/cloud    |
| `/mushi-mushi/admin/*`            | apps/admin    |
| `/mushi-mushi/docs/*`             | apps/docs     |
| `/mushi-mushi/login`, `/signup`   | apps/cloud    |
| `/mushi-mushi/dashboard`          | apps/cloud    |

The CTAs on this page already point at the eventual paths via the
`docsUrl()` / `repoUrl()` helpers — flipping `NEXT_PUBLIC_DOCS_URL` (or
the default in `lib/links.ts`) is the only app-side change needed once
the host-level rewrites land. Today, `kensaur.us/mushi-mushi/*` serves
the admin SPA only; the cloud + docs slots are stubbed and the marketing
landing runs on `localhost:3002` for dev work.
