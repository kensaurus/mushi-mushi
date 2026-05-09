import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Card, Badge, Btn, ErrorAlert, RelativeTime, DetailRows, type DetailRowItem } from '../ui'
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

/**
 * Translate a `GraphBackendStatus` into the standard `DetailRowItem` shape
 * used across the admin app. Keeping the row-construction here (instead of
 * inlined in the JSX) means tone choices and conditional rows are easy to
 * reason about, and the JSX stays a single readable expression.
 *
 * Tone choices:
 * - Backend mode + AGE extension stay as Badges (semantic surfaces with
 *   their own chrome) — DetailRows just hosts them.
 * - Unsynced node/edge counts use `warn` when > 0 (drift exists) and
 *   `ok` when 0 (in sync), so an operator's eye lands on the column
 *   that needs attention.
 * - Last drift audit gets `wrap: true` so the relative-time + drift-
 *   count + nodes/edges line stays on its own row instead of being
 *   crushed into a right-aligned column.
 */
function buildBackendRows(data: GraphBackendStatus): DetailRowItem[] {
  const rows: DetailRowItem[] = [
    {
      label: 'Backend mode',
      value: <Badge className={BACKEND_TONE[data.backend]}>{BACKEND_LABEL[data.backend]}</Badge>,
      hint: 'How the report graph is currently stored — pure SQL, dual-write to AGE, or AGE-only.',
    },
    {
      label: 'AGE extension',
      value: data.ageAvailable
        ? <Badge className="bg-ok/15 text-ok border border-ok/30">Available</Badge>
        : <Badge className="bg-warn/15 text-warn border border-warn/30">Not installed</Badge>,
      hint: 'Whether the Apache AGE Postgres extension is loaded on the database.',
    },
    {
      label: 'Unsynced nodes',
      value: data.unsynced.nodes != null ? data.unsynced.nodes.toLocaleString() : '—',
      mono: true,
      tone: (data.unsynced.nodes ?? 0) > 0 ? 'warn' : 'ok',
      hint: 'Nodes present in SQL but not yet mirrored into AGE.',
    },
    {
      label: 'Unsynced edges',
      value: data.unsynced.edges != null ? data.unsynced.edges.toLocaleString() : '—',
      mono: true,
      tone: (data.unsynced.edges ?? 0) > 0 ? 'warn' : 'ok',
      hint: 'Edges present in SQL but not yet mirrored into AGE.',
    },
  ]
  if (data.latestAudit) {
    const a = data.latestAudit
    rows.push({
      label: 'Last drift audit',
      value: (
        <span className="font-mono text-fg-secondary">
          <RelativeTime value={a.ran_at} />
          {' · '}
          {a.drift_count != null
            ? `${a.drift_count.toLocaleString()} drift`
            : 'no drift count'}
          {a.nodes_in_age != null && (
            <> · {a.nodes_in_age.toLocaleString()} nodes / {a.edges_in_age?.toLocaleString() ?? '—'} edges in AGE</>
          )}
        </span>
      ),
      wrap: true,
      hint: 'When the most recent SQL ↔ AGE drift snapshot ran.',
    })
  }
  return rows
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
        <Btn size="sm" onClick={snapshot} disabled={snapshotting || !data?.ageAvailable} loading={snapshotting}>
          Snapshot drift
        </Btn>
      </div>

      {loading ? (
        <PanelSkeleton rows={3} label="Loading backend status" inCard={false} />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : data ? (
        <DetailRows items={buildBackendRows(data)} />
      ) : null}
    </Card>
  )
}
