/**
 * FILE: apps/admin/src/components/rewards/rewardsView.ts
 * PURPOSE: Plain rules behind what the Rewards tabs may claim (round-2 sweep, 2026-11-18):
 *   - retention lift is "Not enough data" when its base is 0 or a cohort is empty,
 *     never "+45708510%" over "Others median 0d";
 *   - a 30-day points cell for a tester not seen in 30 days is stale, not a number;
 *   - while the app's rewards are off, bounty and quest rows read "Paused";
 *   - anti-fraud flags are warnings, not failures;
 *   - the simulator starts from the action names the live feed uses.
 */

const DAY_MS = 86_400_000

// ─── Retention lift ──────────────────────────────────────────

export interface RetentionData {
  top_tier?: { slug: string; display_name: string; count: number; median_retention_days: number } | null
  all_others?: { count: number; median_retention_days: number } | null
  lift_pct?: number | null
}

/** Below this many users in a cohort its median says nothing. */
const RETENTION_MIN_COHORT = 5

export type RetentionLift =
  | { kind: 'insufficient'; reason: string }
  | { kind: 'lift'; pct: number; tone: 'ok' | 'warn' | 'danger'; strong: boolean; negative: boolean }

export function retentionLift(data: RetentionData | null | undefined): RetentionLift {
  const top = data?.top_tier
  const rest = data?.all_others
  if (!top || !rest) return { kind: 'insufficient', reason: 'No tiers are set up, so there is no top tier to compare.' }
  if (top.count < RETENTION_MIN_COHORT || rest.count < RETENTION_MIN_COHORT) {
    return {
      kind: 'insufficient',
      reason: `Each group needs at least ${RETENTION_MIN_COHORT} testers (now ${top.count} in ${top.display_name}, ${rest.count} others).`,
    }
  }
  // The server divides by the unrounded median; a base under a day prints as "0d" and
  // turns a few hours into a 45,708,510% lift.
  if (!(rest.median_retention_days >= 1)) {
    return { kind: 'insufficient', reason: 'Other testers stay less than a day, so a lift over that base means nothing yet.' }
  }
  const pct = data?.lift_pct
  if (pct == null || !Number.isFinite(pct)) return { kind: 'insufficient', reason: 'The lift could not be computed.' }
  return {
    kind: 'lift',
    pct,
    tone: pct >= 20 ? 'ok' : pct < 0 ? 'danger' : 'warn',
    strong: pct >= 50,
    negative: pct < 0,
  }
}

// ─── Contributors ────────────────────────────────────────────

export type PointsCell = { kind: 'value'; points: number } | { kind: 'stale'; points: number }

/**
 * The leaderboard's 30-day points come from a stored column the server should recount
 * daily. A tester last seen more than 30 days ago cannot have earned them in the last
 * 30 days, so the cell is stale (2026-11-18: "9,777 pts (30d)" beside "5 months ago").
 */
export function points30dCell(points30d: number, lastSeenAt: string | null | undefined, now = Date.now()): PointsCell {
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN
  if (points30d > 0 && Number.isFinite(seen) && now - seen > 30 * DAY_MS) return { kind: 'stale', points: points30d }
  return { kind: 'value', points: points30d }
}

/** The server counts tier holders from its first 500 rows. */
const TIER_DISTRIBUTION_ROW_CAP = 500

export function tierHoldersLabel(totalHolders: number): string {
  if (totalHolders >= TIER_DISTRIBUTION_ROW_CAP) return `First ${TIER_DISTRIBUTION_ROW_CAP.toLocaleString()} tier holders counted`
  return `${totalHolders.toLocaleString()} tier holder${totalHolders === 1 ? '' : 's'} · all time`
}

/** "velocity_anomaly" → "velocity anomaly". */
export function flagLabel(flag: string): string {
  return flag.replace(/[_-]+/g, ' ').trim()
}

// ─── Program off ─────────────────────────────────────────────

/** Rewards are paused for the open app: entitled, an app is picked, and its switch is off. */
export function rewardsPaused(input: { entitled: boolean; projectId: string | null; projectEnabled: boolean }): boolean {
  return input.entitled && input.projectId != null && !input.projectEnabled
}

export type RowState = { label: string; tone: 'on' | 'off' | 'paused' }

export function bountyRowState(enabled: boolean, paused: boolean): RowState {
  if (!enabled) return { label: 'Off', tone: 'off' }
  return paused ? { label: 'Paused', tone: 'paused' } : { label: 'On', tone: 'on' }
}

export function questRowState(enabled: boolean, paused: boolean): RowState {
  if (!enabled) return { label: 'Disabled', tone: 'off' }
  return paused ? { label: 'Paused', tone: 'paused' } : { label: 'Active', tone: 'on' }
}

/** Why Publish is greyed out, said once beside it. */
export function publishBlockedReason(hasListing: boolean, name: string): string | null {
  if (!hasListing) return 'Save a draft below first.'
  if (!name.trim()) return 'Add an app name first.'
  return null
}

// ─── Simulator ───────────────────────────────────────────────

/** The actions the pipeline and SDK actually send (the feed shows these). */
export const DEFAULT_SIM_LINES: ReadonlyArray<{ action: string; count: number }> = [
  { action: 'report.submitted', count: 5 },
  { action: 'report.triaged', count: 2 },
  { action: 'session_minute', count: 60 },
  { action: 'screen_view_unique_per_day', count: 20 },
]

/** Action names to suggest: rules first, then the 24 h feed, then the defaults; no repeats. */
export function knownActionNames(
  rules: ReadonlyArray<{ action: string }> | null | undefined,
  feedActions: ReadonlyArray<{ action: string }> | null | undefined,
): string[] {
  const out: string[] = []
  for (const a of [...(rules ?? []), ...(feedActions ?? []), ...DEFAULT_SIM_LINES]) {
    const name = a.action.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

// ─── Tester review ───────────────────────────────────────────

export type ListingState = 'live' | 'unpublished' | 'unknown'

export function listingState(app: { visibility: 'draft' | 'public' | 'paused' } | null | undefined, error: string | null | undefined): ListingState {
  if (error) return 'unknown'
  if (app === undefined) return 'unknown'
  return app?.visibility === 'public' ? 'live' : 'unpublished'
}

export function reviewEmptyCopy(status: 'pending' | 'accepted' | 'all', listing: ListingState): { title: string; description: string } {
  if (status === 'accepted') {
    return { title: 'No accepted submissions yet', description: 'Accept a pending submission and it shows here.' }
  }
  if (status === 'pending') {
    return {
      title: 'Nothing to review',
      description: listing === 'live' ? 'New tester submissions show up here for grading.' : 'Testers can send submissions once your listing is published.',
    }
  }
  return {
    title: 'No submissions yet',
    description: listing === 'live' ? 'Testers find your app on the marketplace; their reports land here.' : 'Testers can send submissions once your listing is published.',
  }
}
