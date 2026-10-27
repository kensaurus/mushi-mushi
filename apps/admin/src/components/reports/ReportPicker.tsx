/**
 * FILE: apps/admin/src/components/reports/ReportPicker.tsx
 * PURPOSE: Pick a bug by its title instead of pasting its id (console
 *          journeys 2026-10-27). Agent skills told the user to copy a report
 *          UUID out of the address bar, and Research's "Attach to report"
 *          took a pasted id; both now use this picker.
 *
 *          A search box over the active app's bugs (newest first, title
 *          search through `?q=`), a short list of matches, and the picked bug
 *          shown as a chip with "Change". The caller gets the whole row, so
 *          it can name the bug in its own confirmation.
 */

import { useEffect, useId, useState } from 'react'
import { usePageData } from '../../lib/usePageData'
import { relativeTime } from '../../lib/setupGuideSteps'
import { SEVERITY, severityLabel } from '../../lib/tokens'
import { Badge, Btn, Input } from '../ui'

/** @public The fields the picker reads from `GET /v1/admin/reports`. */
export interface PickableReport {
  id: string
  title?: string | null
  summary?: string | null
  description?: string | null
  severity?: string | null
  status?: string | null
  created_at?: string | null
}

export interface ReportPickerProps {
  /** The picked bug, or null. */
  value: PickableReport | null
  onChange: (report: PickableReport | null) => void
  label?: string
  /** How many matches to list. */
  limit?: number
  /** Extra list filter, e.g. `status=new`. */
  query?: string
  disabled?: boolean
}

const SEARCH_DEBOUNCE_MS = 250

/** @internal Exported for tests. The bug's name as the reports list shows it. */
export function reportPickerTitle(report: PickableReport): string {
  const raw = report.title ?? report.summary ?? report.description ?? ''
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  if (!oneLine) return `Bug ${report.id.slice(0, 8)}`
  return oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine
}

/** @internal Exported for tests. The list request for a search term. */
export function reportPickerPath(search: string, limit: number, query?: string): string {
  const params = new URLSearchParams({ limit: String(limit), sort: 'created_at', dir: 'desc' })
  const q = search.trim()
  if (q) params.set('q', q)
  const base = `/v1/admin/reports?${params.toString()}`
  return query ? `${base}&${query}` : base
}

export function ReportPicker({ value, onChange, label = 'Bug', limit = 6, query, disabled }: ReportPickerProps) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const listId = useId()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  const { data, loading, error } = usePageData<{ reports: PickableReport[] }>(
    value ? null : reportPickerPath(debounced, limit, query),
    { deps: [debounced, limit, query ?? ''] },
  )
  const reports = data?.reports ?? []

  if (value) {
    return (
      <div className="min-w-0" data-testid="report-picker-selected">
        <p className="mb-1 text-2xs font-medium text-fg-muted">{label}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-edge-subtle bg-surface-raised px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-fg" title={reportPickerTitle(value)}>
            {reportPickerTitle(value)}
          </span>
          <span className="font-mono text-3xs text-fg-faint">{value.id.slice(0, 8)}</span>
          <Btn size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
            Change
          </Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0" data-testid="report-picker">
      <Input
        type="search"
        label={label}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your bugs by title"
        aria-controls={listId}
        disabled={disabled}
      />
      <ul id={listId} aria-label="Matching bugs" className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
        {error ? (
          <li className="px-1 text-2xs text-danger">Couldn't load your bugs. Try again in a moment.</li>
        ) : loading && reports.length === 0 ? (
          <li className="px-1 text-2xs text-fg-muted">Loading bugs…</li>
        ) : reports.length === 0 ? (
          <li className="px-1 text-2xs text-fg-muted">
            {debounced.trim() ? `No bugs match "${debounced.trim()}".` : 'No bugs on this app yet.'}
          </li>
        ) : (
          reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(r)}
                className="flex w-full min-w-0 items-center gap-2 rounded-sm border border-edge-subtle px-2.5 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-60"
              >
                {r.severity ? (
                  <Badge className={`shrink-0 ${SEVERITY[r.severity] ?? ''}`}>{severityLabel(r.severity)}</Badge>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{reportPickerTitle(r)}</span>
                <span className="shrink-0 text-3xs text-fg-faint">{relativeTime(r.created_at ?? null) ?? ''}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
