/**
 * FILE: apps/admin/src/lib/criticalMetricCopy.ts
 * PURPOSE: Visible scope for every "critical" and "PRs open" number that
 *          used to share a word and a different query (report 7972eaee).
 *
 * Home "Critical · 14d" is open critical reports from the last 14 days that
 * are not already in a fix (`OPEN_REPORT_STATUSES`). The Bugs tile counts
 * the same window but every report that is not closed, including ones a fix
 * is already working on. The Critical chip is all-time, every status. The
 * sidebar badge and the app switcher are the last 30 days, every status.
 * None of those is the untriaged backlog.
 */

/** Home KPI. The subtitle describes this number, not the triage backlog. */
export function homeCriticalTileCopy(): { label: string; sublabel: string; meaning: string } {
  return {
    label: 'Critical · 14d',
    sublabel: 'to decide, not in a fix',
    meaning:
      'Critical reports from the last 14 days that still need a decision and are not already in a fix. The Bugs “Critical · open” tile also counts bugs a fix is working on. The Critical chip is all-time. The sidebar and the app switcher count the last 30 days, every status.',
  }
}

/** Page-context line for the same Home number. */
export function homeCriticalPageSummary(count: number): string {
  return `${count} critical to decide in the last 14 days`
}

/**
 * Open PRs under Home "Fixes in flight". One per report, last 30 days
 * (fix-report-truth). Fixes → PRs open counts each loaded attempt.
 */
export function homeOpenPrSublabel(openPrs: number, stopped: number): string {
  const pr = `${openPrs} open PR${openPrs === 1 ? '' : 's'} · last 30 days`
  return `${pr} · ${stopped} stopped`
}

export const HOME_FIXES_IN_FLIGHT_MEANING =
  'Fixes being drafted right now. Open PRs are reports with a pull request still open in the last 30 days, one per report. The Fixes page counts each loaded attempt, so those two numbers can differ. Stopped is reports whose last attempt failed.'

/** Bugs severity tile when the response splits still-open from filed. */
export function bugsSeverityTileLabel(severity: string, windowDays: number, hasOpenSplit: boolean): string {
  return hasOpenSplit ? `${severity} · open · ${windowDays}d` : `${severity} · ${windowDays}d`
}

export const BUGS_CRITICAL_OPEN_MEANING =
  'Critical reports from this window that are not closed, including bugs already in a fix. Home’s “Critical · 14d” tile leaves those out. The line under the number is how many were filed, and how many of those are already closed.'

/** Quick-filter chip. All-time, every status — not the 14-day tile. */
export function criticalAllTimeChipLabel(): string {
  return 'Critical · all'
}

export function criticalChipHint(): string {
  return 'All-time critical reports, every status. Not the 14-day tile (that one is still not closed) and not Home’s “to decide” count.'
}

/** App switcher chip. Last 30 days, every status. */
export function critical30dChipLabel(count: number): string {
  return `Crit ${count} · 30d`
}

/** Folder-tab count. Same 30-day, every-status scope as the switcher chip. */
export function critical30dInlineLabel(count: number): string {
  return `${count} critical · 30d`
}

/**
 * Short window painted next to a sidebar count whose accessible name already
 * ends in "(14d)" or "(30d)". Null when the badge is not a windowed count.
 */
export function badgeWindowNote(label: string): string | null {
  const match = /\((\d+d)\)\s*$/.exec(label)
  return match?.[1] ?? null
}
