# React & Next.js bug reporting SDK

Source: https://kensaur.us/mushi-mushi/docs/sdks/react

---
title: React & Next.js bug reporting SDK
description: Reference for @mushi-mushi/react, Mushi Mushi for React. MushiProvider, useMushi, useMushiSdk and useMushiReport hooks, user identity, rewards hooks and badge.
---

# `@mushi-mushi/react`

The Mushi Mushi React provider and hooks. Wraps `@mushi-mushi/web`.

```tsx
import {
  MushiProvider,
  useMushi,
  useMushiSdk,
  useMushiReport,
  useReputation,
  useTier,
  MushiRewardsBadge,
} from '@mushi-mushi/react'
```

| Export                  | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `` | App-level boot; `config` takes the same options as `Mushi.init` |
| `useMushi()`            | Returns `{ report, pulseTrigger, isReady, … }`; `report()` opens the widget |
| `useMushiSdk()`         | The SDK instance (`captureEvent`, `captureException`, `identify`), or `null` before init |
| `useMushiReport()`      | Returns a function that opens the widget, optionally with a category |
| `useReputation()`       | Current user's point totals (fetched once when the SDK is ready) |
| `useTier()`             | Current user's tier object (fetched once when the SDK is ready) |
| `` | Polymorphic tier + points badge component             |
| `useMushiReady()`       | `true` once the SDK has initialised                   |
| `useMushiTrack()`       | Returns `track(event, properties)` for [product analytics](/sdks/analytics) |
| ``        | Polymorphic element (a `` by default) that opens the reporter on click; optional `category` |
| `` | Renders nothing; opens the reporter when the element matching `selector` is clicked |
| ``  | Error boundary with `fallback` and `onError`; attaches the caught error to the next report's metadata |

See [Quickstart → React](/quickstart/react).

---

## Identifying users

Call `identify()` on the SDK instance when auth state changes, typically
inside a `useEffect` that watches your auth context:

```tsx filename="lib/auth-watcher.tsx"
import { useEffect } from 'react'
import { useMushiSdk } from '@mushi-mushi/react'
import { useSession } from './auth'  // your auth hook

export function AuthWatcher() {
  const sdk = useMushiSdk()
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

Mount `` inside ``; `sdk` is `null` until the
provider has initialised, and the effect re-runs once it is ready.

---

## Enabling the Rewards program

```tsx filename="app/layout.tsx"
import { MushiProvider } from '@mushi-mushi/react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <MushiProvider
      config={{
        projectId: 'YOUR_PROJECT_ID',
        apiKey: 'mushi_...',
        rewards: {
          enabled: true,
          trackActivity: true,
          consentMode: 'explicit',
          showInWidget: true,
        },
      }}
    >
      {children}
    </MushiProvider>
  )
}
```

---

## `useReputation()`

Returns the current user's reputation totals, or `null` if rewards are
disabled or no user has been identified.

```tsx
import { useReputation } from '@mushi-mushi/react'

function PointsDisplay() {
  const reputation = useReputation()
  if (!reputation) return null

  return (
    <p>
      {reputation.totalPoints.toLocaleString()} pts total ·{' '}
      {reputation.points30d} this month
    </p>
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
import { useTier } from '@mushi-mushi/react'

function TierBanner() {
  const tier = useTier()
  if (!tier) return null
  return <p>You're a {tier.displayName}!</p>
}
```

**Return type:**

```typescript
interface MushiTierResult {
  id: string               // DB UUID
  slug: string             // defined per project, e.g. 'explorer'
  displayName: string      // e.g. 'Explorer'
  pointsThreshold: number  // minimum points to reach this tier
  perks: Record<string, unknown>  // your custom perks payload
}
```

---

## ``

Drop-in badge that renders the current user's tier name (and optionally
their point total). It is polymorphic and renders as a `` by default.

```tsx
import { MushiRewardsBadge } from '@mushi-mushi/react'

// Minimal: just the tier name
<MushiRewardsBadge />

// With point count
<MushiRewardsBadge showPoints />

// As a div, with custom class
<MushiRewardsBadge as="div" className="my-badge" showPoints />
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `as` | `ElementType` | `'span'` | Rendered HTML/React element |
| `showPoints` | `boolean` | `false` | Append ` · N pts` to the tier name |
| `loadingFallback` | `ReactNode` | `null` | Rendered while tier data is loading |
| `className` | `string` | — | CSS class on the outer element |

A small dot before the name is coloured by tier slug (`free` → grey,
`explorer` → blue, `contributor` → purple, `champion` → amber, any other slug
→ violet). The colour is an inline style on the dot.

---

## Submitting custom activity

Use the SDK instance to record a custom rewards activity:

```tsx
import { useMushiSdk } from '@mushi-mushi/react'

function LessonCard({ lessonId }) {
  const sdk = useMushiSdk()

  const onComplete = () => {
    sdk?.recordActivity('lesson_complete', { lessonId })
  }

  return <button onClick={onComplete}>Complete lesson</button>
}
