/**
 * FIXES STATUS — one line saying what needs you (ADR 0069, "Fixes is a list
 * of fixes"): fix PRs ready to merge, and from /v1/admin/fixes/stats the
 * reports auto-fix stopped on, the other open PRs, what is running and the
 * reports fixed. Each clause links to the list it counts, so the three number
 * tiles that repeated the sentence are gone. Each word is defined once in
 * lib/countDefinitions.ts, so "Stopped" here is Home's "Auto-fix stopped".
 */

import { Link } from 'react-router-dom'
import { PageStatus } from '../ui'
import { StatusGlyph } from '../signal/StatusGlyph'
import { usePageData } from '../../lib/usePageData'
import type { FixesStats } from './FixesStatsTypes'
import { stoppedTitle } from '../../lib/countDefinitions'
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

interface Clause {
  text: string
  to: string
}

/** The sentence's clauses, each with the list it counts. */
function fixesClauses(stats: FixesStats, inFlight: number, ready: number): { lead: Clause[]; fixed: Clause | null } {
  const lead: Clause[] = []
  if (ready > 0) lead.push({ text: `${pluralizeWithCount(ready, 'fix PR')} ready to merge`, to: '#fixes-ready' })
  // "Auto-fix stopped…" starts the sentence only when nothing comes before it.
  if (stats.failed > 0) {
    lead.push({ text: lead.length ? stoppedTitle(stats.failed).replace(/^Auto/, 'auto') : stoppedTitle(stats.failed), to: fixesLinks.failed })
  }
  if (stats.prsOpen > ready) {
    lead.push({ text: `${pluralizeWithCount(stats.prsOpen - ready, 'other PR')} waiting for review or CI`, to: fixesLinks.prsOpen })
  }
  if (inFlight > 0) lead.push({ text: `${pluralizeWithCount(inFlight, 'fix', 'fixes')} running`, to: '/fixes?status=inflight' })
  const fixed = stats.completed > 0 ? { text: `${pluralizeWithCount(stats.completed, 'report')} fixed in the last 30 days`, to: fixesLinks.completed } : null
  return { lead, fixed }
}

const CLAUSE_LINK = 'font-medium text-fg underline-offset-2 hover:underline'

function ClauseLink({ clause, className = CLAUSE_LINK }: { clause: Clause; className?: string }) {
  // A same-page anchor scrolls natively; the rest set the list's filter.
  return clause.to.startsWith('#') ? (
    <a href={clause.to} className={className}>{clause.text}</a>
  ) : (
    <Link to={clause.to} className={className}>{clause.text}</Link>
  )
}

function FixesSentence({ stats, inFlight, ready }: { stats: FixesStats; inFlight: number; ready: number }) {
  const { lead, fixed } = fixesClauses(stats, inFlight, ready)
  if (lead.length === 0) {
    return <>{fixed ? <><ClauseLink clause={fixed} />; nothing waiting.</> : 'Nothing waiting.'}</>
  }
  return (
    <>
      {lead.map((c, i) => {
        const clause = i === 0 ? { ...c, text: `${c.text.charAt(0).toUpperCase()}${c.text.slice(1)}` } : c
        return (
          <span key={c.to + c.text}>
            {i > 0 ? '; ' : null}
            <ClauseLink clause={clause} />
          </span>
        )
      })}
      .
      {fixed ? (
        <span className="text-fg-muted">
          {' '}
          <ClauseLink clause={{ ...fixed, text: `${fixed.text.charAt(0).toUpperCase()}${fixed.text.slice(1)}` }} className="underline-offset-2 hover:underline" />.
        </span>
      ) : null}
    </>
  )
}

/** Open bugs, for the "no fixes yet" line (total only; one row fetched). */
const OPEN_BUGS_PATH = '/v1/admin/reports?status=open&sort=created_at&dir=desc&limit=1'

/**
 * @internal Exported for tests.
 * No fix has run: an off mark, never a green "ok" dot, and the bugs that wait
 * for one. "● No fixes in the last 30 days." in green while 4 bugs waited read
 * as all clear (fresh-eyes sweep 2026-11-18).
 */
function NoFixesLine({ openBugs }: { openBugs: number | null }) {
  return (
    <div
      role="status"
      aria-label="Fixes status"
      // mushi-mushi-allowlist: one status row with role="status"; Card takes no role or aria-label
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
      sentence={<FixesSentence stats={stats} inFlight={running} ready={ready} />}
      // No freshness here: the page header shows the same "updated" time.
    />
  )
}
