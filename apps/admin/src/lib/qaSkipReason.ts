/**
 * FILE: apps/admin/src/lib/qaSkipReason.ts
 * PURPOSE: Why a scheduled test was skipped, and the one thing that fixes it
 *          (owner, 2026-11-19: three stories read "skipped · Local" with
 *          "24 runs · 24h" and empty boxes, and nothing said why).
 *
 *          The reasons are qa-story-runner's own (packages/server/supabase/
 *          functions/qa-story-runner/index.ts):
 *            - `local`: the cloud runner never runs it; it writes a skipped
 *              run every time the schedule fires. Only `mushi qa run <id>` on
 *              the user's computer runs it.
 *            - `browserbase`: the runner opens a Browserbase session, then
 *              hands the script to the CLI runner (skipped).
 *            - anything else skipped: the per-app limit of tests at once
 *              (`rate_limited`); the next schedule tick runs it.
 *
 *          Also the page's lead (qaPageStatus): one sentence, up to three
 *          numbers, and which single action leads. Pure: no React.
 */

import type { RunStatus } from '../components/signal/StatusMark'

export interface QaCoverageRow {
  story_id: string
  name: string
  enabled: boolean
  browser_provider: string
  last_run_status: string | null
  runs_24h: number
  passed_24h: number
  failed_24h: number
  error_24h: number
  pass_rate_pct: number | null
}

type SkipKind = 'local' | 'browserbase' | 'busy'

export interface SkipReason {
  kind: SkipKind
  /** One line: why it did not run. */
  text: string
  /** Switching the story to the cloud runner (Firecrawl) makes the schedule run it. */
  cloudFixes: boolean
}

/** Plain words for the runner a story uses. */
const PROVIDER_WORDS: Record<string, string> = {
  local: 'On your computer',
  firecrawl_actions: 'Cloud · Firecrawl',
  browserbase: 'Cloud · Browserbase',
}

export function providerWords(provider: string): string {
  return PROVIDER_WORDS[provider] ?? provider.replace(/_/g, ' ')
}

/** The command that runs one story on the user's own computer. */
export function cliRunCommand(storyId: string): string {
  return `mushi qa run ${storyId}`
}

/**
 * Whether the cloud runner (Firecrawl) can run this story as written: no script (a prompt), a
 * URL, or a JSON actions spec (qa-story-runner runFirecrawl). A Playwright script, which
 * test-gen-from-report writes on `local` stories, would be ignored there: the page would load
 * with default actions and could "pass" without the test ever running. Such a story stays on
 * your computer (2026-11-19).
 */
export function cloudCanRunScript(script: string | null | undefined): boolean {
  const s = script?.trim() ?? ''
  if (!s || s.startsWith('http')) return true
  try {
    const parsed = JSON.parse(s) as unknown
    return Array.isArray(parsed) || (parsed != null && typeof parsed === 'object')
  } catch {
    return false
  }
}

/** Nothing finished (passed, failed or errored) in the last 24 hours. */
function nothingFinished(r: QaCoverageRow): boolean {
  return r.passed_24h + r.failed_24h + r.error_24h === 0
}

/**
 * Why this story was skipped, or null when it was not. A local story that never
 * ran yet gets the reason too: it will be skipped on its first tick.
 */
export function skipReason(r: QaCoverageRow): SkipReason | null {
  if (!r.enabled) return null
  const skipped = r.last_run_status === 'skipped'
  if (r.browser_provider === 'local') {
    if (!skipped && !(r.last_run_status == null && r.runs_24h === 0)) return null
    return { kind: 'local', text: 'Runs on your computer only, so the schedule skips it.', cloudFixes: true }
  }
  if (!skipped) return null
  if (r.browser_provider === 'browserbase') {
    return { kind: 'browserbase', text: 'Browserbase opens the session, but the test itself still needs your computer. Run it in the cloud with Firecrawl instead.', cloudFixes: true }
  }
  return { kind: 'busy', text: 'Skipped because too many tests ran at once for this app. The next scheduled run picks it up.', cloudFixes: false }
}

/** The card's state as a mark: failed ✕, passed ✓, running ●, skipped ⊘, never ran ○. */
export function storyRunStatus(r: Pick<QaCoverageRow, 'enabled' | 'last_run_status'>): { status: RunStatus; label: string } {
  if (!r.enabled) return { status: 'idle', label: 'Turned off' }
  switch (r.last_run_status) {
    case 'passed':
      return { status: 'passed', label: 'Passed' }
    case 'failed':
      return { status: 'failed', label: 'Failed' }
    case 'error':
      return { status: 'failed', label: 'Errored' }
    case 'timeout':
      return { status: 'slow', label: 'Timed out' }
    case 'running':
      return { status: 'running', label: 'Running' }
    case 'pending':
      return { status: 'waiting', label: 'Queued' }
    case 'skipped':
      return { status: 'cancelled', label: 'Skipped' }
    default:
      return { status: 'idle', label: 'Never ran' }
  }
}

