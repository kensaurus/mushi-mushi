# @mushi-mushi/cloud

Marketing landing + sign-up + billing dashboard for **Mushi Mushi Cloud**
(`mushimushi.dev`). Next.js 15 App Router + Supabase Auth (SSR cookies)
+ Stripe metered billing.

## What's in here

| Route                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `/`                  | Marketing landing + pricing                        |
| `/signup`            | Email + password + org name → Supabase Auth signup |
| `/signup/check-email`| Post-signup email-verification waiting state       |
| `/login`             | Sign in with Supabase Auth                         |
| `/dashboard`         | First project's billing state, usage, Stripe portal entry |

## Sign-up flow

1. User submits the `/signup` form (org + email + password).
2. `supabase.auth.signUp()` fires Supabase Auth's confirmation email.
3. The Supabase-side trigger `on_new_user_create_project` (already in
   the schema) provisions a `projects` row + adds the user to
   `project_members`.
4. User clicks the link → lands on `/dashboard`.
5. `/dashboard` calls `GET /v1/admin/billing` against the gateway.
6. "Add a card" button calls `POST /v1/admin/billing/checkout` →
   redirects to Stripe Checkout.
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
`/billing` page reads the same `pricing_plans` row and renders an
`LLM $X.XX` cost chip from `llm_invocations.cost_usd` (Wave J).

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…
NEXT_PUBLIC_API_BASE_URL=https://<ref>.functions.supabase.co
NEXT_PUBLIC_APP_URL=https://app.mushimushi.dev
```

## Deployment

Deploys to Vercel as a standard Next.js App Router site. Edge runtime
is **not** required — server actions run in Node so the Stripe-key API
calls land server-side.
