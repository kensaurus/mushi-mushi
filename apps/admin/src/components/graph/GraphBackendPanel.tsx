import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Card, Badge, Btn, ErrorAlert, RelativeTime } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'

interface GraphBackendStatus {
  backend: 'sql_only' | 'age_dual' | 'age_only'
  ageAvailable: boolean
  latestAudit: {
    id: string
    ran_at: string
    drift_count: number | null
    nodes_in_age: number | null
    edges_in_age: number | null
  } | null
  unsynced: { nodes: number | null; edges: number | null }
}

const BACKEND_TONE: Record<GraphBackendStatus['backend'], string> = {
  sql_only: 'bg-fg-faint/15 text-fg-muted border border-edge-subtle',
  age_dual: 'bg-info/15 text-info border border-info/30',
  age_only: 'bg-ok/15 text-ok border border-ok/30',
}

const BACKEND_LABEL: Record<GraphBackendStatus['backend'], string> = {
  sql_only: 'SQL only',
  age_dual: 'SQL + AGE (dual-write)',
  age_only: 'AGE only',
}

export function GraphBackendPanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<GraphBackendStatus>('/v1/admin/graph-backend/status')
  const [snapshotting, setSnapshotting] = useState(false)

  async function snapshot() {
    setSnapshotting(true)
    const res = await apiFetch<{ auditId: string }>(
      '/v1/admin/graph-backend/snapshot',
      { method: 'POST' },
    )
    setSnapshotting(false)
    if (res.ok && res.data) {
      toast.push({ tone: 'success', message: `Drift audit captured (${res.data.auditId.slice(0, 8)}…)` })
      reload()
    } else {
      toast.push({ tone: 'error', message: res.error?.message ?? 'Snapshot failed' })
    }
  }

  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-fg-secondary">Graph backend</h3>
          <p className="text-2xs text-fg-faint">
            Apache AGE drift audit. Only relevant if you've enabled the AGE dual-write path.
          </p>
        </div>
        <Btn size="sm" onClick={snapshot} disabled={snapshotting || !data?.ageAvailable}>
          {snapshotting ? 'Snapshotting…' : 'Snapshot drift'}
        </Btn>
      </div>

      {loading ? (
        <PanelSkeleton rows={3} label="Loading backend status" inCard={false} />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 text-2xs">
          <div>
            <div className="text-fg-faint mb-0.5">Backend mode</div>
            <Badge className={BACKEND_TONE[data.backend]}>{BACKEND_LABEL[data.backend]}</Badge>
          </div>
          <div>
            <div className="text-fg-faint mb-0.5">AGE extension</div>
            {data.ageAvailable ? (
              <Badge className="bg-ok/15 text-ok border border-ok/30">Available</Badge>
            ) : (
              <Badge className="bg-warn/15 text-warn border border-warn/30">Not installed</Badge>
            )}
          </div>
          <div>
            <div className="text-fg-faint mb-0.5">Unsynced nodes</div>
            <div className="font-mono tabular-nums text-fg">
              {data.unsynced.nodes != null ? data.unsynced.nodes.toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-fg-faint mb-0.5">Unsynced edges</div>
            <div className="font-mono tabular-nums text-fg">
              {data.unsynced.edges != null ? data.unsynced.edges.toLocaleString() : '—'}
            </div>
          </div>
          {data.latestAudit && (
            <div className="col-span-2 border-t border-edge-subtle pt-2 space-y-0.5">
              <div className="text-fg-faint">Last drift audit</div>
              <div className="font-mono text-fg-secondary">
                <RelativeTime value={data.latestAudit.ran_at} />
                {' · '}
                {data.latestAudit.drift_count != null
                  ? `${data.latestAudit.drift_count.toLocaleString()} drift`
                  : 'no drift count'}
                {data.latestAudit.nodes_in_age != null && (
                  <> · {data.latestAudit.nodes_in_age.toLocaleString()} nodes / {data.latestAudit.edges_in_age?.toLocaleString() ?? '—'} edges in AGE</>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  )
}
