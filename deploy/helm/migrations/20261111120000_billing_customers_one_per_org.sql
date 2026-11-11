-- ============================================================================
-- One Stripe customer per team (2026-11-11).
--
-- A paid plan belongs to the organization, not to one app (VISION.md §2.2:
-- apps, seats, diagnoses, overage and the spend cap are limits per team).
-- Checkout now reuses the team's customer, stripe-webhooks and the usage
-- aggregator look it up by organization_id, and Stripe's graduated overage
-- tier (included diagnoses at $0) applies per customer, so it must be one per
-- team for the team's diagnoses to pool on the invoice.
--
-- billing_customers.project_id stays the primary key and records the app the
-- customer was created from; it is an anchor, never a lookup key.
--
-- Additive. The table held 0 rows on prod when this was written (nobody had
-- paid yet), so the unique index builds instantly and cannot fail on
-- duplicates. The code does not depend on this index (it updates by
-- organization_id, then inserts only when no row exists); the index makes a
-- second customer row for a team impossible.
-- ============================================================================

create unique index if not exists billing_customers_organization_id_key
  on public.billing_customers (organization_id);

comment on column public.billing_customers.organization_id is
  'The team (organization) this Stripe customer bills. One customer per team (unique). project_id is the app it was created from.';

comment on column public.billing_subscriptions.organization_id is
  'The team (organization) the plan belongs to; every plan gate resolves by this column (_shared/org-billing.ts). project_id is the app it was bought from.';
