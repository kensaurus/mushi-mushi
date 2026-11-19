/**
 * FILE: apps/admin/src/components/ci/CiSummary.tsx
 * PURPOSE: The top of /ci. One sentence that says whether anything needs
 *          you, four live tiles (waiting, running, typical wait, typical
 *          run) that jump to their section, and the window's finished jobs
 *          as one bar split by outcome, in the shared colours and icons
 *          (ciOutcome.tsx) with counts in words.
 */

import type { ComponentType, ReactNode } from 'react'
import type { CiOverview } from '../../lib/ciTypes'
import { ciVerdict, ciWindowCounts, formatPercent, formatSeconds, type CiJobOutcome } from '../../lib/ciView'
import { IconAlertTriangle, IconCheck, IconGauge, IconInfo, IconPlay } from '../icons'
import { CI_OUTCOME_STYLE, CiOutcomeLegend } from './ciOutcome'
import { CiWeekHeat } from './CiWeekHeat'

const VERDICT_TONE = {
  ok: { Icon: IconCheck, icon: 'text-ok' },
  warn: { Icon: IconAlertTriangle, icon: 'text-warn-foreground' },
  danger: { Icon: IconAlertTriangle, icon: 'text-danger' },
  neutral: { Icon: IconInfo, icon: 'text-fg-secondary' },
} as const

function Tile({
  Icon,
  label,
  value,
  detail,
  tone,
  href,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>
  label: string
  value: ReactNode
  detail: string
  tone: string
  href: string
}) {
  return (
    <a
      href={href}
      className="group flex min-w-0 items-start gap-2.5 rounded-sm py-1 hover:bg-surface-overlay/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone}`}>
        <Icon size={14} />
      </span>
      <span className="min-w-0">
        <span className="block text-2xs text-fg-muted">{label}</span>
        <span className="block text-lg font-semibold leading-tight text-fg tabular-nums">{value}</span>
        <span className="block text-3xs leading-snug text-fg-muted group-hover:text-fg-secondary">{detail}</span>
      </span>
    </a>
  )
}

const BAR_ORDER: Array<{ key: 'passed' | 'codeFailures' | 'infra' | 'other'; outcome: CiJobOutcome; label?: string }> = [
  { key: 'passed', outcome: 'passed' },
  { key: 'codeFailures', outcome: 'code_failure' },
  { key: 'infra', outcome: 'infra' },
  { key: 'other', outcome: 'cancelled', label: 'Cancelled, skipped or still going' },
]

export function CiSummary({ overview }: { overview: CiOverview }) {
  const verdict = ciVerdict(overview)
  // One window for the headline, the bar and its counts (ciWindowCounts): the whole window when the
  // server counted it, so "N jobs failed on the code" and "Tests failed N" are the same N.
  const counts = ciWindowCounts(overview.stats)
  const { stats } = overview
  const tone = VERDICT_TONE[verdict.tone]
  const days = overview.window.days
  // Older servers send only the newest jobs read (at most about 1,000): say so once.
  const weekJobs = Math.max(stats.windowJobs ?? counts.total, counts.total)
  const sampled = weekJobs > counts.total

  // "769 jobs failed on the code. 34 more stopped because of the test machine" restated the legend
  // just below ("Tests failed 769", "Test machine stopped 34"; round 3): that plain count is for
  // screen readers only. A verdict that says something the bar does not (the machine, not your
  // code; all passed) still shows.
  const restatesLegend = verdict.tone === 'neutral'
  return (
    <div className="flex flex-col gap-3" data-testid="ci-summary">
      {restatesLegend ? (
        <p className="sr-only" role="status" data-testid="ci-verdict">
          {verdict.headline}
        </p>
      ) : (
        <div className="flex items-start gap-2.5 border-b border-edge-subtle pb-2.5" role="status">
          <tone.Icon size={16} className={`mt-0.5 shrink-0 ${tone.icon}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg" data-testid="ci-verdict">
              {verdict.headline}
            </p>
            {verdict.detail && <p className="text-xs text-fg-secondary">{verdict.detail}</p>}
          </div>
        </div>
      )}

      {/* Waiting and running now are the status board's, right above: the week only. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-edge-subtle pb-2.5">
        <Tile
          Icon={IconGauge}
          label="Half the jobs wait at most"
          value={formatSeconds(stats.queueP50s)}
          detail={`1 job in 20 waits ${formatSeconds(stats.queueP95s)} or more`}
          tone={stats.queueP95s != null && stats.queueP95s >= 600 ? 'bg-warn-muted text-warn-foreground' : CI_OUTCOME_STYLE.waiting.chip}
          href="#ci-timeline"
        />
        <Tile
          Icon={IconPlay}
          label="Half the jobs finish within"
          value={formatSeconds(stats.durationP50s)}
          detail={`Across every job type this week; 1 in 20 take ${formatSeconds(stats.durationP95s)} or more`}
          tone={CI_OUTCOME_STYLE.waiting.chip}
          href="#ci-slow"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-fg">
            {weekJobs.toLocaleString()} job{weekJobs === 1 ? '' : 's'} in {days} days
          </h3>
          <span className="text-2xs text-fg-muted">
            Pass rate <span className="font-semibold text-fg tabular-nums">{formatPercent(stats.windowPassRate ?? stats.passRate)}</span> of jobs that finished testing
          </span>
        </div>
        {sampled && (
          <p className="text-2xs text-fg-muted" data-testid="ci-summary-sampled">
            The bar and the counts below are the newest {counts.total.toLocaleString()} of them.
          </p>
        )}
        {counts.total > 0 && (
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-overlay" role="img" aria-label={BAR_ORDER.map((b) => `${counts[b.key]} ${(b.label ?? CI_OUTCOME_STYLE[b.outcome].label).toLowerCase()}`).join(', ')}>
            {BAR_ORDER.map((b) =>
              counts[b.key] > 0 ? (
                <span key={b.key} className={CI_OUTCOME_STYLE[b.outcome].fill} style={{ width: `${(counts[b.key] / counts.total) * 100}%` }} />
              ) : null,
            )}
          </div>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs">
          {BAR_ORDER.map((b) => {
            const s = CI_OUTCOME_STYLE[b.outcome]
            return (
              <li key={b.key} className="inline-flex items-center gap-1.5">
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${s.chip}`}>
                  <s.Icon size={10} />
                </span>
                <span className="text-fg-secondary">{b.label ?? s.label}</span>
                <span className="font-semibold text-fg tabular-nums">{counts[b.key]}</span>
              </li>
            )
          })}
        </ul>
        {/* "Not a code failure" is said once, in the alert strip above; the legend below holds the meaning. */}
      </div>

      {/* Real per-hour counts (stats.hourly); older servers do not send them and this stays out. */}
      <CiWeekHeat hourly={stats.hourly} hourlyFrom={stats.hourlyFrom} now={Date.parse(overview.generatedAt)} />

      <details className="group border-t border-edge-subtle pt-2">
        <summary className="cursor-pointer text-2xs font-medium text-fg-secondary">What the colours and icons mean</summary>
        <CiOutcomeLegend className="mt-2" />
      </details>
    </div>
  )
}
