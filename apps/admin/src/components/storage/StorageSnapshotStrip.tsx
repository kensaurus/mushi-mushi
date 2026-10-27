/**
 * FILE: StorageSnapshotStrip.tsx
 * PURPOSE: Storage status (PageStatus, P1): the open app's verdict
 *          (storageVerdict) in one sentence, its one next step, and up to
 *          three numbers. It replaces the status banner and the four-tile
 *          strip whose team-wide "Healthy buckets 0/1" contradicted the
 *          app's own state.
 */

import { Btn, PageStatus } from '../ui'
import { relativeTime } from '../../lib/setupGuideSteps'
import type { StorageStats, StorageTabId } from './types'
import { storageVerdict } from './storageVerdict'
import { storageLinks } from '../../lib/statCardLinks'

interface Props {
  stats: StorageStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  onTab: (tab: StorageTabId) => void
  onHealthCheck?: () => void
  checking?: boolean
}

export function StorageSnapshotStrip({ stats, statsFetchedAt, statsValidating, onTab, onHealthCheck, checking }: Props) {
  const verdict = storageVerdict(stats)
  const action =
    verdict.action === 'configure' ? (
      <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
        Use your own bucket
      </Btn>
    ) : (verdict.action === 'probe' || verdict.action === 'reprobe') && onHealthCheck ? (
      <Btn size="sm" variant="primary" onClick={onHealthCheck} loading={checking} disabled={checking}>
        {verdict.action === 'probe' ? 'Check bucket' : 'Check again'}
      </Btn>
    ) : null
  return (
    <PageStatus
      ariaLabel="Storage status"
      tone={verdict.tone}
      sentence={verdict.sentence}
      action={action}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        { label: 'Screenshots', value: stats.activeProjectObjects.toLocaleString(), to: storageLinks.screenshots, hint: 'Screenshots stored for this app.' },
        { label: 'Last saved', value: relativeTime(stats.activeProjectLastWrite) ?? 'Never', hint: 'When this app last stored a screenshot.' },
        {
          label: 'All apps',
          value: stats.totalObjects.toLocaleString(),
          to: storageLinks.screenshots,
          hint: 'Screenshots stored across every app on your team.',
        },
      ]}
    />
  )
}
