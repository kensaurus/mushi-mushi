/**
 * FILE: apps/admin/src/components/reports/ReportsQuickFilters.tsx
 * PURPOSE: Linear-style quick-filter chip rail above the reports table.
 *          Shows per-status counts pulled from /v1/admin/stats and keeps
 *          them fresh via realtime so the "New 12" chip reflects what's
 *          actually sitting in the inbox right now, not what it looked
 *          like when the user first loaded the page.
 *
 *          Design intent:
 *            - Discoverability: users shouldn't need to open a <Select>
 *              to see how big the "new" bucket is.
 *            - One-click triage pivot: every chip is a toggle — click to
 *              filter, click again to clear.
 *            - Quiet when empty: chips with 0 results still render so
 *              the user learns the shape of the inbox (and knows the
 *              filter exists), but use a muted tone.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useRealtimeReload } from '../../lib/realtime'
import { FilterChip } from '../ui'

interface StatsResponse {
  total?: number
  byStatus?: Record<string, number>
  bySeverity?: Record<string, number>
}

interface Props {
  status: string
  severity: string
  onSetFilter: (key: string, value: string) => void
}

const STATUS_BUCKETS: Array<{ value: string; label: string; tone: 'default' | 'warn' | 'info' | 'brand' | 'ok' }> = [
  { value: '',          label: 'All',         tone: 'default' },
  { value: 'new',       label: 'New',         tone: 'warn' },
  { value: 'queued',    label: 'Queued',      tone: 'info' },
  { value: 'triaged',   label: 'Triaged',     tone: 'brand' },
  { value: 'resolved',  label: 'Resolved',    tone: 'ok' },
  { value: 'dismissed', label: 'Dismissed',   tone: 'default' },
]

const SEVERITY_BUCKETS: Array<{ value: string; label: string; tone: 'default' | 'warn' | 'danger' }> = [
  { value: 'critical', label: 'Critical', tone: 'danger' },
  { value: 'major',    label: 'Major',    tone: 'warn' },
]

export function ReportsQuickFilters({ status, severity, onSetFilter }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch<StatsResponse>('/v1/admin/stats')
    if (res.ok && res.data) setStats(res.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeReload(['reports'], load, { debounceMs: 1000 })

  const byStatus = stats?.byStatus ?? {}
  const bySeverity = stats?.bySeverity ?? {}
  const total = stats?.total ?? 0

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Quick filters">
      {STATUS_BUCKETS.map((b) => {
        const count = b.value === '' ? total : (byStatus[b.value] ?? 0)
        return (
          <FilterChip
            key={b.value || 'all'}
            label={b.label}
            count={stats ? count : null}
            active={status === b.value}
            onClick={() => onSetFilter('status', status === b.value ? '' : b.value)}
            tone={b.tone}
            hint={b.value === '' ? 'Show every report regardless of status' : `Show reports with status "${b.value}"`}
          />
        )
      })}
      <span aria-hidden className="mx-1 h-4 w-px bg-edge/60" />
      {SEVERITY_BUCKETS.map((b) => (
        <FilterChip
          key={b.value}
          label={b.label}
          count={stats ? (bySeverity[b.value] ?? 0) : null}
          active={severity === b.value}
          onClick={() => onSetFilter('severity', severity === b.value ? '' : b.value)}
          tone={b.tone}
          hint={`Filter to ${b.value}-severity reports`}
        />
      ))}
    </div>
  )
}