export interface StripDayCounts {
  day: string
  passed: number
  failed: number
  /** Absent from an older server. */
  skipped?: number
}

/** One day of the 7-day strip as a state (a failure ✕, passes ✓, only skips ⊘, nothing ○). */
export function stripDayStatus(d: StripDayCounts): 'failed' | 'passed' | 'cancelled' | 'idle' {
  if (d.failed > 0) return 'failed'
  if (d.passed > 0) return 'passed'
  if ((d.skipped ?? 0) > 0) return 'cancelled'
  return 'idle'
}

type QaLeadAction =
  | { kind: 'open_failing'; storyId: string; name: string }
  | { kind: 'run_in_cloud'; storyIds: string[] }
  | { kind: 'copy_cli'; storyId: string }
  | { kind: 'none' }

export interface QaPageLead {
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
  sentence: string
  passing: number
  failing: number
  neverRan: number
  /** The tests behind "Never ran", for one mark each under the number (name and why, for the tooltip). */
  neverRanTests: Array<{ id: string; name: string; why: string }>
  action: QaLeadAction
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The page's lead, worst first: failing tests, then tests that never ran (and
 * why), then runs in progress, then all off, then all clear. `canEdit` decides
 * whether the fix is a button that switches runners or a command to copy.
 */
export function qaPageStatus(rows: readonly QaCoverageRow[], opts: { pendingRuns?: number; canEdit?: boolean } = {}): QaPageLead {
  const enabled = rows.filter((r) => r.enabled)
  const failingRows = enabled.filter((r) => r.runs_24h > 0 && r.pass_rate_pct != null && r.pass_rate_pct < 80)
  const passingRows = enabled.filter((r) => r.runs_24h > 0 && r.pass_rate_pct != null && r.pass_rate_pct >= 80)
  const skipped = enabled.map((r) => ({ r, why: skipReason(r) })).filter((x) => x.why != null && nothingFinished(x.r))
  const base = {
    passing: passingRows.length,
    failing: failingRows.length,
    neverRan: skipped.length,
    neverRanTests: skipped.map((x) => ({ id: x.r.story_id, name: x.r.name, why: x.why!.text })),
  }

  if (failingRows.length > 0) {
    const worst = [...failingRows].sort((a, b) => (a.pass_rate_pct ?? 0) - (b.pass_rate_pct ?? 0))[0]!
    return {
      ...base,
      tone: 'danger',
      sentence: `${plural(failingRows.length, 'test')} failing in the last 24 hours. Worst: ${worst.name}.`,
      action: { kind: 'open_failing', storyId: worst.story_id, name: worst.name },
    }
  }
  if (skipped.length > 0) {
    const fixable = skipped.filter((x) => x.why!.cloudFixes)
    const allLocal = skipped.every((x) => x.why!.kind === 'local')
    const why = allLocal
      ? `${skipped.length === 1 ? 'it is' : 'they are'} set to run on your computer only`
      : skipped.every((x) => x.why!.kind === 'busy')
        ? 'too many tests ran at once'
        : 'their runner cannot run them on the schedule'
    const action: QaLeadAction = fixable.length > 0 && opts.canEdit
      ? { kind: 'run_in_cloud', storyIds: fixable.map((x) => x.r.story_id) }
      : fixable.length > 0
        ? { kind: 'copy_cli', storyId: fixable[0]!.r.story_id }
        : { kind: 'none' }
    return { ...base, tone: 'warn', sentence: `${plural(skipped.length, 'test')} never ran: ${why}.`, action }
  }
  if ((opts.pendingRuns ?? 0) > 0) {
    return { ...base, tone: 'info', sentence: `${plural(opts.pendingRuns!, 'run')} in progress.`, action: { kind: 'none' } }
  }
  if (rows.length > 0 && enabled.length === 0) {
    return { ...base, tone: 'warn', sentence: 'Every test is turned off, so nothing is checked. Open one and turn it on.', action: { kind: 'none' } }
  }
  if (passingRows.length > 0 && passingRows.length === enabled.length) {
    return { ...base, tone: 'ok', sentence: `All ${plural(passingRows.length, 'test')} passed in the last 24 hours.`, action: { kind: 'none' } }
  }
  const idle = enabled.length - passingRows.length
  return {
    ...base,
    tone: idle > 0 ? 'warn' : 'neutral',
    sentence: idle > 0 ? `${plural(idle, 'test')} did not run in the last 24 hours. Check the schedule, or press Run on the card.` : 'No results yet.',
    action: { kind: 'none' },
  }
}
