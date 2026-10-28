/**
 * FILE: FeatureBoardSnapshotStrip.tsx
 * PURPOSE: Feature requests status: what people ask for and what shipped
 *          (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { FeatureBoardClientStats } from './FeatureBoardStatsTypes'
import { pluralizeWithCount } from '../../lib/format'

interface Props {
  stats: FeatureBoardClientStats
  fetchedAt: string | null
  isValidating?: boolean
}

function boardSentence(stats: FeatureBoardClientStats): string {
  if (stats.totalTickets === 0) return 'No feature requests yet.'
  const top = stats.topRequestSubject ? ` The most wanted: “${stats.topRequestSubject}”.` : ''
  return `${pluralizeWithCount(stats.openCount, 'request')} open, ${stats.shippedCount} shipped.${top}`
}

export function FeatureBoardSnapshotStrip({ stats, fetchedAt, isValidating }: Props) {
  return (
    <PageStatus
      ariaLabel="Feature requests status"
      tone={stats.openCount > 0 ? 'info' : 'neutral'}
      sentence={boardSentence(stats)}
      freshness={{ at: fetchedAt, isValidating }}
      metrics={[
        { label: 'Open', value: stats.openCount, hint: 'Requests not shipped or declined yet.' },
        { label: 'Shipped', value: stats.shippedCount, hint: 'Requests that shipped.' },
        { label: 'Votes', value: stats.totalVotes, hint: 'Votes across all requests.' },
      ]}
    />
  )
}
