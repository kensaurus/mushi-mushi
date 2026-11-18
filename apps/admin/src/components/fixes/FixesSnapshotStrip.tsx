/**
 * FIXES STATUS — one sentence and three numbers (PageStatus, P1): fix PRs
 * ready to merge, and from /v1/admin/fixes/stats the reports auto-fix stopped
 * on and the reports fixed. Each word is defined once in
 * lib/countDefinitions.ts, so "Stopped" here is Home's "Auto-fix stopped".
 */

import { Link } from 'react-router-dom'
import { PageStatus } from '../ui'
import { StatusGlyph } from '../signal/StatusGlyph'
import { usePageData } from '../../lib/usePageData'
import type { FixesStats } from './FixesStatsTypes'
import { COUNT_HINTS, stoppedTitle } from '../../lib/countDefinitions'
import { pluralizeWithCount } from '../../lib/format'
import { fixesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FixesStats
  /** Fix PRs ready to merge (countDefinitions isReadyToMerge), from the loaded list. */
  ready?: number
  /**
   * In-flight reports, the same number as the tab title and the In flight
   * card. When omitted, stats are `inProgress` plus dispatches that have no
   * attempt yet.
   */
  inFlight?: number
}

function fixesSentence(stats: FixesStats, inFlight: number, ready: number): string {
  if (stats.totalAttempts === 0 && inFlight === 0) return 'No fixes in the last 30 days.'
  const parts: string[] = []
  if (ready > 0) parts.push(`${pluralizeWithCount(ready, 'fix PR')} ready to merge`)
  // "Auto-fix stopped…" starts the sentence only when nothing comes before it.
  if (stats.failed > 0) parts.push(parts.length ? stoppedTitle(stats.failed).replace(/^Auto/, 'auto') : stoppedTitle(stats.failed))
  if (stats.prsOpen > ready) parts.push(`${pluralizeWithCount(stats.prsOpen - ready, 'other PR')} waiting for review or CI`)
  if (inFlight > 0) parts.push(`${pluralizeWithCount(inFlight, 'fix', 'fixes')} running`)
  if (parts.length === 0) return `${pluralizeWithCount(stats.completed, 'report')} fixed in the last 30 days; nothing waiting.`
  const sentence = parts.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** Open bugs, for the "no fixes yet" line (total only; one row fetched). */
const OPEN_BUGS_PATH = '/v1/admin/reports?status=open&sort=created_at&dir=desc&limit=1'

/**
 * @internal Exported for tests.
 * No fix has run: an off mark, never a green "ok" dot, and the bugs that wait
 * for one. "● No fixes in the last 30 days." in green while 4 bugs waited read
 * as all clear (fresh-eyes sweep 2026-11-18).
 */
export function NoFixesLine({ openBugs }: { openBugs: number | null }) {
  return (
    <div
      role="status"
      aria-label="Fixes status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2 text-sm text-fg-secondary"
      data-testid="fixes-none-yet"
    >
      <StatusGlyph tone="off" />
      <span>No fixes in the last 30 days.</span>
      {openBugs != null && openBugs > 0 && (
        <Link to="/reports?status=open&sort=severity&dir=desc" className="whitespace-nowrap font-medium text-link hover:underline">
          {pluralizeWithCount(openBugs, 'bug')} waiting for a fix
        </Link>
      )}
    </div>
  )
}

export function FixesSnapshotStrip({ stats, ready = 0, inFlight }: Props) {
  const running = inFlight ?? stats.inProgress + stats.inflightDispatches
  const none = stats.totalAttempts === 0 && running === 0
  const open = usePageData<{ total?: number }>(none ? OPEN_BUGS_PATH : null)
  if (none) return <NoFixesLine openBugs={open.data?.total ?? null} />
  return (
    <PageStatus
      ariaLabel="Fixes status"
      tone={stats.failed > 0 ? 'danger' : ready > 0 ? 'warn' : running > 0 ? 'info' : 'ok'}
      sentence={fixesSentence(stats, running, ready)}
      // No freshness here: the page header shows the same "updated" time.
      metrics={[
        {
          label: 'Ready to merge',
          value: ready,
          tone: ready > 0 ? 'ok' : 'neutral',
          hint: COUNT_HINTS.readyToMerge,
          to: '/fixes#fixes-ready',
        },
        {
          label: 'Stopped',
          value: stats.failed,
          tone: stats.failed > 0 ? 'danger' : 'neutral',
          hint: COUNT_HINTS.stopped,
          to: fixesLinks.failed,
        },
        {
          label: 'Fixed',
          value: stats.completed,
          tone: stats.completed > 0 ? 'ok' : 'neutral',
          hint: COUNT_HINTS.fixed,
          to: fixesLinks.completed,
        },
      ]}
    />
  )
}
