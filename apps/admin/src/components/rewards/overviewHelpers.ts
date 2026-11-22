/**
 * FILE: apps/admin/src/components/rewards/overviewHelpers.ts
 * PURPOSE: Plain rules behind the Rewards overview (report 5f2ab6c5): the
 *          header chip says what the open app's program does, the tier panel
 *          never says "No contributors yet" beside a tester with points, and
 *          the "last 24 h" feed lists only the last 24 hours.
 */

const DAY_MS = 86_400_000

/** The header chip: plan, then this app's switch. */
export function rewardsHeaderChip(input: { entitled: boolean; projectEnabled: boolean; hasProject: boolean }): {
  label: string
  tone: 'active' | 'off' | 'readonly'
} {
  if (!input.entitled) return { label: 'Free — read-only', tone: 'readonly' }
  if (!input.hasProject) return { label: 'No app picked', tone: 'off' }
  return input.projectEnabled ? { label: 'On for this app', tone: 'active' } : { label: 'Off for this app', tone: 'off' }
}

/** Only the events from the last 24 hours, so the rows agree with the 24 h totals above them. */
export function eventsInLast24h<T extends { created_at: string }>(events: readonly T[], now = Date.now()): T[] {
  return events.filter((e) => {
    const t = Date.parse(e.created_at)
    return Number.isFinite(t) && now - t <= DAY_MS
  })
}

/** The tier panel's empty line: testers with points who haven't reached a tier are not "no contributors". */
export function tierEmptyMessage(activeContributors30d: number): { title: string; description: string } {
  if (activeContributors30d > 0) {
    const who = activeContributors30d === 1 ? '1 tester has' : `${activeContributors30d} testers have`
    return { title: 'Nobody has reached a tier yet', description: `${who} earned points in the last 30 days but none has enough for the first tier.` }
  }
  return { title: 'No testers yet', description: 'Testers show up here once your app sends their first activity with rewards on.' }
}

/**
 * A tester's name for a list (2026-11-18): the display name, else a short "Tester #23ba"
 * for a raw UUID or long hex id (Plain language: never a raw UUID), else the external id.
 */
export function testerLabel(user: { external_user_id: string; display_name: string | null } | null | undefined): string {
  if (!user) return 'Anonymous tester'
  const name = user.display_name?.trim()
  if (name) return name
  const id = user.external_user_id ?? ''
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) || /^[0-9a-f]{20,}$/i.test(id)) return `Tester #${id.slice(0, 4)}`
  return id || 'Anonymous tester'
}

/** Ladder order, low to high: the threshold when the tier list is loaded, else the default ladder. */
const DEFAULT_LADDER = ['free', 'explorer', 'contributor', 'champion', 'legend']

export function sortTiersByLadder(
  entries: ReadonlyArray<readonly [string, number]>,
  tiers?: ReadonlyArray<{ slug: string; points_threshold: number }> | null,
): Array<[string, number]> {
  const threshold = new Map((tiers ?? []).map((t) => [t.slug.toLowerCase(), t.points_threshold]))
  const byThreshold = entries.length > 0 && entries.every(([slug]) => threshold.has(slug.toLowerCase()))
  const rank = (slug: string): number => {
    const key = slug.toLowerCase()
    if (byThreshold) return threshold.get(key)!
    const i = DEFAULT_LADDER.indexOf(key)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return entries.map(([slug, n]) => [slug, n] as [string, number]).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
}

export interface ActivityGroup<T> {
  key: string
  action: string
  tester: string
  count: number
  points: number
  rejectedReason: string | null
  /** The newest event of the group (the feed arrives newest first). */
  latest: T
}

/**
 * The 24 h feed grouped by tester, action and outcome (2026-11-18: 32 "session minute
 * +1" rows, mostly one tester). Groups keep the order of their newest event.
 */
export function groupActivityEvents<T extends {
  action: string
  points_awarded: number | null
  rejected_reason: string | null
  created_at: string
  end_users: { external_user_id: string; display_name: string | null } | null
}>(events: readonly T[]): ActivityGroup<T>[] {
  const groups = new Map<string, ActivityGroup<T>>()
  for (const ev of events) {
    const who = ev.end_users?.external_user_id ?? 'anonymous'
    const key = `${who}|${ev.action}|${ev.rejected_reason ?? ''}`
    const g = groups.get(key)
    if (g) {
      g.count += 1
      g.points += ev.rejected_reason ? 0 : (ev.points_awarded ?? 0)
      if (Date.parse(ev.created_at) > Date.parse(g.latest.created_at)) g.latest = ev
    } else {
      groups.set(key, {
        key,
        action: ev.action,
        tester: testerLabel(ev.end_users),
        count: 1,
        points: ev.rejected_reason ? 0 : (ev.points_awarded ?? 0),
        rejectedReason: ev.rejected_reason,
        latest: ev,
      })
    }
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.latest.created_at) - Date.parse(a.latest.created_at))
}

