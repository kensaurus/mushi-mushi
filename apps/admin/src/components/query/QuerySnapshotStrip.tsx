/**
 * FILE: QuerySnapshotStrip.tsx
 * PURPOSE: SQL query status: questions asked in the last day and whether any
 *          failed (PageStatus, P1). With no runs it says so; it never says
 *          "all recent runs OK" about zero runs (report 18db5e8e).
 */

import { PageStatus } from '../ui'
import type { QueryStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { queryLinks } from '../../lib/statCardLinks'

interface Props {
  stats: QueryStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function querySentence(stats: QueryStats): string {
  if (stats.runs24h === 0) return 'No questions asked in the last 24 hours.'
  const failed = stats.errors24h > 0 ? `, ${stats.errors24h} failed` : ', none failed'
  return `${pluralizeWithCount(stats.runs24h, 'question')} asked in the last 24 hours${failed}.`
}

export function QuerySnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="SQL query status"
      tone={stats.errors24h > 0 ? 'warn' : stats.runs24h > 0 ? 'ok' : 'neutral'}
      sentence={querySentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.runs24h ?? 'Questions (24 h)',
          value: stats.runs24h,
          hint: 'Questions asked in plain words or SQL in the last 24 hours.',
          to: queryLinks.runs24h,
        },
        {
          label: statLabels?.errors24h ?? 'Failed (24 h)',
          value: stats.errors24h,
          tone: stats.errors24h > 0 ? 'danger' : 'neutral',
          hint: 'Questions that returned an error instead of an answer.',
          to: queryLinks.errors24h,
        },
        {
          label: statLabels?.saved ?? 'Saved',
          value: stats.savedCount,
          hint: 'Questions saved to run again.',
          to: queryLinks.saved,
        },
      ]}
    />
  )
}
