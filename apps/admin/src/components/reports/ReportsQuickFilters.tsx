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
import { useActiveProjectSignal } from '../../lib/activeProject'
import { useRealtimeReload } from '../../lib/realtime'
import { FilterChip } from '../ui'
import { FilterChipCell, FilterChipRail } from '../FilterChipRail'
import { criticalChipActive, criticalChipHint, criticalChipLabel, criticalChipParams } from '../../lib/criticalSurfaces'
import { SEVERITY_CHIPS, STATUS_CHIPS, statusChipCount, type ReportStatusStats } from '../../lib/reportsListFilters'

type StatsResponse = ReportStatusStats

interface Props {
  status: string
  severity: string
  /** The list's days window. The severity chip counts all time, so it is selected only when this is empty. */
  listDays?: string
  /** `enumeration` counts every app (All apps). Default is the pinned app. */
  scope?: 'enumeration' | 'project'
  onSetFilter: (key: string, value: string) => void
  /** Set several list params at once. Empty string clears the param. */
  onSetParams?: (updates: Record<string, string>) => void
}


export function ReportsQuickFilters({ status, severity, listDays = '', scope = 'project', onSetFilter, onSetParams }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const activeProjectSignal = useActiveProjectSignal()

  const load = useCallback(async () => {
    const res = await apiFetch<StatsResponse>('/v1/admin/stats', { scope })
    if (res.ok && res.data) setStats(res.data)
  }, [activeProjectSignal, scope])

  useEffect(() => {
    setStats(null)
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeReload(['reports'], load, { debounceMs: 1000 })

  const bySeverity = stats?.bySeverity ?? {}

  return (
    <div
      className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-1.5 rounded-sm border border-edge-subtle/60 bg-surface/95 px-2 py-2 backdrop-blur-sm"
      role="toolbar"
      aria-label="Quick filters"
    >
      <FilterChipRail trackId="reports-status" aria-label="Status filters">
        {STATUS_CHIPS.map((b) => {
          const count = stats ? statusChipCount(b.value, stats) : 0
          return (
            <FilterChipCell key={b.value || 'all'} active={status === b.value}>
              <FilterChip
                label={b.label}
                count={stats ? count : null}
                active={status === b.value}
                onClick={() => onSetFilter('status', status === b.value ? '' : b.value)}
                tone={b.tone}
                hint={
                  b.value === ''
                    ? 'Show every report regardless of status'
                    : b.value === 'open'
                      ? 'Show every report still waiting on a decision — anything not yet fixing, fixed or dismissed'
                      : `Show reports with status "${b.value}"`
                }
              />
            </FilterChipCell>
          )
        })}
      </FilterChipRail>
      <span aria-hidden className="mx-1 h-4 w-px bg-edge/60" />
      {SEVERITY_CHIPS.map((b) => (
        <FilterChip
          key={b.value}
          label={criticalChipLabel(b.label)}
          count={stats ? (bySeverity[b.value] ?? 0) : null}
          active={criticalChipActive({ severity, status, days: listDays }, b.value)}
          onClick={() => {
            const params = criticalChipParams({ severity, status, days: listDays }, b.value)
            if (onSetParams) onSetParams(params)
            else onSetFilter('severity', params.severity)
          }}
          tone={b.tone}
          hint={criticalChipHint(b.value)}
        />
      ))}
    </div>
  )
}
