/**
 * FILE: apps/admin/src/components/drift/SchemaChangesTimeline.tsx
 * PURPOSE: Schema changes, once scanned: how many API or database changes
 *          each day's scans found, with a dashed line per release and a dot
 *          on each day with a serious change (red while one is still open).
 *          Answers "did this start with a release?" at a glance.
 *
 * Data: GET /v1/admin/drift?project_id=&status=&limit=200  (every status)
 *       GET /v1/admin/releases?limit=50&status=published
 */

import { Card, Loading } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { MetricTimeline } from '../charts/MetricTimeline'
import { usePageData } from '../../lib/usePageData'

interface ChangeRow {
  id: string
  severity: 'info' | 'warn' | 'critical'
  status: 'open' | 'dismissed'
  created_at: string
}

interface ReleaseRow {
  project_id: string
  version: string | null
  title: string | null
  published_at: string | null
}

interface DayCount {
  ts: string
  value: number
  serious: number
  seriousOpen: number
}

/** @internal Exported for tests only. Changes per UTC day, oldest first. */
export function changesPerDay(rows: readonly ChangeRow[]): DayCount[] {
  const days = new Map<string, DayCount>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const d = days.get(day) ?? { ts: `${day}T12:00:00Z`, value: 0, serious: 0, seriousOpen: 0 }
    d.value += 1
    if (r.severity === 'critical') {
      d.serious += 1
      if (r.status === 'open') d.seriousOpen += 1
    }
    days.set(day, d)
  }
  return [...days.values()].sort((a, b) => a.ts.localeCompare(b.ts))
}

export function SchemaChangesTimeline({ projectId }: { projectId: string }) {
  const changes = usePageData<{ data: ChangeRow[] }>(`/v1/admin/drift?project_id=${projectId}&status=&limit=200`, { deps: [projectId] })
  const releases = usePageData<{ data: ReleaseRow[] }>('/v1/admin/releases?limit=50&status=published', { deps: [projectId] })

  if (changes.error) return <PageLoadError error={changes.error} resource="the schema changes" onRetry={changes.reload} />
  if (changes.loading && !changes.data) return <Loading text="Drawing the changes…" />

  const days = changesPerDay(changes.data?.data ?? [])
  if (days.length === 0) return null
  const markers = (releases.data?.data ?? [])
    .filter((r) => r.project_id === projectId && r.published_at)
    .map((r) => ({ ts: r.published_at as string, label: r.version ?? r.title ?? 'Release' }))

  return (
    <Card className="space-y-2 p-3" data-testid="schema-changes-timeline">
      <h2 className="sr-only">
        Changes found per day
      </h2>
      <MetricTimeline
        title="Changes found per day"
        points={days.map((d) => ({ ts: d.ts, value: d.value }))}
        markers={markers}
        dots={days
          .filter((d) => d.serious > 0)
          .map((d) => ({
            ts: d.ts,
            value: d.value,
            label: d.seriousOpen > 0 ? `${d.seriousOpen} serious change${d.seriousOpen === 1 ? '' : 's'} to review` : `${d.serious} serious, already reviewed`,
            state: d.seriousOpen > 0 ? 'open' : 'closed',
          }))}
        formatValue={(v) => String(Math.round(v))}
      />
    </Card>
  )
}
