# Mushi Rewards Program

Incentivize real users to explore your app, report bugs, and give feedback — and reward them transparently with tiers, points, and optional monetary payouts.

## Table of contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [SDK integration](#sdk-integration)
- [Admin console guide](#admin-console-guide)
- [API reference](#api-reference)
- [Webhooks](#webhooks)
- [Anti-fraud system](#anti-fraud-system)
- [Monetary payouts](#monetary-payouts)
- [Quests](#quests)
- [Sandbox simulator](#sandbox-simulator)
- [Retention analytics](#retention-analytics)
- [Scaling to thousands of users](#scaling-to-thousands-of-users)

---

## How it works

```
User opens your app
  → SDK identifies the user via identify()
  → User performs an activity (reports a bug, views a screen, etc.)
  → SDK sends activity event to Mushi
  → Mushi applies your reward rules (base_points, daily caps, multipliers)
  → Points accumulate in end_user_points
  → Tier thresholds are evaluated — if crossed, tier is upgraded
  → Webhook fires to your app → you apply the perk (Pro access, discount, etc.)
  → User sees their progress via the rewards widget
```

The entire pipeline is **opt-in per user** (`opted_in_to_rewards = true`) and **scoped per organisation** — different projects under the same org share the same tier ladder and point economy.

### Automatic report awards (zero config)

You don't have to call `track()` for the two moments that matter most — the
ingest + triage pipeline awards them server-side:

| Moment | Action | Default points | Awarded in |
|---|---|---|---|
| Reporter submits a report | `report.submitted` | 10 | `api/helpers.ts` `ingestReport` (after the report is linked to an `end_user`) |
| Report reaches a classified state | `report.triaged` | 50 | `classify-report` edge function |

Both go through `awardPointsForEndUser` (`_shared/reputation.ts`), which enforces
your `reward_rules` velocity caps and the tier-evaluator. The dotted actions are
seeded as fallbacks in `LEGACY_POINT_TABLE`, so they award even with **no**
console config; add a `reward_rules` row of the same name to override
points/caps. Awards are fire-and-forget (a rewards failure never blocks ingest
or triage), and `report.triaged` is idempotent — re-classification can't
double-award.

> **Fastest path to a working program:** call `POST /v1/admin/rewards/presets/apply`
> (or click **Use recommended defaults** on the empty Activity rules tab) to
> install these rules plus a 4-tier ladder in one idempotent shot.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Your app (client)                           │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  @mushi-mushi/react  ·  @mushi-mushi/react-native  ·  web SDK │  │
│  │                                                                │  │
│  │  identify({ userId, name, email })                            │  │
│  │  mushi.track("report_submit")        ← custom activity        │  │
│  │  <RewardsWidget />                   ← progress / tier nudge  │  │
│  └────────────────────┬───────────────────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────────────────┘
                        │  HTTPS   /v1/identify   /v1/activity
                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│               Mushi Hono Edge Function  (Supabase Functions)           │
│                                                                        │
│  POST /v1/identify        → upsert end_users                          │
│  POST /v1/activity        → validate JWT, apply rules, insert         │
│                              end_user_activity, upsert end_user_points │
│  GET  /v1/rewards/me      → return current user's tier + points        │
│  POST /v1/rewards/me/opt-in                                            │
│                                                                        │
│  Admin routes                                                          │
│  GET  /v1/admin/rewards/overview                                       │
│  GET  /v1/admin/rewards/leaderboard?range&limit&offset&search&tier    │
│  GET  /v1/admin/rewards/contributors/:id                               │
│  GET  /v1/admin/rewards/activity                                       │
│  GET|PUT /v1/admin/rewards/rules                                       │
│  GET|PUT /v1/admin/rewards/tiers                                       │
│  POST /v1/admin/rewards/presets/apply   ← one-click default rules+tiers│
│  GET|POST|DELETE /v1/admin/rewards/webhooks                            │
│  POST /v1/admin/rewards/webhooks/test                                  │
│  GET|POST|DELETE /v1/admin/rewards/quests                              │
│  GET  /v1/admin/rewards/payouts                                        │
│  GET|POST|PATCH|DELETE /v1/admin/rewards/identity-providers            │
│  POST /v1/admin/rewards/bonus-points                                   │
│  POST /v1/admin/rewards/set-tier                                       │
│  GET  /v1/admin/rewards/disputes                                       │
│  POST /v1/admin/rewards/disputes/:id/resolve                           │
│  POST /v1/admin/rewards/simulate                                       │
│  GET  /v1/admin/rewards/retention-impact                               │
└───────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     Supabase PostgreSQL                                │
│                                                                        │
│  end_users          → identified user profiles                        │
│  end_user_points    → denormalised point totals + current tier        │
│  end_user_activity  → append-only event log (retained 90 days)        │
│  reward_rules       → action → points mapping, caps                   │
│  reward_tiers       → tier ladder (threshold, perks, monetary reward) │
│  reward_quests      → multi-step user journeys                        │
│  reward_webhooks    → outbound tier-change hooks                      │
│  reward_payouts     → monetary payout queue                           │
│  reward_disputes    → contested points / fraud disputes               │
└───────────────────────────────────────────────────────────────────────┘
                        │ webhook on tier change
                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│              Your app (server / webhook handler)                       │
│                                                                        │
│  POST /api/mushi/reward-webhook  (@mushi-mushi/node receiver)          │
│    { event: "reward.tier_changed",                                     │
│      end_user_id, external_user_id: "user_123",                       │
│      tier_after: { slug: "champion", display_name: "Champion" },      │
│      host_credit_payload: { kind: "pro_coupon", months: 1 } }         │
│                                                                        │
│  → apply Pro access, discount, or any custom perk                     │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Database schema

All tables live in the `public` schema of your Supabase project. They are multi-tenant (scoped by `organization_id`) and append-only where possible.

### `end_users`

Identified users collected via `identify()`. One row per `(organization_id, external_user_id)`.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | Internal Mushi user ID |
| `organization_id` | uuid | Owning org |
| `external_user_id` | text NOT NULL | Your app's user ID (e.g. Supabase auth UID) |
| `email_hash` | text | SHA-256 of the email, for display without storing PII |
| `display_name` | text | From `identify()` — shown in the admin console |
| `jwt_provider` | text | `apple` / `google` / `supabase` / `custom` |
| `jwt_subject` | text | JWT `sub` claim, verified at identify time |
| `jwt_verified_at` | timestamptz | Last successful JWT validation |
| `opted_in_to_rewards` | bool | User must explicitly opt in before points accrue |
| `anti_fraud_flags` | text[] | Set by the server on suspicious patterns |
| `first_seen_at` | timestamptz | When `identify()` was first called |
| `last_seen_at` | timestamptz | Most recent `identify()` or activity call |

### `end_user_points`

Denormalised running totals. One row per user. Updated after every accepted event.

| Column | Type | Description |
|---|---|---|
| `end_user_id` | uuid FK → end_users | |
| `organization_id` | uuid | |
| `total_points` | int | Rolling total (capped events excluded after revocation) |
| `points_30d` | int | Points awarded in the last 30 calendar days |
| `points_lifetime` | int | All-time accumulation, never decremented |
| `current_tier_id` | uuid FK → reward_tiers | NULL until first threshold crossed |
| `last_evaluated_at` | timestamptz | Last time tier thresholds were re-evaluated |

### `end_user_activity`

Immutable event log. Rows are retained for 90 days by default (`retain_until`).

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `end_user_id` | uuid FK | |
| `organization_id` | uuid | |
| `project_id` | uuid | Which SDK project sent this |
| `action` | text | Event name (e.g. `report_submit`, `screen_view`) |
| `points_awarded` | int | 0 if rejected |
| `rule_id` | uuid FK → reward_rules | Which rule matched |
| `rejected_reason` | text | `daily_cap_exceeded`, `no_rule`, `fraud_flag`, … |
| `metadata` | jsonb | Arbitrary payload from the SDK |
| `created_at` | timestamptz | Event wall-clock time |
| `retain_until` | timestamptz | Soft-delete date (default: `now() + 90 days`) |

### `reward_rules`

One row per action type. Defines points, caps, and multiplier eligibility.

| Column | Type | Description |
|---|---|---|
| `action` | text | Exact string the SDK sends (e.g. `report_submit`) |
| `base_points` | int | Points per event |
| `max_per_day` | int? | Daily cap per user (NULL = unlimited) |
| `max_per_user_lifetime` | int? | Lifetime cap per user (NULL = unlimited) |
| `multiplier_eligible` | bool | Whether a future streakMultiplier can boost this |
| `requires_jwt_verification` | bool | If true, event is rejected without a verified JWT |
| `enabled` | bool | Disabled rules reject all incoming events |

### `reward_tiers`

The tier ladder. Evaluated after every point update.

| Column | Type | Description |
|---|---|---|
| `slug` | text | URL-safe identifier (e.g. `explorer`, `champion`) |
| `display_name` | text | Human name shown in the widget and console |
| `display_order` | int | Ascending order on the tier ladder |
| `points_threshold` | int | Minimum `total_points` to reach this tier |
| `perks` | jsonb | Array of `{ label, description }` shown in the widget |
| `monetary_reward_usd` | numeric? | USD amount to pay out on tier entry (NULL = none) |
| `host_credit_payload` | jsonb? | Forwarded verbatim in the tier-change webhook |
| `enabled` | bool | Disabled tiers are skipped during evaluation |

### `reward_quests`

Multi-step guided journeys. Each step maps to a `reward_rules.action`.

| Column | Type | Description |
|---|---|---|
| `name` | text | Quest name shown to admins |
| `description` | text? | Optional explanation |
| `steps` | jsonb | `[{ action, label, metadata_match? }]` — ordered |
| `completion_points` | int | Bonus awarded on full completion |
| `expires_after_days` | int? | Days from first step before the quest expires |
| `repeatable` | bool | Whether the quest can be completed multiple times |
| `enabled` | bool | |

### `reward_webhooks`

Outbound HTTPS hooks fired on tier changes.

| Column | Type | Description |
|---|---|---|
| `url` | text | HTTPS endpoint in your app |
| `secret_hash` | text | SHA-256 of the signing secret — for display / equality checks only |
| `vault_secret_id` | text? | Vault reference to the **raw** HMAC signing secret; dereferenced server-side via `vault_get_secret` at signing time, never returned to clients |
| `events` | text[] | Currently `['reward.tier_changed']` |
| `last_delivered_at` | timestamptz | |
| `last_status` | int | HTTP response code of the last delivery |

### `reward_payouts`

Tracks monetary reward payouts via Stripe Transfers.

| Column | Type | Status values |
|---|---|---|
| `amount_usd` | numeric | — |
| `currency` | text | `usd` |
| `tier_slug` | text | Tier that triggered the payout |
| `stripe_transfer_id` | text? | Populated after Stripe Transfer creation |
| `status` | text | `pending` → `processing` → `paid` / `withheld` / `failed` |
| `withheld_reason` | text? | e.g. `fraud_flag`, `no_stripe_account` |

### `reward_disputes`

Raised when a user or admin challenges a points decision.

| Column | Type | Status values |
|---|---|---|
| `reason` | text | Free-text description |
| `status` | text | `open` → `resolved` / `rejected` |
| `resolution_notes` | text? | Admin note on resolution |
| `resolved_by` | uuid? | Admin user who resolved it |

---

## SDK integration

### 1. Install

```bash
# Web / React
npm install @mushi-mushi/react

# React Native
npm install @mushi-mushi/react-native
```

### 2. Identify the user

Call `identify()` as soon as your auth state is confirmed. This creates or updates the `end_users` row and starts the session.

```typescript
// React
import { useMushi } from '@mushi-mushi/react'

function App() {
  const mushi = useMushi()
  const { user } = useAuth()  // your auth hook

  useEffect(() => {
    if (user) {
      mushi.identify({
        userId: user.id,          // required — your app's user ID
        name: user.display_name,  // optional — shown in admin console
        email: user.email,        // optional — hashed before storage
        jwt: await getIdToken(),  // optional but required for JWT-gated rules
      })
    }
  }, [user])
}
```

### 3. Track custom activities

```typescript
// Track an action that maps to a reward_rule
mushi.track('report_submit')
mushi.track('screen_view_unique_per_day', { screen: '/pricing' })
mushi.track('comment_posted', { length: body.length })
```

The `action` string must match a `reward_rules.action` exactly, or the event is logged with `rejected_reason = 'no_rule'` and awards zero points.

### 4. Show the rewards widget

```tsx
import { RewardsWidget } from '@mushi-mushi/react'

// Inline progress card — shows tier, points, and next-tier callout
<RewardsWidget variant="card" />

// Compact badge for a nav bar or profile page
<RewardsWidget variant="badge" />

// Full drawer with tier progress and perks list
<RewardsWidget variant="drawer" />
```

### 5. Opt the user in

Users must explicitly opt in before points start accruing. This is enforced server-side — the SDK widget handles it with a consent screen.

```typescript
// Programmatic opt-in (after user accepts your rewards T&C)
await mushi.optInToRewards()
```

---

## Admin console guide

Navigate to `/rewards` in the Mushi admin console to access the 8-tab interface.

### Overview

Real-time KPI snapshot:

- **Total contributors** — identified users with at least 1 accepted event
- **Events (24 h)** — accepted + rejected event counts in the last 24 hours
- **Points awarded (24 h)** — sum of `points_awarded` for accepted events
- **Pending payouts** — `reward_payouts` rows with status `pending`
- **Tier distribution** — breakdown of how many users are in each tier
- **Activity feed** — live scrollable log of the most recent 50 events across all users with metadata, points, user name, and timestamp

Use the activity feed to debug in real time: rejected events show the rejection reason in red.

### Activity rules

Define the action → points mapping. Each rule controls:

| Field | Description |
|---|---|
| Action | Exact string the SDK sends |
| Base points | Points per accepted event |
| Daily cap | Maximum points this action can award per user per day |
| Lifetime cap | Total points this action can ever award to one user |
| JWT required | Reject events from unverified users |
| Enabled | Disable without deleting |

**Example rules for a bug-reporting app:**

| Action | Points | Daily cap | Rationale |
|---|---|---|---|
| `report_submit` | 50 | 3 | Incentivise reports, cap at 3/day to prevent spam |
| `screen_view_unique_per_day` | 2 | 20 | Reward exploration |
| `session_minute` | 1 | 60 | Engagement minutes |
| `comment_posted` | 10 | 5 | Community participation |
| `beta_tester_optin` | 100 | 1 | One-time onboarding bonus |

### Tier ladder

Build your progression curve. Each tier needs:

- **Slug** — URL-safe ID (immutable after creation)
- **Display name** — Shown to the user
- **Points threshold** — Minimum `total_points` to reach this tier
- **Host credit payload** — JSON blob forwarded in the webhook when this tier is reached; use it to pass `{ pro: true }` or `{ discount_pct: 30 }` to your app
- **Monetary reward (USD)** — Optional. Enqueues a Stripe Transfer when the user first enters the tier

**Example progression:**

| Tier | Points | Perks |
|---|---|---|
| Explorer | 100 | Access to beta features |
| Contributor | 500 | Early access to new lessons |
| Champion | 2,000 | Full Pro access + $5 gift card |

### Contributors

Searchable, paginated leaderboard of all identified users.

**Search and filter:**
- Type in the search box to filter by display name or external user ID (server-side, works for any table size)
- Use the tier filter to narrow to a specific tier or "No tier" (users with zero points)
- Switch the time range to see 30-day activity or all-time totals

**View modes:**
- **Ranked** — flat ordered list with rank numbers
- **By tier** — groups users under their tier header with per-group totals; useful when you have hundreds of users and want to understand the tier distribution at a glance

**At-risk indicator:** an orange dot next to a user means no activity in the last 7 days. These users are disengaging — consider a re-engagement campaign or manual bonus.

**Pagination:** 25 users per page. Works correctly with filters applied.

**Clicking a row** opens the contributor drawer.

#### Contributor drawer

Detailed profile for a single user:

- **KPIs** — total points, tier, first seen, last seen
- **Admin actions** (click "Admin actions" in the drawer header):
  - **Award bonus points** — manually add points (e.g. for exceptional feedback). Requires a reason. Logged as `bonus_manual` in `end_user_activity`.
  - **Override tier** — forcibly set a tier, bypassing the points threshold. Logged as `tier_override_manual`. Use for beta tester promotions or dispute resolutions.
- **Anti-fraud flags** — any flags set by the system
- **Activity log** — last 100 events in reverse-chronological order; expand each event to see the raw JSON metadata

### Quests

Multi-step goals that guide users through a flow (e.g. "Complete onboarding: visit /profile, then submit a report, then invite a friend").

Each step defines:
- **Action** — must match a `reward_rules.action`
- **Label** — human-readable step name shown to the user

When all steps complete in order, `completion_points` are awarded and a webhook fires.

**Best practices:**
- Keep steps to 3–5 actions
- Order steps to match the natural user flow
- Use `expires_after_days` to create urgency (e.g. "Complete within 7 days of first login")
- Use `repeatable: true` for monthly re-engagement challenges

### Retention analytics

Compares median active span (first seen → last seen) for users who reached the highest tier vs everyone else.

- **Retention lift** — `(top_tier_median / all_others_median - 1) × 100%`
- A lift ≥ +50% is a strong signal the rewards program is retaining power users
- A negative lift suggests top-tier users exhaust the reward system and disengage — add recurring perks or time-gated bonuses

The calculation uses the `end_users.first_seen_at` → `last_seen_at` span. Results are approximate until you have ≥ 20 users in the top tier.

### Sandbox simulator

Test your rule configuration before going live. Enter a hypothetical activity log (action + count), click **Run simulation**, and see:

- Total points the log would earn
- Which tier would be reached
- Per-action breakdown with daily-cap warnings
- The `host_credit_payload` that would fire to your webhook

No real user data is affected. Use this whenever you change `base_points` or tier thresholds.

### Settings

#### Webhooks

Register HTTPS endpoints to receive tier-change events. See [Webhooks](#webhooks) for the payload format.

To verify a webhook is working, click **Send test event** after creating one.

#### Identity providers

Link your auth provider's JWKS endpoint so Mushi can verify JWTs at ingest time. Supported out of the box:
- Apple Sign In
- Google Sign In
- Supabase Auth
- Custom OIDC

Required for rules with `requires_jwt_verification = true`. Events from unverified users are rejected with `rejected_reason = 'jwt_not_verified'`.

#### Payout liability

Overview of pending, processing, and completed Stripe payouts. Use this to track cash flow from your monetary rewards.

#### Disputes

Users can raise a dispute about a points decision. Admins can resolve or reject disputes from this section with a resolution note.

---

## API reference

All admin endpoints require a valid Mushi organisation JWT in the `Authorization: Bearer <token>` header.

### `GET /v1/admin/rewards/overview`

Returns KPI summary for the org.

```json
{
  "ok": true,
  "data": {
    "total_contributors": 247,
    "events_24h": { "total": 143, "accepted": 112, "rejected": 31 },
    "points_awarded_24h": 3840,
    "pending_payouts_usd": "25.00",
    "tier_distribution": [
      { "slug": "explorer", "display_name": "Explorer", "count": 180 },
      { "slug": "contributor", "display_name": "Contributor", "count": 55 },
      { "slug": "champion", "display_name": "Champion", "count": 12 }
    ]
  }
}
```

### `GET /v1/admin/rewards/leaderboard`

Paginated contributor leaderboard.

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `range` | `30d` | `30d` or `all` — sort column |
| `limit` | `50` | Rows per page (max 200) |
| `offset` | `0` | Pagination offset |
| `search` | — | Filter by display_name or external_user_id (ilike) |
| `tier` | — | Filter by tier slug; `none` for untiered users |

**Response:**

```json
{
  "ok": true,
  "data": [...],
  "meta": { "range": "30d", "limit": 25, "offset": 0, "total": 1847 }
}
```

### `GET /v1/admin/rewards/contributors/:id`

Full profile for one contributor. `id` is the internal `end_users.id` UUID.

Returns `profile`, `points` (with tier details), and `activity` (last 100 events).

### `POST /v1/admin/rewards/presets/apply`

One-click "enable rewards with recommended defaults". Idempotently inserts the
default rules (`report.submitted`, `report.triaged`, `comment_posted`) and a
4-tier ladder (Explorer → Contributor → Champion → Legend, each with a
`host_credit_payload` grant instruction). Only inserts actions/slugs that don't
already exist, so it's safe to re-run and never clobbers customisations.

```json
{
  "ok": true,
  "data": { "insertedRules": 3, "insertedTiers": 4, "skippedRules": 0, "skippedTiers": 0 }
}
```

### `POST /v1/admin/rewards/bonus-points`

Award points manually. Logs as `bonus_manual` in `end_user_activity`.

```json
{
  "end_user_id": "uuid",          // internal ID (preferred)
  "external_user_id": "user_123", // alternative: your app's user ID
  "points": 100,
  "reason": "Exceptional bug report"
}
```

### `POST /v1/admin/rewards/set-tier`

Override a user's tier directly, bypassing point thresholds. Logs as `tier_override_manual`.

```json
{
  "end_user_id": "uuid",
  "tier_slug": "champion",
  "reason": "Beta tester promotion"
}
```

### `POST /v1/admin/rewards/simulate`

Simulate a point tally without touching real data.

**Request:**
```json
{ "events": [{ "action": "report_submit", "count": 5 }, { "action": "session_minute", "count": 60 }] }
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "total_points": 310,
    "reached_tier": { "slug": "explorer", "display_name": "Explorer", "host_credit_payload": null },
    "next_tier": { "slug": "contributor", "display_name": "Contributor", "points_threshold": 500 },
    "breakdown": [
      { "action": "report_submit", "count": 5, "per_event": 50, "subtotal": 250, "capped": false, "unknown": false },
      { "action": "session_minute", "count": 60, "per_event": 1, "subtotal": 60, "capped": false, "unknown": false }
    ]
  }
}
```

### `GET /v1/admin/rewards/retention-impact`

Returns median active span for top-tier users vs all others.

```json
{
  "ok": true,
  "data": {
    "top_tier": { "slug": "champion", "display_name": "Champion", "count": 12, "median_retention_days": 67 },
    "all_others": { "count": 235, "median_retention_days": 14 },
    "lift_pct": 379
  }
}
```

---

## Webhooks

When a user's tier changes, Mushi sends a signed `POST` request to every enabled webhook in `reward_webhooks`.

### Creating a webhook (auto-minted secret)

`POST /v1/admin/rewards/webhooks` accepts an optional `secret`. **Omit it** and
Mushi mints a strong `mushi_whk_…` secret, stores the raw value in Supabase
Vault (`vault_secret_id`), and returns it **once** in the create response —
copy it then, it can't be retrieved again (only the SHA-256 `secret_hash` is
kept for display). At delivery time the edge function reads the raw secret back
from Vault to compute the signature, falling back to the
`MUSHI_REWARD_WEBHOOK_SECRET` env var for legacy hooks.

### Payload

The envelope is **flat** (it is not nested under `user` / `tier`):

```json
{
  "event": "reward.tier_changed",
  "occurred_at": "2026-05-17T06:00:00Z",
  "end_user_id": "end_user_uuid",
  "external_user_id": "user_123",
  "tier_after": { "slug": "champion", "display_name": "Champion", "perks": {} },
  "host_credit_payload": { "kind": "pro_coupon", "months": 1 },
  "webhookId": "webhook_uuid"
}
```

`event` is one of `reward.points_awarded`, `reward.tier_changed`,
`reward.payout_requested`, `reward.payout_paid`, `reward.quest_completed`.
`external_user_id` is present only when the reporter was JWT-identified.
`host_credit_payload` is your opaque "grant this" instruction, defined per tier
in the console.

### Receiving the webhook — `@mushi-mushi/node` (recommended)

The server SDK ships a framework-agnostic receiver that timing-safely verifies
the `X-Mushi-Signature` header and routes events to typed callbacks. This is the
Mushi → host-repo trigger for "grant a role / grant a Stripe membership".

```ts
import { createMushiRewardsHandler } from '@mushi-mushi/node'

const handler = createMushiRewardsHandler({
  secret: process.env.MUSHI_REWARD_WEBHOOK_SECRET!, // the minted mushi_whk_… value
  onTierChanged: async (event) => {
    // flat fields — host_credit_payload is your opaque grant instruction
    if (event.host_credit_payload?.kind === 'pro_coupon') {
      await grantProAccess(event.external_user_id)
    }
  },
  onPointsAwarded: async (event) => {
    // optional — fires on reward.points_awarded (report.submitted/triaged, etc.)
  },
})

// Next.js App Router / any Web-standard runtime:
export const POST = (req: Request) => handler.fetch(req)

// Express (express.raw is required so the raw body is available for HMAC verify):
// app.post('/api/mushi/reward-webhook', express.raw({ type: '*/*' }), handler.express)
```

A bad signature short-circuits with `401` before your callback runs.

### Manual verification (no SDK)

Every delivery includes an `X-Mushi-Signature` header: `sha256=<hmac>`.

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

function verifyMushiWebhook(body: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  // constant-time compare to avoid timing oracles
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// In your Next.js route handler:
export async function POST(req: Request) {
  const body = await req.text()
  const sig  = req.headers.get('X-Mushi-Signature') ?? ''
  if (!verifyMushiWebhook(body, sig, process.env.MUSHI_REWARD_WEBHOOK_SECRET!)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const event = JSON.parse(body)
  if (event.event === 'reward.tier_changed' && event.host_credit_payload?.kind === 'pro_coupon') {
    await grantProAccess(event.external_user_id)
  }
  return new Response('ok')
}
```

---

## Anti-fraud system

Every incoming activity event goes through a fraud pipeline before points are awarded:

1. **Opt-in gate** — `opted_in_to_rewards` must be `true`
2. **JWT verification** — if the rule requires it, the JWT is verified against the org's JWKS endpoint
3. **Daily cap** — per-user, per-action daily limit from `reward_rules.max_per_day`
4. **Lifetime cap** — per-user, per-action lifetime limit from `reward_rules.max_per_user_lifetime`
5. **Rule enabled check** — disabled rules reject all events
6. **Fraud flags** — if `end_users.anti_fraud_flags` is non-empty, events are logged but withheld

**Rejection reasons** written to `end_user_activity.rejected_reason`:

| Code | Meaning |
|---|---|
| `not_opted_in` | User hasn't opted in to rewards |
| `no_rule` | No matching `reward_rules.action` |
| `rule_disabled` | Rule exists but `enabled = false` |
| `daily_cap_exceeded` | User hit the daily cap for this action |
| `lifetime_cap_exceeded` | User hit the lifetime cap |
| `jwt_not_verified` | Rule requires JWT verification; JWT missing or invalid |
| `fraud_flag` | User has one or more anti-fraud flags set |

**Viewing fraud flags in the console:** open the Contributor drawer for any user. Anti-fraud flags are shown prominently in the profile section. You can resolve them via the Disputes tab.

---

## Monetary payouts

If a `reward_tiers.monetary_reward_usd` is set, Mushi enqueues a `reward_payouts` row when a user first reaches that tier.

The payout flow:

```
tier_changed event
  → check monetary_reward_usd > 0
  → insert reward_payouts (status = 'pending')
  → Stripe Transfer job picks it up (background, not yet automated)
  → status transitions: pending → processing → paid / withheld / failed
```

**Current status:** The payout queue is live and tracking is visible in the admin console Settings → Payout liability section. Automated Stripe Transfer execution requires a Stripe Connect integration — contact the team or implement the transfer in your webhook handler by reading the `host_credit_payload`.

**Dispute flow:** Users can dispute a payout decision. Open disputes appear in Settings → Disputes and can be resolved or rejected with a note.

---

## Quests

Quests are multi-step journeys that guide users through high-value flows and award bonus points on completion.

### Creating a quest

```json
POST /v1/admin/rewards/quests
{
  "name": "Complete your first week",
  "description": "Explore the core features in your first 7 days",
  "completion_points": 200,
  "expires_after_days": 7,
  "repeatable": false,
  "steps": [
    { "action": "screen_view_unique_per_day", "label": "Visit the dashboard" },
    { "action": "report_submit",              "label": "Submit your first report" },
    { "action": "comment_posted",             "label": "Leave a comment on a report" }
  ]
}
```

### Step matching

Steps are evaluated in order. A step is complete when an accepted `end_user_activity` row with the matching `action` is written **after** the previous step's timestamp. If `metadata_match` is set, the event's `metadata` field must contain all matching key-value pairs.

```json
{ "action": "screen_view_unique_per_day", "label": "Visit /pricing", "metadata_match": { "screen": "/pricing" } }
```

---

## Sandbox simulator

Use the simulator tab (admin console → Simulator) before changing rules in production.

**Workflow:**

1. Open the Simulator tab
2. Enter the event mix you want to model (action + count)
3. Click **Run simulation**
4. Review the point breakdown — check for `daily_cap_applied` warnings
5. Adjust `base_points` or caps in Activity rules until the simulation produces the desired tier outcome
6. Save the rule changes and run the simulator again to confirm

The simulator uses the **current live rules** from your database. It does not persist any data.

---

## Retention analytics

The Retention tab shows whether top-tier users retain longer than average — the primary ROI signal for the rewards program.

**Interpretation guide:**

| Lift | Signal | Recommended action |
|---|---|---|
| ≥ +50% | Strong — rewards are retaining power users | Scale the program; add higher tiers or recurring perks |
| +10% – +49% | Positive | Continue; consider adding re-engagement quests |
| -5% – +9% | Neutral | Review tier thresholds; top tier may be too easy to reach |
| < -5% | Negative — top users disengage after reaching top tier | Add recurring monthly bonuses; introduce a "Prestige" tier |

The calculation requires `end_users.first_seen_at` and `last_seen_at` to span multiple days. Accuracy improves above 20 users in the top tier.

---

## Scaling to thousands of users

The rewards system is designed to handle large user bases without degradation.

### Database indexes

The `end_user_points` table has a composite index on `(organization_id, total_points DESC)` and `(organization_id, points_30d DESC)` to support fast leaderboard queries without full table scans. The `end_user_activity` table has an index on `(end_user_id, created_at DESC)` for per-user activity lookups.

### Admin console pagination

The `/v1/admin/rewards/leaderboard` endpoint uses PostgreSQL's `LIMIT`/`OFFSET` with `count: 'exact'` to return paginated results and the total count in a single query. The admin console displays 25 rows per page with page controls and shows the total count at the top of the table.

### Search

Server-side `ilike` search on `end_users.display_name` and `end_users.external_user_id` via Supabase's referenced-table filter. For very large installations (>100K users), consider adding a GIN trigram index:

```sql
CREATE INDEX end_users_display_name_trgm_idx
  ON end_users USING gin (display_name gin_trgm_ops);
CREATE INDEX end_users_external_user_id_trgm_idx
  ON end_users USING gin (external_user_id gin_trgm_ops);
```

### Tier grouping view

The "By tier" view in the Contributors tab groups the **current page** of results by tier client-side. For a complete per-tier count, use the Overview tab's Tier distribution stat cards, which aggregate the full table in one query.

### Activity log retention

`end_user_activity` rows have a `retain_until` column (default: 90 days from creation). Run a periodic cleanup job to prune expired rows:

```sql
-- Run weekly via pg_cron
DELETE FROM end_user_activity WHERE retain_until < now();
```

### Point evaluation

The server re-evaluates tier thresholds every time `end_user_points` is updated. For very high-volume apps (>10 events/second per user), consider batching point updates with a queue — the current design is append-first, so there is no risk of data loss if an evaluation is delayed.
