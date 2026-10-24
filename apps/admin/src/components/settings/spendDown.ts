/**
 * FILE: spendDown.ts
 * PURPOSE: Types and plain words for GET /v1/admin/byok/spend-down (ADR 0028):
 *          what a Cursor key's spend-down mode is doing, in one line; what
 *          the last 7 days of runs produced; and which apps the stop-loss
 *          paused, with why (ADR 0028 amendment).
 */

import type { ReviewFollowupScoreboard } from './reviewFollowups'

type SpendDownState = 'off' | 'not_started' | 'active' | 'expired' | 'key_unusable'

/** The stop-loss state of one app (server `spendDownStopLoss`). */
interface SpendDownStopLoss {
  paused: boolean
  reason: string | null
  pausedAt?: string | null
  reviewed: number
  mergeRate: number | null
  holdRate: number | null
  finishedRuns: number
  noPrShare: number | null
}

/** The last-7-days rollup for one key (server `spendDownScoreboard` totals). */
interface SpendDownCounts {
  runs: number
  inFlight: number
  prsOpened: number
  noPrVerdicts: number
  otherFailures: number
  reviewed: number
  verdicts: { merge: number; fix_first: number; hold: number }
  merged: number
  /** fix_reviews.cost_usd summed: the latest review of each PR (a re-run overwrites). */
  latestReviewCostUsd: number
  mergeYield: number | null
  mergeableYield: number | null
}

export interface SpendDownKeyStatus {
  id: string
  label: string | null
  keyHint: string | null
  scope: 'organization' | 'project' | 'universal'
  /** Universal keys: the signed-in user owns it, so they may change it (ADR 0031). */
  ownedByMe?: boolean
  status: string
  enabled: boolean
  creditsExpireAt: string | null
  model: string | null
  dailyLimit: number
  windowDays: number
  state: SpendDownState
  startsAt: string | null
  dispatchedToday: number
  /** Null for someone else's universal key: the key-wide remainder is its owner's (ADR 0031). */
  remainingToday: number | null
  /** canResume: you are this app's owner or admin (Resume is theirs to press). */
  projects: Array<{ id: string; name: string; canResume?: boolean; stopLoss?: SpendDownStopLoss | null }>
  projectsNote?: string | null
  /** Apps this key pays for that you cannot open (a shared key). */
  otherApps?: number
  /**
   * Why this key pays for no app: another key of the same scope is the
   * resolver's first pick. Absent when the idle reason is an own key,
   * auto-fix off, or no repo.
   */
  idleNote?: string | null
  stopLossNote?: string | null
  scoreboard?: { days: number; totals: SpendDownCounts } | null
  scoreboardNote?: string | null
  lastRunAt: string | null
  lastSummary: {
    dispatched?: number
    projects?: Array<{ projectId: string; dispatched: number; stopped?: string; paused?: boolean }>
  } | null
}

export interface SpendDownResponse {
  projectId: string
  keys: SpendDownKeyStatus[]
  /** Review follow-ups (ADR 0032), last 7 days, over the apps you can access; null when unreadable. */
  reviewFollowups?: ReviewFollowupScoreboard | null
}

