# Mushi Bounties — crowd-test marketplace

> *"The next developer and the next agent both inherit the rule. But someone has to find the bugs first."*

Mushi Bounties is the public-facing layer that turns real users into a structured QA team. Developers publish their app to the Bounties marketplace. Testers find bugs. Every accepted report earns mushi-points that can be redeemed for Mushi Pro credit (at a 1.3× premium) or 100+ gift cards powered by Tremendous — subject to OFAC compliance and a $599/yr KYC threshold.

---

## Table of contents

- [The three-persona funnel](#the-three-persona-funnel)
- [Why not cash?](#why-not-cash)
- [The redemption model](#the-redemption-model)
- [Schema map](#schema-map)
- [KYC and the $599 threshold](#kyc-and-the-599-threshold)
- [OFAC and sanctions compliance](#ofac-and-sanctions-compliance)
- [Anti-fraud and reputation](#anti-fraud-and-reputation)
- [Self-host gating](#self-host-gating)
- [Entitlement flags](#entitlement-flags)
- [References](#references)

---

## The three-persona funnel

```
┌───────────────────────────────────────────────────────────┐
│  Developer / PM  (admin console — rewards → publishing)   │
│  → publishes app listing with bounty schedule             │
│  → reviews tester submissions in the reports queue        │
│  → accepts/rejects reports → points are awarded or not    │
└────────────────────────┬──────────────────────────────────┘
                         │ report lands in dev's Sentry DSN
                         ▼
┌───────────────────────────────────────────────────────────┐
│  QA Tester  (tester portal — /mushi-mushi/testers/)       │
│  → browses marketplace, joins an app                      │
│  → submits a bug with steps + screenshot                  │
│  → earns points on acceptance                             │
│  → redeems for Pro credit or gift card                    │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────────────────┐
│  Mushi platform  (cloud-only)                             │
│  → anti-gaming velocity caps + reputation scoring         │
│  → KYC gate at $400 annual gift-card threshold            │
│  → OFAC sanctions geofence before any payout              │
│  → Tremendous worker dispatches gift cards                │
│  → Stripe customer balance credit for Pro                 │
└───────────────────────────────────────────────────────────┘
```

---

## Why not cash?

Direct cash payouts trigger state + federal income reporting at $600+/year (US 1099-NEC threshold) and equivalent thresholds in most jurisdictions. The hybrid model avoids this:

| Redemption type | Tax treatment | Notes |
|---|---|---|
| Mushi Pro credit | Platform credit — not taxable income | 1.3× premium; reduces next invoice |
| Gift cards (≤$599/yr) | Below US 1099 reporting threshold | Tremendous handles delivery |
| Gift cards (>$599/yr) | 1099-NEC territory — KYC required | W-9 (US) or W-8BEN (non-US) collected |

The hybrid model is the same approach used by AWS, Stripe, and Mechanical Turk for small-dollar reward programs that want to stay below mandatory reporting thresholds while still providing real economic value.

---

## The redemption model

### Closed-loop: Mushi Pro credit (1.3× premium)

1,000 mushi-points → $13.00 of Mushi Pro credit applied as a Stripe customer balance transaction.

**Math:** `points_spent * 1.3 = credit_amount_in_cents`
- 1,000 pts × 1.3 = 1,300¢ = $13.00
- 2,500 pts × 1.3 = 3,250¢ = $32.50

The 1.3× premium compensates for the closed-loop restriction — the credit only works inside Mushi. A tester who already uses Mushi Pro (or plans to) gets 30% more value by choosing this path.

### Open-loop: gift cards via Tremendous

1,000 mushi-points → $10.00 face-value gift card (100+ brands: Amazon, Starbucks, App Store, Visa prepaid, etc.).

**Flow:**
1. Tester calls `POST /v1/tester/wallet/redeem` with `kind=gift_card`.
2. Points are deducted via `award_tester_points(-N)`.
3. A `tremendous_orders` row is inserted with `status=pending`.
4. The `tremendous-redemption-worker` edge function polls every 10 minutes and dispatches pending orders to the Tremendous API using the org's BYOK key.
5. Tremendous sends a signed webhook when the order is `EXECUTED` or `DECLINED`.
6. On `DECLINED`, points are automatically refunded via the idempotent `award_tester_points(+N)`.

---

## Schema map

| Table | Purpose |
|---|---|
| `mushi_testers` | Tester identity, country code, public handle, leaderboard opt-in |
| `mushi_tester_profiles` | Bio, expertise tags (public profile) |
| `published_apps` | App listings — visibility, slug, Sentry DSN, hero image |
| `published_app_bounties` | Per-action point schedules (bug_accept, enhancement_accept, …) |
| `published_app_targeting` | Reputation gate, target countries, max tester slots |
| `tester_app_subscriptions` | Tester ↔ app join/leave history |
| `tester_submissions` | Each bug report; linked to `reports` table via `tester_submission_id` |
| `tester_balances` | Current and lifetime points per tester |
| `tester_credit_ledger` | Double-entry ledger — one row per earn or spend event |
| `tester_redemptions` | Each redemption; `premium_multiplier=1.3` for Pro credit |
| `tremendous_orders` | Tremendous dispatch queue; `external_id` set once dispatched |
| `tester_kyc` | W-9/W-8BEN metadata; `withholding_status` = `none|pending|cleared|rejected` |
| `tester_reputation` | Aggregate score per tester |
| `tester_reputation_events` | Append-only event log powering the reputation score |
| `tester_leaderboard_30d` | Materialized view — top 50 testers (refreshed every 15 min) |
| `tester_leaderboard_30d_public` | Public view (masks handles for `public_leaderboard=false`) |
| `anti_gaming_events` | Velocity cap hits and cross-account flags |

---

## KYC and the $599 threshold

US tax law (26 U.S.C. § 6041) requires a Form 1099-NEC from any payer who issues $600+ in non-employee compensation in a calendar year. Mushi's KYC gate fires at $400 (with headroom) so the developer has time to collect data before the 1099 trigger.

**Tester flow:**
1. Cumulative gift-card redemptions approach $400 → wallet page shows a KYC alert.
2. Tester navigates to `/tester/settings#kyc` and submits the KYC form.
3. Legal name + TIN are **hashed client-side** (SHA-256) before transmission. Raw TIN never touches Mushi's database.
4. `withholding_status` is set to `pending` — a reviewer manually clears it.
5. Once `cleared`, the tester can redeem up to $599 in gift cards per year before the gate reactivates.
6. At $599, the gateway requires a full W-9 / W-8BEN on file to continue.

---

## OFAC and sanctions compliance

Per 31 CFR Part 515 and related executive orders, Mushi is required to block payouts to persons or entities in sanctioned jurisdictions. The module is in `packages/server/supabase/functions/_shared/sanctions.ts`.

**Blocked country codes (as of May 2026):**
- `CU` — Cuba (31 CFR Part 515)
- `IR` — Iran (EO 13599)
- `KP` — North Korea / DPRK (EO 13694)
- `SY` — Syria (EO 13582)
- `RU` — Russia (comprehensive post-2022 sanctions)
- `BY` — Belarus (Lukashenko regime)

**Sub-national review required (cannot geofence at country level):**
- `UA` — Crimea, Donetsk, Luhansk regions are blocked; all `UA` redemptions require reviewer sign-off.
- `CN` — SDN individual checks; no country-level block.

The OFAC list must be reviewed quarterly. Document the review date in `docs/runbooks/tester-marketplace-launch.md`.

> **Precedent:** Tango App paid a $116,000 OFAC civil penalty in 2022 for sending gift cards to Crimea without adequate controls. `checkSanctions()` is called at both tester join and gift-card redeem — two layers of defense.

---

## Anti-fraud and reputation

### Velocity caps (per 24h)
- 20 global submissions per tester
- 5 submissions per tester per app

Submissions over the cap are marked `status='spam'` which withholds auto-awarding. A reviewer can override to `accepted` via the admin console's anti-gaming page.

### Reputation scoring
`recompute-tester-reputation` runs daily (02:00 UTC) and computes:
- `lifetimeScore` — cumulative `delta_score` from `tester_reputation_events`
- `signalPct` — accepted / total non-spam submissions
- `impactPct` — high-impact events / total events

The score gates app joins (`published_app_targeting.reputation_min`) and applies a multiplier to point awards for high-reputation testers.

### Anti-gaming events
Every velocity cap hit is written to `anti_gaming_events` with `kind='tester_velocity_global'` or `'tester_velocity_per_app'`. The admin console's anti-gaming page surfaces these for manual review.

---

## Self-host gating

Mushi Bounties is **cloud-only**. Self-hosted instances see an upgrade prompt on the `/tester` route instead of the tester dashboard. The gate is in `apps/admin/src/App.tsx`'s `TesterRoute` component which checks `envStatus.mode === 'self-hosted'`.

Rationale: the marketplace needs a central point of trust for payout dispatch (Tremendous), OFAC compliance, and KYC — none of which are safe to delegate to self-hosted operators without auditable controls.

---

## Entitlement flags

Added to `pricing_plans.feature_flags` (jsonb) in migration `20260523005000_marketplace_entitlements.sql`:

| Flag | Hobby/Starter | Pro | Enterprise |
|---|---|---|---|
| `marketplace_publish` | ✗ | ✓ | ✓ |
| `tester_cashout` | ✗ | ✓ | ✓ |
| `marketplace_priority_listing` | ✗ | ✗ | ✓ |

Checked by `get_org_feature_flags(p_organization_id)` RPC called from the `requireMarketplacePublish()` helper in `published-apps.ts`.

---

## References

- [Launch runbook](runbooks/tester-marketplace-launch.md) — pre-launch checklist, Tremendous sandbox setup, smoke test queries
- [Rewards program](REWARDS.md) — the developer-side rewards infrastructure Bounties is built on top of
- [Evolution loop manifesto](EVOLUTION-LOOP.md) — the product thesis; Bounties is one manifestation of "cumulative selection"
- [Tester marketplace — public](../../apps/testers/README.md) — the `apps/testers` Next.js workspace
- [AGENTS.md](../../AGENTS.md) — `tremendous-redemption-worker` and `recompute-tester-reputation` edge functions
