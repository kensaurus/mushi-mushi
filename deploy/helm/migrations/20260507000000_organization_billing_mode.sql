-- ============================================================
-- Complimentary billing mode for organizations.
--
-- Some orgs (Mushi-internal staff, sponsored partners, beta testers,
-- comp accounts) need full plan entitlements WITHOUT a Stripe subscription.
-- Before this migration the only way to grant a paid tier was to mint a
-- billing_subscriptions row pointing at a fake Stripe sub_/cus_ id, which:
--   - tripped /v1/admin/billing/invoices with `resource_missing` on every load
--   - confused the stripe-webhooks reconciler when fake ids didn't match
--   - made it impossible to tell at a glance whether an org was a real
--     paying customer or an internal comp account
--
-- New contract: organizations.billing_mode tells the system how this org
-- pays. 'stripe' (default) means the existing self-serve flow (real
-- customer + subscription). 'complimentary' means consult organizations.plan_id
-- directly and skip Stripe entirely — quota, entitlements, and the /billing
-- UI all read the org row, no Stripe calls fire.
--
-- The pricing_plans FK on organizations.plan_id already enforces that the
-- declared comp tier is a real plan, so flipping an org to complimentary
-- with plan_id='pro' immediately grants Pro quota + entitlements + UI.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'stripe'
    CHECK (billing_mode IN ('stripe', 'complimentary'));

-- Partial index so the operator query "show me every comp account" stays
-- fast as the customer base grows; the default 'stripe' rows are excluded.
CREATE INDEX IF NOT EXISTS idx_organizations_billing_mode_complimentary
  ON public.organizations(billing_mode)
  WHERE billing_mode <> 'stripe';

COMMENT ON COLUMN public.organizations.billing_mode IS
  'How this org pays. ''stripe'' (default) = standard self-serve via Stripe Checkout + Billing Portal; ''complimentary'' = Mushi-internal staff / sponsored / beta / comp account — plan_id is honoured for entitlements and quota but no Stripe customer or subscription is required, and /billing renders a "Complimentary account" badge with no Manage button.';
