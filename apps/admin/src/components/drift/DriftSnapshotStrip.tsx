/**
 * FILE: DriftSnapshotStrip.tsx
 * PURPOSE: Schema changes status: did your API or database contract change
 *          since the last scan (PageStatus, P1). Before the first scan it is
 *          the page's one first step (PageFirstStep, P3).
 */

import { Btn, PageStatus } from '../ui'
import type { DriftStats } from './DriftStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { driftLinks } from '../../lib/statCardLinks'

interface Props {
  stats: DriftStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the scanner: the first step on a project never scanned. */
  onFirstScan?: () => void
  /** Opens the list of changes: the one action while any wait. */
  onReview?: () => void
}

function driftSentence(stats: DriftStats): string {
  if (stats.snapshotCount === 0) return 'Not scanned yet.'
  if (stats.openFindings === 0) return `No changes waiting for you; ${pluralizeWithCount(stats.snapshotCount, 'scan')} so far.`
  const critical = stats.criticalOpen > 0 ? `, ${stats.criticalOpen} serious` : ''
  return `${pluralizeWithCount(stats.openFindings, 'change')} to your API or database since the baseline${critical}.`
}

export function DriftSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onFirstScan, onReview }: Props) {
  return (
    <PageStatus
      ariaLabel="Schema changes status"
      tone={stats.criticalOpen > 0 ? 'danger' : stats.openFindings > 0 ? 'warn' : 'ok'}
      sentence={driftSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      action={
        onReview && stats.openFindings > 0 ? (
          <Btn size="sm" variant="primary" onClick={onReview}>
            Review changes
          </Btn>
        ) : undefined
      }
      metrics={[
        {
          label: statLabels?.openFindings ?? 'Changes to review',
          value: stats.openFindings,
          tone: stats.openFindings > 0 ? 'warn' : 'neutral',
          hint: 'Routes, tables or columns that changed since the baseline scan and are not dismissed.',
          to: driftLinks.openFindings,
        },
        {
          label: statLabels?.critical ?? 'Serious',
          value: stats.criticalOpen,
          tone: stats.criticalOpen > 0 ? 'danger' : 'neutral',
          hint: 'Changes that can break a caller: a removed route, a dropped column, a table that lost its access rules.',
          to: driftLinks.critical,
        },
        {
          label: statLabels?.snapshots ?? 'Scans',
          value: stats.snapshotCount,
          hint: 'Scans of your API and database so far. Each one is compared with the one before.',
          to: driftLinks.snapshots,
        },
      ]}
      empty={{
        title: 'No baseline scan yet',
        sentence: 'Run one scan of your API and database; later scans tell you what changed since.',
        action: onFirstScan ? { label: 'Run first scan', onClick: onFirstScan } : { label: 'Run first scan', to: '/health?view=schema&tab=scanner' },
      }}
    />
  )
}
