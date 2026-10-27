/**
 * FILE: apps/admin/src/components/anomalies/SpikesOverview.tsx
 * PURPOSE: Unusual spikes, once there is data: each metric drawn over time
 *          with a dashed line per release and a dot per spike, and under it
 *          the spikes still waiting for you with Confirm / Dismiss. Metrics
 *          with an open spike come first; at most three are drawn (the rest
 *          are on the Metrics tab).
 *
 * Data: GET /v1/admin/metric-series?project_id=  (newest 500 points)
 *       GET /v1/admin/anomalies?project_id=&status=  (every status)
 *       GET /v1/admin/releases?limit=50  (published ones become markers)
 */

import { Btn, Loading } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { MetricTimeline } from '../charts/MetricTimeline'
import { usePageData } from '../../lib/usePageData'
import { pluralizeWithCount } from '../../lib/format'

interface MetricPoint {
  ts: string
  value: number
  metric_name: string
}

interface Spike {
  id: string
  metric_name: string
  detected_at: string
  value: number
  status: 'open' | 'confirmed' | 'dismissed'
  method: string
}

interface ReleaseRow {
  id: string
  project_id: string
  version: string | null
  title: string | null
  status: string
  published_at: string | null
}

interface MetricView {
  name: string
  points: Array<{ ts: string; value: number }>
  spikes: Spike[]
  open: Spike[]
}

const MAX_CHARTS = 3

/** @internal Exported for tests only. Metrics with open spikes first, then the busiest. */
export function buildMetricViews(points: readonly MetricPoint[], spikes: readonly Spike[]): MetricView[] {
  const names = new Set([...points.map((p) => p.metric_name), ...spikes.map((s) => s.metric_name)])
  const views = [...names].map((name) => {
    const mine = spikes.filter((s) => s.metric_name === name)
    return {
      name,
      points: points.filter((p) => p.metric_name === name).map((p) => ({ ts: p.ts, value: p.value })),
      spikes: mine,
      open: mine.filter((s) => s.status === 'open'),
    }
  })
  return views
    .filter((v) => v.points.length > 0)
    .sort((a, b) => b.open.length - a.open.length || b.points.length - a.points.length || a.name.localeCompare(b.name))
}

/** Detector ids in words. */
function spikeKind(method: string): string {
  if (method === 'release-regression') return 'Started with a release'
  if (method === 'page-hinkley') return 'Slow drift'
  return 'Sudden jump'
}

export function SpikesOverview({
  projectId,
  onConfirm,
  onDismiss,
}: {
  projectId: string
  onConfirm: (id: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
}) {
  const series = usePageData<{ data: MetricPoint[] }>(`/v1/admin/metric-series?project_id=${projectId}`, { deps: [projectId] })
  const anomalies = usePageData<{ data: Spike[] }>(`/v1/admin/anomalies?project_id=${projectId}&limit=200&status=`, { deps: [projectId] })
  const decide = async (run: (id: string) => Promise<void>, id: string) => {
    await run(id)
    anomalies.reload()
  }
  const releases = usePageData<{ data: ReleaseRow[] }>('/v1/admin/releases?limit=50&status=published', { deps: [projectId] })

  if (series.error) return <PageLoadError error={series.error} resource="your metrics" onRetry={series.reload} />
  if (series.loading && !series.data) return <Loading text="Drawing your metrics…" />

  const views = buildMetricViews(series.data?.data ?? [], anomalies.data?.data ?? [])
  if (views.length === 0) return null
  const markers = (releases.data?.data ?? [])
    .filter((r) => r.project_id === projectId && r.published_at)
    .map((r) => ({ ts: r.published_at as string, label: r.version ?? r.title ?? 'Release' }))
  const shown = views.slice(0, MAX_CHARTS)

  return (
    <section aria-labelledby="spikes-overview" className="space-y-3" data-testid="spikes-overview">
      <h2 id="spikes-overview" className="text-sm font-semibold text-fg">
        Your metrics, with releases and spikes
      </h2>
      {shown.map((v) => (
        <div key={v.name} className="space-y-2 rounded-md border border-edge-subtle bg-surface-raised p-3">
          <MetricTimeline
            title={v.name}
            points={v.points}
            markers={markers}
            dots={v.spikes.map((s) => ({
              ts: s.detected_at,
              value: s.value,
              label: `${spikeKind(s.method)} (${s.status === 'open' ? 'waiting for you' : s.status})`,
              state: s.status === 'open' ? 'open' : 'closed',
            }))}
          />
          {v.open.length > 0 ? (
            <ul className="list-none space-y-1.5 p-0" aria-label={`Spikes to check on ${v.name}`}>
              {v.open.slice(0, 3).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 text-fg-secondary">
                    <span className="font-medium text-danger">{spikeKind(s.method)}</span>
                    {' · '}
                    {s.value} on {new Date(s.detected_at).toLocaleString()}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <Btn size="sm" variant="primary" onClick={() => void decide(onConfirm, s.id)}>
                      Confirm
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => void decide(onDismiss, s.id)}>
                      Dismiss
                    </Btn>
                  </span>
                </li>
              ))}
              {v.open.length > 3 ? (
                <li className="text-2xs text-fg-muted">{pluralizeWithCount(v.open.length - 3, 'more spike')} on the Spikes tab.</li>
              ) : null}
            </ul>
          ) : (
            <p className="text-2xs text-fg-muted">No spike waiting on this metric.</p>
          )}
        </div>
      ))}
      {views.length > shown.length ? (
        <p className="text-2xs text-fg-muted">{pluralizeWithCount(views.length - shown.length, 'more metric')} on the Metrics tab.</p>
      ) : null}
    </section>
  )
}
