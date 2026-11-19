/**
 * CiRunnersCard — the Portfolio's compact CI view (Plan 022 Phase 4): test
 * machines online, the wait for a machine (p95), test machine failures in
 * 7 days and the top "Speed it up" advice, across every app the caller can
 * read. Links to /ci for the queue, timeline and map.
 *
 * Data: GET /v1/admin/ci/overview?days=7 (no project_id: every readable project)
 */

import { Btn, Card } from '../ui'
import { TimedLoading } from './TimedLoading'
import { usePageData } from '../../lib/usePageData'
import type { CiOverview } from '../../lib/ciTypes'
import { formatSeconds, isCiOverviewEmpty } from '../../lib/ciView'
import { PageLoadError } from '../PageLoadError'
import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'

const PATH = '/v1/admin/ci/overview?days=7'

/** 2026-11-18: each figure carries its state as a shape and colour (● fine, ◆ slow, ▲ broken), not colour alone. */
const FIGURE_INK: Record<SignalTone, string> = { ...TONE_INK, ok: 'text-fg', info: 'text-fg' }

function Figure({ label, value, tone }: { label: string; value: string; tone: SignalTone }) {
  return (
    <div className="min-w-0" data-tone={tone}>
      <dt className="text-2xs text-fg-muted">{label}</dt>
      <dd className={`flex items-center gap-1.5 text-base font-semibold tabular-nums ${FIGURE_INK[tone]}`}>
        <StatusGlyph tone={tone} />
        {value}
      </dd>
    </div>
  )
}

export function CiRunnersCard() {
  const { data, loading, error, reload } = usePageData<CiOverview>(PATH, { scope: 'enumeration' })

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="portfolio-ci-runners">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">CI runners</h3>
          <p className="text-xs text-fg-muted">Why fixes are slow to land: where tests run and how long they wait.</p>
        </div>
        <Btn size="sm" variant="ghost" to="/ci">
          Open CI runners
        </Btn>
      </div>

      {error && <PageLoadError error={error} resource="CI runners" endpoint={PATH} onRetry={reload} />}
      <TimedLoading waiting={loading && !data && !error} text="Reading CI…" what="CI runners" onRetry={reload} testId="portfolio-ci-runners-not-checked" />
      {data && isCiOverviewEmpty(data) && (
        <p className="text-xs text-fg-muted">No CI jobs seen yet across your apps.</p>
      )}
      {data && !isCiOverviewEmpty(data) && (() => {
        const online = data.hosts.filter((h) => !h.stale).length
        const top = [...data.advice].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity))[0]
        return (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <Figure
                label="Machines online"
                value={data.hosts.length ? `${online} of ${data.hosts.length}` : '—'}
                tone={!data.hosts.length ? 'off' : online === 0 ? 'danger' : online < data.hosts.length ? 'warn' : 'ok'}
              />
              <Figure
                label="Wait for a machine (p95)"
                value={formatSeconds(data.stats.queueP95s)}
                tone={data.stats.queueP95s == null ? 'off' : data.stats.queueP95s >= 1800 ? 'danger' : data.stats.queueP95s >= 600 ? 'warn' : 'ok'}
              />
              <Figure label="Machine failures (7 d)" value={String(data.stats.infraFailures)} tone={data.stats.infraFailures >= 10 ? 'danger' : data.stats.infraFailures > 0 ? 'warn' : 'ok'} />
            </dl>
            {top && (
              <p className="flex items-start gap-1.5 text-xs text-fg-secondary">
                <StatusGlyph tone={top.severity === 'high' ? 'danger' : 'warn'} className="mt-0.5" />
                <span>
                  <span className="font-medium text-fg">Speed it up:</span> {top.title}
                </span>
              </p>
            )}
          </>
        )
      })()}
    </Card>
  )
}
