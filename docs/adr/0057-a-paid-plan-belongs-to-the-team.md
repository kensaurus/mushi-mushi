# 0057. A paid plan belongs to the team, not to one app

Status: Accepted 2026-11-11 (owner: "fix billing for me"). Date: 2026-11-11

Related: [`VISION.md`](../../VISION.md) §2.2 (Cloud pricing canon),
`packages/server/supabase/functions/_shared/org-billing.ts`,
`_shared/quota.ts`, `stripe-webhooks/index.ts`,
migration `20261111120000_billing_customers_one_per_org.sql`.

## Context

VISION.md §2.2 sets every plan limit per team: apps, seats, diagnoses a
month, overage and the spend cap. The code did not. Found 2026-11-11 (read
only):

- Checkout, the Stripe customer and `billing_subscriptions` were keyed by the
  app the owner clicked Upgrade on.
- The diagnosis gate read that app's own subscription row, so after one $79
  Studio checkout every other app in the team stayed on Free: 100 diagnoses,
  hard stop.
- The seat cap read `organizations.plan_id`, which nothing in the server
  wrote from Stripe, so a paying team still had 1 seat and Studio invites
  failed.
- Round 2 of the customer re-audits (#1062) then wrote the per-app behaviour
  into the public docs ("a plan covers only the upgraded app", "8 apps × $79").

## Decision

1. **A subscription belongs to the organization.** Checkout carries
   `organization_id` in the subscription metadata; there is one Stripe
   customer per organization (unique `billing_customers.organization_id`).
   `project_id` on both tables is only the app the plan was bought from.
2. **One plan resolver** (`_shared/org-billing.ts`): a complimentary org's
   own plan; else the org's newest live subscription (active, trialing,
   past_due); else `organizations.plan_id`; else Free. The diagnosis and
   ingest gates, feature gates, the seat cap, the app limit, retention, the
   brand footer, usage alerts and the billing pages all use it.
3. **Usage is pooled per team per calendar month**: diagnoses are counted
   across every app in the organization. The spend cap lives on the team's
   subscription, so it caps the team's overage. Stripe's graduated overage
   price (included units at $0) applies per customer, so one customer per
   team pools the invoice the same way.
4. **stripe-webhooks writes `organizations.plan_id`** after every
   subscription event, from the team's newest live subscription (Free when
   none), never from the event alone, and never for a complimentary org.
5. Deleting the app a plan was bought from moves the billing rows to another
   app in the team; the last app of a paying team cannot be deleted until the
   plan is cancelled.

## Rejected

- **Per-app plans** (what the code did): contradicts the pricing canon, makes
  an agency with eight apps pay eight times, and left the seat cap and the app
  limit reading a different plan from the quota.
- **Counting by `usage_events.organization_id`**: the column is not written on
  insert (NULL on every row in prod, 2026-11-11), so the count would be 0.
  Usage is counted by the team's project ids instead.
- **A per-app spend cap under a team plan**: one subscription per team leaves
  no per-app row to hold it, and a per-app cap could not bound the team's bill.
