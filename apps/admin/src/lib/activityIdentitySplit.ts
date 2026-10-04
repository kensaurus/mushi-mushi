/**
 * FILE: apps/admin/src/lib/activityIdentitySplit.ts
 * PURPOSE: The /activity "Who uses the app" split, counted in people, not
 *          sessions (QA 289).
 *
 * `user_split.identified` / `.anonymous` count SESSIONS: one signed-in user
 * with 40 visits read "Identified: 40", and the percentage disagreed with the
 * "N identified" stat above it. Migration 20261004163000 adds
 * `identified_people` (distinct signed-in users) and `anonymous_devices`
 * (distinct devices that never signed in). Until it is applied the split
 * still shows, labelled as sessions so it never claims to count people.
 */

export interface UserSplitPayload {
  identified: number
  anonymous: number
  identified_people?: number | null
  anonymous_devices?: number | null
}

export interface IdentitySplit {
  unit: 'people' | 'sessions'
  identified: number
  anonymous: number
  identifiedLabel: string
  anonymousLabel: string
  /** Share identified, 0-100; null when there is nothing to split. */
  identifiedPct: number | null
}

export function identitySplit(split: UserSplitPayload): IdentitySplit {
  const people = split.identified_people != null && split.anonymous_devices != null
  const identified = people ? Number(split.identified_people) : split.identified
  const anonymous = people ? Number(split.anonymous_devices) : split.anonymous
  const total = identified + anonymous
  return {
    unit: people ? 'people' : 'sessions',
    identified,
    anonymous,
    identifiedLabel: people ? 'Signed-in people' : 'Signed-in sessions',
    anonymousLabel: people ? 'Anonymous devices' : 'Anonymous sessions',
    identifiedPct: total > 0 ? Math.round((identified / total) * 100) : null,
  }
}
