# Rewards & contributor identity

Source: https://kensaur.us/mushi-mushi/docs/concepts/rewards

---
title: Rewards & contributor identity
description: How the Mushi Mushi rewards program works. Reporters earn points for reports and triage, climb project-defined tiers, and get perks from your app via webhooks.
---

# Rewards & contributor identity

Reporters earn points when they submit and when triage completes. Points
climb a project-defined tier ladder and can grant host-app perks (roles,
credits) via signed webhooks — so good reports pay off without inventing a
second product.

---

## Design principles

1. **Identity is optional but cumulative.** An anonymous user who later calls
   `identify()` does not lose credit for their prior activity. The server
   back-patches the `end_user_id` on pre-existing reports and activity events
   using the stable `reporter_token_hash` as the bridge.

2. **Awards are server-authoritative.** Points are never computed in the SDK.
   The SDK sends raw events; a PostgreSQL trigger (`private.apply_activity_points`)
   applies the rules atomically. This means your cap and multiplier logic is
   tamper-proof even if the SDK is patched by the user.

3. **Anti-gaming composability.** Rewards reuse the existing anonymous
   reputation scorer (see [Anti-gaming & reputation](/concepts/anti-gaming)).
   A reporter whose token-hash reputation drops below −100 has their activity
   events accepted but scored at 0 until their reputation recovers. They cannot
   farm points by spamming bad reports.

4. **Privacy first.** No PII is required. If `identify()` is called without
   `email` or `name` traits, `end_users.email` and `display_name` remain null.
   The Contributors leaderboard shows an anonymised handle in that case
   (`User-a4f3` from the last 4 chars of `external_user_id`).

---

## Data model

```
end_users
  id                   uuid PK
  organization_id      uuid FK → organizations
  external_user_id     text   — the ID from your auth provider
  display_name         text?
  email                text?
  provider             text?  — 'google' | 'apple' | 'supabase' | …
  opted_in             boolean
  jwt_verified_at      timestamptz? — set when P2 host JWT is verified
  reporter_token_hash  text?  — bridges anonymous activity
  last_seen_at         timestamptz
  created_at           timestamptz
  updated_at           timestamptz

end_user_activity
  id                   uuid PK
  end_user_id          uuid FK → end_users
  organization_id      uuid FK → organizations
  action               text   — matches a reward_rules.action
  points_awarded       int    — 0 if capped or anti-gamed
  metadata             jsonb
  occurred_at          timestamptz

end_user_points
  end_user_id          uuid PK FK → end_users (1:1)
  organization_id      uuid
  total_points         int   — all-time, always ≥ 0
  points_30d           int   — rolling 30-day window
  points_lifetime      int   — synonym for total (never reset)
  updated_at           timestamptz

reward_rules
  id                   uuid PK
  organization_id      uuid FK → organizations
  action               text   — e.g. 'page_view', 'report_submit'
  base_points          int    — negative = deduction
  max_per_day          int?
  max_per_user_lifetime int?
  multiplier_eligible  boolean
  requires_jwt_verification boolean
  enabled              boolean

reward_tiers
  id                   uuid PK
  organization_id      uuid FK → organizations
  slug                 text   — 'free' | 'explorer' | 'contributor' | 'champion'
  display_name         text
  points_threshold     int
  perks                jsonb
  multiplier           numeric  — point multiplier for eligible rules
  sort_order           int
```

---

## Server-side award flow

```mermaid
flowchart TD
  A["POST /v1/sdk/activity"] --> B{API key valid?}
  B -- no --> X1[401]
  B -- yes --> C[resolveEndUser]
  C --> D{end_user exists?}
  D -- no --> E[INSERT end_users]
  D -- yes --> F[UPDATE last_seen_at]
  E --> G[awardPointsForEndUser]
  F --> G
  G --> H{rule exists + enabled?}
  H -- no --> I[skip event]
  H -- yes --> J{daily cap reached?}
  J -- yes --> K[insert 0-pt activity row]
  J -- no --> L{user anti-gamed?}
  L -- yes --> K
  L -- no --> M[compute points with tier multiplier]
  M --> N[INSERT end_user_activity]
  N --> O[trigger: apply_activity_points]
  O --> P[UPSERT end_user_points]
  P --> Q{threshold crossed?}
  Q -- yes --> R[fire tier_up webhook]
  Q -- no --> S[done]
```

Key guarantee: each `end_user_activity` insert triggers
`private.apply_activity_points` in the same transaction, so `end_user_points`
is always consistent — there is no separate aggregation job to fall behind.

---

## SDK-side flow

