import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Card, Badge, Btn, ErrorAlert, RelativeTime, DetailRows, type DetailRowItem } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { CHIP_TONE } from '../../lib/chipTone'

export interface GraphBackendStatus {
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
  sql_only: CHIP_TONE.neutral,
  age_dual: CHIP_TONE.neutral,
  age_only: CHIP_TONE.neutral,
}

const BACKEND_LABEL: Record<GraphBackendStatus['backend'], string> = {
  sql_only: 'SQL only',
  age_dual: 'SQL + AGE (dual-write)',
  age_only: 'AGE only',
}

/**
 * Rows for the backend card: the one place the storage mode is stated
 * (fresh-eyes 2026-11-18 found it four times on the tab). AGE is optional, so
 * "not installed" is neutral, and the SQL to AGE sync rows only exist when AGE is
 * in use: "Sync pending" in SQL-only mode described a copy that does not run.
 */
export function buildBackendRows(data: GraphBackendStatus): DetailRowItem[] {
  const ageInUse = data.backend !== 'sql_only' && data.ageAvailable
  const rows: DetailRowItem[] = [
    {
      label: 'Stored in',
      value: <Badge className={BACKEND_TONE[data.backend]}>{BACKEND_LABEL[data.backend]}</Badge>,
      hint: 'How the report graph is stored: plain SQL, SQL plus a copy in Apache AGE, or AGE only.',
    },
    {
      label: 'Apache AGE (optional)',
      value: data.ageAvailable ? 'Installed' : 'Not installed',
      tone: 'muted',
      hint: 'An optional Postgres extension for graph queries. The map works without it.',
    },
  ]
  if (!ageInUse) return rows
  const syncValue = (n: number | null) => (n == null ? 'Not checked yet' : n.toLocaleString())
  const syncTone = (n: number | null): DetailRowItem['tone'] => (n == null ? 'muted' : n > 0 ? 'warn' : undefined)
  rows.push(
    {
      label: 'Items not copied to AGE',
      value: syncValue(data.unsynced.nodes),
      tone: syncTone(data.unsynced.nodes),
      hint: 'Items present in SQL but not yet copied into AGE.',
    },
    {
      label: 'Links not copied to AGE',
      value: syncValue(data.unsynced.edges),
      tone: syncTone(data.unsynced.edges),
      hint: 'Links present in SQL but not yet copied into AGE.',
    },
  )
  if (data.latestAudit) {
    const a = data.latestAudit
    rows.push({
      label: 'Last drift check',
      value: (
        <span className="tabular-nums text-fg-secondary">
          <RelativeTime value={a.ran_at} />
          {' · '}
          {a.drift_count != null ? `${a.drift_count.toLocaleString()} differences` : 'difference count not recorded'}
          {a.nodes_in_age != null && (
            <> · {a.nodes_in_age.toLocaleString()} items / {a.edges_in_age?.toLocaleString() ?? 'not counted'} links in AGE</>
          )}
        </span>
      ),
      wrap: true,
      hint: 'When the most recent SQL and AGE drift snapshot ran.',
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
      <div className="flex items-start justify-between mb-2 gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary">Graph storage</h3>
        {/* Drift snapshots compare SQL with AGE; without AGE there is nothing to
            compare, so the button only exists when it can run. */}
        {data?.ageAvailable ? (
          <Btn size="sm" onClick={snapshot} disabled={snapshotting} loading={snapshotting} className="shrink-0 whitespace-nowrap">
            Snapshot drift
          </Btn>
        ) : null}
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
