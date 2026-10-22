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
import { buildCiQueue, ciOutcomeCounts, ciVerdict, formatPercent, formatSeconds, type CiJobOutcome } from '../../lib/ciView'
import { useNow } from '../../lib/useNow'
import { IconAlertTriangle, IconCheck, IconClock, IconGauge, IconInfo, IconPlay } from '../icons'
import { Card } from '../ui'
import { CI_OUTCOME_STYLE, CiOutcomeLegend } from './ciOutcome'

const VERDICT_TONE = {
  ok: { Icon: IconCheck, ring: 'border-ok/30 bg-ok-muted/40', icon: 'text-ok' },
  warn: { Icon: IconAlertTriangle, ring: 'border-warn/35 bg-warn-muted/45', icon: 'text-warn-foreground' },
  danger: { Icon: IconAlertTriangle, ring: 'border-danger/30 bg-danger-muted/40', icon: 'text-danger' },
  neutral: { Icon: IconInfo, ring: 'border-edge-subtle bg-surface-overlay/40', icon: 'text-fg-secondary' },
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
      className="group flex min-w-0 items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2.5 hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
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
  const now = useNow(15_000)
  const verdict = ciVerdict(overview, now)
  const queue = buildCiQueue(overview.jobs, now)
  const counts = ciOutcomeCounts(overview.stats)
  const { stats } = overview
  const tone = VERDICT_TONE[verdict.tone]
  const days = overview.window.days

  return (
    <Card className="flex flex-col gap-3 p-3" data-testid="ci-summary">
      <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${tone.ring}`} role="status">
        <tone.Icon size={16} className={`mt-0.5 shrink-0 ${tone.icon}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg" data-testid="ci-verdict">
            {verdict.headline}
          </p>
          {verdict.detail && <p className="text-xs text-fg-secondary">{verdict.detail}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile
          Icon={IconClock}
          label="Waiting now"
          value={queue.waiting.length}
          detail={queue.waiting.length ? 'Queued for a free test machine' : 'Nothing is queued'}
          tone={queue.waiting.length ? 'bg-warn-muted text-warn-foreground' : CI_OUTCOME_STYLE.waiting.chip}
          href="#ci-queue"
        />
        <Tile
          Icon={IconPlay}
          label="Running now"
          value={queue.running.length}
          detail={queue.running.length ? 'On a test machine right now' : 'No machine is busy'}
          tone={CI_OUTCOME_STYLE.running.chip}
          href="#ci-queue"
        />
        <Tile
          Icon={IconGauge}
          label="Typical wait for a machine"
          value={formatSeconds(stats.queueP50s)}
          detail={`1 job in 20 waits ${formatSeconds(stats.queueP95s)} or more`}
          tone={stats.queueP95s != null && stats.queueP95s >= 600 ? 'bg-warn-muted text-warn-foreground' : CI_OUTCOME_STYLE.waiting.chip}
          href="#ci-timeline"
        />
        <Tile
          Icon={IconPlay}
          label="Typical run time"
          value={formatSeconds(stats.durationP50s)}
          detail={`The slowest 1 in 20 take ${formatSeconds(stats.durationP95s)} or more`}
          tone={CI_OUTCOME_STYLE.waiting.chip}
          href="#ci-slow"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-fg">
            {counts.total} job{counts.total === 1 ? '' : 's'} in {days} days
          </h3>
          <span className="text-2xs text-fg-muted">
            Pass rate <span className="font-semibold text-fg tabular-nums">{formatPercent(stats.passRate)}</span> of jobs that finished testing
          </span>
        </div>
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
        {counts.infra > 0 && (
          <p className="text-2xs text-fg-muted">
            <span className={`font-medium ${CI_OUTCOME_STYLE.infra.text}`}>{CI_OUTCOME_STYLE.infra.label}</span> is not a code failure: the
            machine died or never picked the job up, so the code was never tested. Re-run those jobs.
          </p>
        )}
      </div>

      <details className="group rounded-md border border-edge-subtle px-3 py-2">
        <summary className="cursor-pointer text-2xs font-medium text-fg-secondary">What the colours and icons mean</summary>
        <CiOutcomeLegend className="mt-2" />
      </details>
    </Card>
  )
}