```mermaid
sequenceDiagram
  participant Auth as Auth layer (your app)
  participant Mushi as Mushi SDK
  participant Buffer as Local buffer
  participant API as Mushi API

  Auth->>Mushi: identify(userId, { email, name })
  Mushi->>Buffer: flush queued anonymous events (if any)
  Mushi->>API: POST /v1/sdk/activity { user_id, user_traits, events }
  Note over Mushi: starts trackActivity loop (if enabled)
  Mushi->>Buffer: accumulate route / click / dwell events
  Mushi->>API: flush every flushIntervalMs (default 5 min)
```

`trackActivity: true` in `MushiRewardsConfig` auto-captures:

- `session_minute`: once a minute while the user is active and opted in, up to a
  daily cap
- `screen_view_unique_per_day`: the first view of each route per day
- `element_selected`: clicks on elements with a `data-testid` attribute

For custom actions, call `Mushi.recordActivity('lesson_completed', { … })`. The SDK
batches these and sends them to `POST /v1/sdk/activity`. In React Native, each
`setScreen()` change counts as a page view.

---

## Identity verification (P2 — monetary awards)

When monetary payouts are enabled, a rule marked `requires_jwt_verification:
true` will not award points unless a host-app JWT is present and valid.

```mermaid
sequenceDiagram
  SDK->>App: verifyUserToken() callback
  App-->>SDK: JWT (from your auth provider)
  SDK->>API: POST /v1/sdk/activity { host_jwt: "…", events }
  API->>JWKS: verify JWT signature + expiry
  JWKS-->>API: claims { sub, email }
  API->>DB: update end_users.jwt_verified_at
  API->>DB: award points (bypasses jwt_verified_at gate)
```

The JWKS endpoint for your auth provider is registered once in the admin
console under **Rewards → Settings → Identity Providers**. Supported providers:
Supabase Auth, Apple Sign In, Google Sign In, and any provider that serves a
standard `/.well-known/jwks.json`.

---

## Tier multipliers

When a user reaches a tier with `multiplier > 1`, all subsequent
`multiplier_eligible` rule awards are scaled:

```
points_awarded = floor(base_points × tier.multiplier)
```

Example: an Explorer (multiplier 1.0) earns 2 pts for a `page_view`. A
Champion (multiplier 2.0) earns 4 pts for the same action.

Non-eligible rules (e.g. anti-gaming deductions) are always applied at face
value — multipliers cannot amplify a penalty.

---

## Anti-gaming integration

The rewards system inherits all guarantees from the
[anti-gaming pipeline](/concepts/anti-gaming):

- The `reporter_token_hash` reputation gate blocks known bad actors from
  accruing points even before their `end_users` record is created.
- Activity events from tokens flagged `spam` or `rate_limited` are stored with
  `points_awarded = 0` so the audit trail is complete without the fraud being
  rewarded.
- The `detect-reward-anomalies` cron (`private.detect_reward_anomalies()`, daily
  at 04:00 UTC) flags users whose 30-day points are more than 5× their
  organization's median with `velocity_anomaly` in `end_users.anti_fraud_flags`.
  Flagged users can still earn but cannot withdraw monetary rewards; the flag
  clears when they fall back below the threshold. Disputes are reviewed in
  `reward_disputes`.
- Monthly org caps in `project_settings` put a hard ceiling on total points
  issued in a calendar month — protecting you from an unexpected viral spike.

---

## Webhooks reference

Register webhook endpoints in the admin console on the **Rewards** page. All
payloads are `POST`, `Content-Type: application/json`, and signed with
`X-Mushi-Signature: sha256=`. `@mushi-mushi/node`
exports `createMushiRewardsHandler` to verify and route them.

Every payload carries `event`, `end_user_id`, `occurred_at` and `webhookId`, plus
the event's own fields. A webhook with an empty event list receives every event.

Two events are sent today:

### `reward.tier_changed`

```json
{
  "event": "reward.tier_changed",
  "end_user_id": "6f1c0d3e-…",
  "tier_before": { "slug": "explorer", "display_name": "Explorer" },
  "tier_after": { "slug": "contributor", "display_name": "Contributor", "perks": {} },
  "host_credit_payload": { "kind": "role", "role": "contributor" },
  "occurred_at": "2026-05-17T12:34:56Z",
  "webhookId": "…"
}
```

### `reward.quest_completed`

```json
{
  "event": "reward.quest_completed",
  "end_user_id": "6f1c0d3e-…",
  "quest_id": "quest_001",
  "quest_name": "First Feedback",
  "bonus_points": 100,
  "occurred_at": "2026-05-17T12:34:56Z",
  "webhookId": "…"
}
```

`reward.points_awarded`, `reward.payout_requested` and `reward.payout_paid` are
reserved event names you can subscribe to, but nothing sends them yet.
