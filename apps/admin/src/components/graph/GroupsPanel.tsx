import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Card, Btn, ErrorAlert, EmptyState, Badge, RelativeTime } from '../ui'
import { TableSkeleton } from '../skeletons/TableSkeleton'

interface ReportGroup {
  id: string
  project_id: string
  signature: string | null
  representative_summary: string | null
  representative_category: string | null
  representative_severity: string | null
  report_count: number
  created_at: string
  updated_at: string
  reports?: Array<{
    id: string
    summary: string | null
    severity: string | null
    status: string
    created_at: string
  }>
}

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-danger/15 text-danger border border-danger/30',
  high: 'bg-warn/15 text-warn border border-warn/30',
  medium: 'bg-info/15 text-info border border-info/30',
  low: 'bg-fg-faint/15 text-fg-muted border border-edge-subtle',
}

export function GroupsPanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<{ groups: ReportGroup[] }>('/v1/admin/groups')
  const [mergeSource, setMergeSource] = useState<ReportGroup | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string>('')
  const [merging, setMerging] = useState(false)

  const groups = useMemo(
    () => [...(data?.groups ?? [])].sort((a, b) => b.report_count - a.report_count),
    [data],
  )

  async function performMerge() {
    if (!mergeSource || !mergeTarget) return
    setMerging(true)
    const res = await apiFetch(`/v1/admin/groups/${mergeSource.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ targetGroupId: mergeTarget }),
    })
    setMerging(false)
    if (res.ok) {
      toast.push({ tone: 'success', message: 'Groups merged' })
      setMergeSource(null)
      setMergeTarget('')
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Merge failed' })
    }
  }

  const mergeCandidates = useMemo(
    () =>
      mergeSource
        ? groups.filter((g) => g.id !== mergeSource.id && g.project_id === mergeSource.project_id)
        : [],
    [groups, mergeSource],
  )

  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-fg-secondary">Report groups</h3>
          <p className="text-2xs text-fg-faint">
            Reports the LLM clustered as duplicates of the same underlying bug. Merge two groups when the dedup signature missed a match.
          </p>
        </div>
        <span className="text-2xs font-mono text-fg-faint">{groups.length} groups</span>
      </div>

      {loading ? (
        <TableSkeleton rows={5} columns={4} showFilters={false} label="Loading groups" />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          description="Stage 2 clusters reports with the same root cause into a group. They'll appear here once your project has a few classified reports."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-fg-faint">
              <tr>
                <th className="text-left font-normal px-2 py-1">Representative</th>
                <th className="text-left font-normal px-2 py-1">Severity</th>
                <th className="text-right font-normal px-2 py-1">Reports</th>
                <th className="text-left font-normal px-2 py-1">Updated</th>
                <th className="text-right font-normal px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const sevTone = g.representative_severity
                  ? SEVERITY_TONE[g.representative_severity] ?? SEVERITY_TONE.low
                  : SEVERITY_TONE.low
                const firstReport = g.reports?.[0]
                return (
                  <tr key={g.id} className="border-t border-edge-subtle align-top">
                    <td className="px-2 py-1.5 max-w-[24rem]">
                      <div className="text-fg-secondary line-clamp-2">
                        {g.representative_summary ?? '(no summary)'}
                      </div>
                      <div className="text-2xs text-fg-faint font-mono mt-0.5">
                        {g.representative_category ?? '—'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={sevTone}>{g.representative_severity ?? '—'}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {g.report_count}
                    </td>
                    <td className="px-2 py-1.5 text-fg-muted">
                      <RelativeTime value={g.updated_at} />
                    </td>
                    <td className="px-2 py-1.5 text-right space-x-1 whitespace-nowrap">
                      {firstReport && (
                        <Link
                          to={`/reports/${firstReport.id}`}
                          className="text-brand hover:text-brand-hover text-2xs"
                        >
                          View
                        </Link>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => setMergeSource(g)}>
                        Merge
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {mergeSource && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in"
          onClick={() => setMergeSource(null)}
        >
          <Card
            elevated
            className="w-full max-w-lg p-4 space-y-3 motion-safe:animate-mushi-modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-fg">Merge group</h3>
              <p className="text-2xs text-fg-faint mt-1">
                All {mergeSource.report_count} reports from{' '}
                <span className="font-mono text-fg-muted">{mergeSource.representative_summary?.slice(0, 60) ?? mergeSource.id.slice(0, 8)}</span>
                {' '}will move into the destination group. The source group is then deleted.
              </p>
            </div>
            <div>
              <label className="text-2xs text-fg-muted block mb-1">Destination group</label>
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="w-full bg-surface-overlay border border-edge-subtle rounded-sm px-2 py-1.5 text-2xs text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40"
              >
                <option value="">— select group —</option>
                {mergeCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.representative_summary ?? c.id).slice(0, 80)} ({c.report_count} reports)
                  </option>
                ))}
              </select>
              {mergeCandidates.length === 0 && (
                <p className="text-2xs text-warn mt-1">
                  No other groups in this project to merge into.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-1.5">
              <Btn variant="ghost" onClick={() => setMergeSource(null)}>Cancel</Btn>
              <Btn onClick={performMerge} disabled={merging || !mergeTarget}>
                {merging ? 'Merging…' : 'Merge groups'}
              </Btn>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
