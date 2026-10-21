/**
 * FILE: spendDown.ts
 * PURPOSE: Types and plain words for GET /v1/admin/byok/spend-down (ADR 0028):
 *          what a Cursor key's spend-down mode is doing, in one line; what
 *          the last 7 days of runs produced; and which apps the stop-loss
 *          paused, with why (ADR 0028 amendment).
 */

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
  scope: 'organization' | 'project'
  status: string
  enabled: boolean
  creditsExpireAt: string | null
  model: string | null
  dailyLimit: number
  windowDays: number
  state: SpendDownState
  startsAt: string | null
  dispatchedToday: number
  remainingToday: number
  /** canResume: you are this app's owner or admin (Resume is theirs to press). */
  projects: Array<{ id: string; name: string; canResume?: boolean; stopLoss?: SpendDownStopLoss | null }>
  projectsNote?: string | null
  /** Apps this key pays for that you cannot open (a shared key). */
  otherApps?: number
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

/**
 * Why the last tick dispatched nothing to some apps, one phrase per app.
 * Pauses are left to spendDownPauses, which reads the live state: a pause the
 * last tick recorded may already have lifted.
 */
export function spendDownStops(k: SpendDownKeyStatus): string[] {
  const names = new Map(k.projects.map((p) => [p.id, p.name]))
  const livePaused = new Set(k.projects.filter((p) => p.stopLoss?.paused).map((p) => p.id))
  return (k.lastSummary?.projects ?? [])
    .filter((p) => p.dispatched === 0 && p.stopped && !p.paused && !livePaused.has(p.projectId))
    .map((p) => `${names.get(p.projectId) ?? 'An app'}: ${p.stopped}`)
}
