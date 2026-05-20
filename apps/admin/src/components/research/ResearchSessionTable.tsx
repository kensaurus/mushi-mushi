/**
 * FILE: apps/admin/src/components/research/ResearchSessionTable.tsx
 * PURPOSE: History table for Firecrawl research sessions with mode/age filters.
 */

import { Badge, RelativeTime, SegmentedControl, EmptyState } from '../ui'
import type { SessionRow } from './types'
import { MODE_TONE } from './types'

type SessionMode = 'all' | 'search' | 'scrape'
type SessionAge = 'all' | '24h' | '7d'

const AGE_LIMITS: Record<SessionAge, number | null> = {
  all: null,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface Props {
  sessions: SessionRow[]
  projectName: string | null
  modeFilter: SessionMode
  ageFilter: SessionAge
  onModeFilterChange: (mode: SessionMode) => void
  onAgeFilterChange: (age: SessionAge) => void
  onOpenSession: (id: string) => void
  activeSessionId?: string | null
}

export function filterSessions(
  sessions: SessionRow[],
  modeFilter: SessionMode,
  ageFilter: SessionAge,
): SessionRow[] {
  return sessions.filter((s) => {
    if (modeFilter !== 'all' && s.mode !== modeFilter) return false
    const limit = AGE_LIMITS[ageFilter]
    if (limit !== null) {
      const age = Date.now() - new Date(s.created_at).getTime()
      if (age > limit) return false
    }
    return true
  })
}

export function ResearchSessionTable({
  sessions,
  projectName,
  modeFilter,
  ageFilter,
  onModeFilterChange,
  onAgeFilterChange,
  onOpenSession,
  activeSessionId,
}: Props) {
  const filtered = filterSessions(sessions, modeFilter, ageFilter)

  if (sessions.length === 0) {
    return (
      <EmptyState
        title={projectName ? `No research sessions for ${projectName} yet` : 'No research sessions yet'}
        description="Run a Firecrawl web search above — each query is saved here so you can reopen results and attach snippets to reports."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          label="Mode"
          value={modeFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'search', label: 'Search' },
            { id: 'scrape', label: 'Scrape' },
          ]}
          onChange={onModeFilterChange}
        />
        <SegmentedControl
          size="sm"
          label="Since"
          value={ageFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: '24h', label: '24h' },
            { id: '7d', label: '7d' },
          ]}
          onChange={onAgeFilterChange}
        />
        <span className="font-mono text-3xs text-fg-faint">
          {filtered.length}/{sessions.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No sessions match these filters"
          description="Try widening the time window or clearing mode filters."
          action={
            <button
              type="button"
              onClick={() => {
                onModeFilterChange('all')
                onAgeFilterChange('all')
              }}
              className="text-2xs font-medium text-brand hover:underline"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-edge">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-edge bg-surface-raised text-left text-fg-muted">
                <th className="px-3 py-2 font-medium">Query</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Results</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const isActive = activeSessionId === s.id
                return (
                  <tr
                    key={s.id}
                    className={`border-b border-edge/60 transition-colors hover:bg-surface-raised/40 ${
                      isActive ? 'bg-brand/5' : ''
                    }`}
                  >
                    <td className="max-w-[32ch] truncate px-3 py-2 font-medium text-fg" title={s.query}>
                      {s.query}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={MODE_TONE[s.mode]}>{s.mode}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-2xs">{s.result_count}</td>
                    <td className="px-3 py-2 text-2xs text-fg-muted">
                      <RelativeTime value={s.created_at} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenSession(s.id)}
                        className={`text-2xs font-medium hover:underline ${
                          isActive ? 'text-brand' : 'text-accent'
                        }`}
                      >
                        {isActive ? 'Viewing' : 'Open →'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