function day(iso: string | null): string {
  if (!iso) return 'an unknown date'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fixes(n: number): string {
  return `${n} fix${n === 1 ? '' : 'es'}`
}

export function spendDownLine(k: SpendDownKeyStatus): { text: string; tone: 'muted' | 'ok' | 'warn' } {
  switch (k.state) {
    case 'off':
      return { text: 'Spend-down is off.', tone: 'muted' }
    case 'expired':
      return { text: `The credits expired on ${day(k.creditsExpireAt)}, so spend-down stopped.`, tone: 'muted' }
    case 'key_unusable':
      return { text: 'Spend-down is paused: the key failed its last test. Test it again to resume.', tone: 'warn' }
    case 'not_started':
      return {
        text: `Starts ${day(k.startsAt)}: up to ${fixes(k.dailyLimit)} a day until the credits expire on ${day(k.creditsExpireAt)}.`,
        tone: 'muted',
      }
    case 'active': {
      const others = k.otherApps ?? 0
      if (k.projects.length === 0 && others === 0) {
        if (k.idleNote) return { text: k.idleNote, tone: 'warn' }
        return {
          text: 'On, but no app uses this key: each app has its own Cursor key, auto-fix is off, or no repo is linked.',
          tone: 'warn',
        }
      }
      const names = k.projects.map((p) => p.name)
      if (others > 0) names.push(`${others} other app${others === 1 ? '' : 's'}`)
      return {
        text: `Spending down: ${k.dispatchedToday} of ${fixes(k.dailyLimit)} today, until ${day(k.creditsExpireAt)}. Pays for ${names.join(', ')}.`,
        tone: 'ok',
      }
    }
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "Last 7 days: 258 runs → 154 PRs → 19 mergeable, 0 merged · Opus review
 * $8.04 (latest review per PR)", or null before the key has run anything in
 * the period (or when the scoreboard could not be read).
 */
export function spendDownScoreLine(k: SpendDownKeyStatus): string | null {
  const board = k.scoreboard
  if (!board || board.totals.runs === 0) return null
  const t = board.totals
  const review =
    t.reviewed > 0 || t.latestReviewCostUsd > 0
      ? ` · Opus review $${t.latestReviewCostUsd.toFixed(2)} (latest review per PR)`
      : ''
  return `Last ${plural(board.days, 'day')}: ${plural(t.runs, 'run')} → ${plural(t.prsOpened, 'PR')} → ${t.verdicts.merge} mergeable, ${t.merged} merged${review}`
}

interface SpendDownPause {
  projectId: string
  /** "app: reason" */
  text: string
  canResume: boolean
}

/** Apps the stop-loss pauses right now, with why. */
export function spendDownPauses(k: SpendDownKeyStatus): SpendDownPause[] {
  return k.projects
    .filter((p) => p.stopLoss?.paused)
    .map((p) => ({
      projectId: p.id,
      text: `${p.name}: ${p.stopLoss?.reason ?? 'Paused: low yield'}`,
      canResume: p.canResume === true,
    }))
}

/** The spend-down worker's stop reason when an app has nothing left to dispatch (_shared/spend-down.ts). */
const SPEND_DOWN_NO_REPORT = 'No open report to fix'

/**
 * Why the last tick dispatched nothing to some apps. Apps with the same
 * reason share one line ("glot.it, yen-yen and 4 more: …"), so seven apps out
 * of work read as one sentence, not seven.
 * Pauses are left to spendDownPauses, which reads the live state: a pause the
 * last tick recorded may already have lifted.
 */
export function spendDownStops(k: SpendDownKeyStatus): string[] {
  const names = new Map(k.projects.map((p) => [p.id, p.name]))
  const livePaused = new Set(k.projects.filter((p) => p.stopLoss?.paused).map((p) => p.id))
  const byReason = new Map<string, string[]>()
  for (const p of k.lastSummary?.projects ?? []) {
    if (p.dispatched !== 0 || !p.stopped || p.paused || livePaused.has(p.projectId)) continue
    byReason.set(p.stopped, [...(byReason.get(p.stopped) ?? []), names.get(p.projectId) ?? 'An app'])
  }
  return [...byReason].map(([reason, apps]) => `${appList(apps)}: ${reason}`)
}

function appList(apps: string[]): string {
  if (apps.length <= 3) return apps.length < 3 ? apps.join(' and ') : `${apps[0]}, ${apps[1]} and ${apps[2]}`
  return `${apps[0]}, ${apps[1]} and ${apps.length - 2} more`
}

/**
 * The key is in its window with credits to spend, but the last tick found no
 * report to send in any app: every open report was tried in the last 7 days
 * or settled by the agent's verdict. The credits wait for new reports.
 */
export function spendDownOutOfWork(k: SpendDownKeyStatus): boolean {
  const ticked = k.lastSummary?.projects ?? []
  if (k.state !== 'active' || k.dispatchedToday > 0 || ticked.length === 0) return false
  return ticked.every((p) => p.dispatched === 0 && (p.stopped === SPEND_DOWN_NO_REPORT || p.paused))
    && ticked.some((p) => p.stopped === SPEND_DOWN_NO_REPORT)
}
