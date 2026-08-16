/**
 * FILE: apps/admin/src/lib/heartbeat.ts
 * PURPOSE: Single source of truth for "is this project's SDK actually talking
 *          to us?" — the recency window applied to `project_api_keys.last_seen_at`.
 *
 * Why this exists: three surfaces (Overview portfolio cards, the Projects tab
 * rail, and the project-switcher status chip) each used to collapse the
 * heartbeat to a boolean — or ignore it entirely — so a project that had never
 * once connected rendered as a green "Healthy". Connectivity is a *recency*
 * question, not a truthiness one, and all three surfaces must answer it the
 * same way or the console contradicts itself.
 *
 * The `unknown` state is load-bearing: a backend that has not yet shipped the
 * `last_seen_at` field sends `undefined` (key absent), which is NOT evidence of
 * a missing heartbeat. Callers must render no connectivity claim at all in that
 * case rather than defaulting to "Not connected" and reporting every project as
 * dead. An explicit `null` is the deployed backend saying "never seen".
 */

/** Heartbeat freshness buckets. Ordered most-alive → least-alive. */
export type HeartbeatState =
  /** Field absent from the payload — backend predates the heartbeat column. */
  | 'unknown'
  /** Seen within the last 24h. */
  | 'fresh'
  /** Seen 24h–7d ago — probably fine, worth an amber nudge. */
  | 'stale'
  /** Seen, but more than 7d ago — the install has gone quiet. */
  | 'dead'
  /** Explicitly never seen (`null`), or no live keys exist at all. */
  | 'never'

export const HEARTBEAT_FRESH_MS = 24 * 60 * 60 * 1000
export const HEARTBEAT_STALE_MS = 7 * 24 * 60 * 60 * 1000

/** Shape of an API key row as the admin payload delivers it. */
export interface HeartbeatKeyLike {
  last_seen_at?: string | null
  is_active?: boolean
  revoked?: boolean
}

/** A key still counts toward connectivity unless it is revoked/deactivated. */
export function isLiveKey(key: HeartbeatKeyLike): boolean {
  return !key.revoked && key.is_active !== false
}

/**
 * Classify a single `last_seen_at` timestamp.
 *
 * `undefined` → `unknown` (field absent), `null` → `never` (deployed backend
 * says the key has never authenticated). Unparseable timestamps degrade to
 * `never` rather than throwing — a corrupt value is not a heartbeat.
 */
export function heartbeatStateFromTimestamp(
  lastSeenAt: string | null | undefined,
  now: number = Date.now(),
): HeartbeatState {
  if (lastSeenAt === undefined) return 'unknown'
  if (lastSeenAt === null) return 'never'

  const seen = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(seen)) return 'never'

  // Clock skew (server slightly ahead of the browser) must read as fresh, not
  // as a negative age that falls through to a staler bucket.
  const age = Math.max(0, now - seen)
  if (age < HEARTBEAT_FRESH_MS) return 'fresh'
  if (age < HEARTBEAT_STALE_MS) return 'stale'
  return 'dead'
}

/**
 * Collapse a project's key list to one connectivity verdict: the freshest
 * heartbeat among keys that are still live.
 *
 * A project with zero live keys returns `never` — that is the most
 * disconnected state a project can be in, and it must warn rather than pass
 * silently. `undefined` (no `api_keys` field at all) returns `unknown`.
 */
export function heartbeatStateFromKeys(
  keys: readonly HeartbeatKeyLike[] | null | undefined,
  now: number = Date.now(),
): HeartbeatState {
  if (keys == null) return 'unknown'

  const live = keys.filter(isLiveKey)
  if (live.length === 0) return 'never'

  let best: HeartbeatState = 'never'
  for (const key of live) {
    const state = heartbeatStateFromTimestamp(key.last_seen_at ?? null, now)
    if (HEARTBEAT_RANK[state] < HEARTBEAT_RANK[best]) best = state
  }
  return best
}

/** Sort/priority order — lower is healthier. `unknown` never wins a merge. */
const HEARTBEAT_RANK: Record<HeartbeatState, number> = {
  fresh: 0,
  stale: 1,
  dead: 2,
  never: 3,
  unknown: 4,
}

/** True when the state is a real signal worth rendering a badge for. */
export function isKnownHeartbeat(state: HeartbeatState): boolean {
  return state !== 'unknown'
}

/** Short human labels — shared so the three surfaces use identical wording. */
export const HEARTBEAT_LABEL: Record<Exclude<HeartbeatState, 'unknown'>, string> = {
  fresh: 'Connected',
  stale: 'Quiet 24h+',
  dead: 'Silent',
  never: 'Not connected',
}

/** One-line explanation for tooltips. */
export const HEARTBEAT_HINT: Record<Exclude<HeartbeatState, 'unknown'>, string> = {
  fresh: 'The SDK checked in within the last 24 hours.',
  stale: 'No SDK check-in for over a day — deploys may have dropped the snippet.',
  dead: 'No SDK check-in for over a week — this install has gone quiet.',
  never: 'No SDK has ever authenticated with this project’s keys.',
}
