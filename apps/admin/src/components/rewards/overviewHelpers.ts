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
  if (!input.entitled) return { label: 'Hobby — read-only', tone: 'readonly' }
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
