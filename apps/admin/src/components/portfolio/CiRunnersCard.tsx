/**
 * CiRunnersCard — the Portfolio's compact CI view (Plan 022 Phase 4): test
 * machines online, the wait for a machine (p95), test machine failures in
 * 7 days and the top "Speed it up" advice, across every app the caller can
 * read. Links to /ci for the queue, timeline and map.
 *
 * Data: GET /v1/admin/ci/overview?days=7 (no project_id: every readable project)
 */

import { Btn, Card, Loading } from '../ui'
import { usePageData } from '../../lib/usePageData'
import type { CiOverview } from '../../lib/ciTypes'
import { formatSeconds, isCiOverviewEmpty } from '../../lib/ciView'
import { PageLoadError } from '../PageLoadError'

const PATH = '/v1/admin/ci/overview?days=7'

function Figure({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-muted">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${warn ? 'text-warn' : 'text-fg'}`}>{value}</dd>
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
      {loading && !data && <Loading text="Reading CI…" />}
      {data && isCiOverviewEmpty(data) && (
        <p className="text-xs text-fg-muted">No CI jobs seen yet across your apps.</p>
      )}
      {data && !isCiOverviewEmpty(data) && (() => {
        const online = data.hosts.filter((h) => !h.stale).length
        const top = [...data.advice].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity))[0]
        return (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <Figure label="Machines online" value={data.hosts.length ? `${online} of ${data.hosts.length}` : '—'} warn={online < data.hosts.length} />
              <Figure label="Wait for a machine (p95)" value={formatSeconds(data.stats.queueP95s)} warn={(data.stats.queueP95s ?? 0) >= 600} />
              <Figure label="Machine failures (7 d)" value={String(data.stats.infraFailures)} warn={data.stats.infraFailures > 0} />
            </dl>
            {top && (
              <p className="text-xs text-fg-secondary">
                <span className="font-medium text-fg">Speed it up:</span> {top.title}
              </p>
            )}
          </>
        )
      })()}
    </Card>
  )
}
