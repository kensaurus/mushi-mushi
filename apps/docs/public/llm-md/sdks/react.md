# @mushi-mushi/react

Source: https://kensaur.us/mushi-mushi/docs/sdks/react

---
title: '@mushi-mushi/react'
---

# `@mushi-mushi/react`

React provider + hooks. Wraps `@mushi-mushi/web`.

```tsx
import {
  MushiProvider,
  useMushi,
  useMushiReport,
  useReputation,
  useTier,
  MushiRewardsBadge,
} from '@mushi-mushi/react'
```

| Export                  | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| ``       | App-level boot — accepts the same config as core      |
| `useMushi()`            | Access the singleton (rate-limit aware, suspense-safe)|
| `useMushiReport()`      | Returns `{ submit, isSubmitting, lastError }`         |
| `useReputation()`       | Current user's point totals (polls on mount)          |
| `useTier()`             | Current user's tier object (polls on mount)           |
| `` | Polymorphic tier + points badge component             |

See [Quickstart → React](/quickstart/react).

---

## Identifying users

Call `mushi.identify()` on auth state change — typically inside a
`useEffect` that watches your auth context:

```tsx filename="lib/auth-watcher.tsx"

import { useSession } from './auth'  // your auth hook

  const sdk = useMushi()
  const { user } = useSession()

  useEffect(() => {
    if (user && sdk) {
      sdk.identify(user.id, {
        email: user.email,
        name: user.name,
        provider: 'supabase',
      })
    }
  }, [user, sdk])

  return null
}
```

Mount `` inside `` so `sdk` is always defined.

---

## Enabling the Rewards program

```tsx filename="app/layout.tsx"

  return (
    
      {children}
    
  )
}
```

---

## `useReputation()`

Returns the current user's reputation totals, or `null` if rewards are
disabled or no user has been identified.

```tsx

function PointsDisplay() {
  const reputation = useReputation()
  if (!reputation) return null

  return (
    
      {reputation.totalPoints.toLocaleString()} pts total ·{' '}
      {reputation.points30d} this month
    
  )
}
```

**Return type:**

```typescript
interface MushiReputationResult {
  totalPoints: number     // all-time total (never negative)
  points30d: number       // rolling 30-day window
  reputation: number      // anonymous token-hash reputation score
  confirmedBugs: number   // reports that reached 'confirmed' or 'fixed'
  totalReports: number    // all reports submitted
}
```

---

## `useTier()`

Returns the current user's tier, or `null`.

```tsx

function TierBanner() {
  const tier = useTier()
  if (!tier) return null
  return You're a {tier.displayName}!
}
```

**Return type:**

```typescript
interface MushiTierResult {
  id: string               // DB UUID
  slug: string             // 'free' | 'explorer' | 'contributor' | 'champion'
  displayName: string      // e.g. 'Explorer'
  pointsThreshold: number  // minimum points to reach this tier
  perks: Record<string, unknown>  // your custom perks payload
}
```

---

## ``

Drop-in badge that renders the current user's tier name (and optionally
their point total). Polymorphic — renders as a `` by default.

```tsx

// Minimal — just the tier name

// With point count

// As a div, with custom class

```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `as` | `ElementType` | `'span'` | Rendered HTML/React element |
| `showPoints` | `boolean` | `false` | Append ` · N pts` to the tier name |
| `loadingFallback` | `ReactNode` | `null` | Rendered while tier data is loading |
| `className` | `string` | — | CSS class on the outer element |

The badge colour is driven by tier slug (`free` → grey, `explorer` → blue,
`contributor` → purple, `champion` → amber). Override with CSS if needed.

---

## Submitting custom activity

Access the singleton to fire custom events:

```tsx

function LessonCard({ lessonId }) {
  const sdk = useMushi()

  const onComplete = async () => {
    await sdk?.submitActivity([
      { action: 'lesson_complete', metadata: { lessonId } },
    ])
  }

  return Complete lesson
}
