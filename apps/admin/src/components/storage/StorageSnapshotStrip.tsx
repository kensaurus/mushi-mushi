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
  // Built-in storage with nothing saved yet is one line, not a chip, a sentence and two empty
  // tiles saying it four ways (2026-11-19).
  const builtInEmpty = verdict.action === 'configure' && stats.activeProjectObjects === 0 && !stats.activeProjectLastWrite
  return (
    <PageStatus
      ariaLabel="Storage status"
      tone={verdict.tone}
      sentence={builtInEmpty ? `${stats.projectName ?? 'This app'} · built-in storage · no screenshots yet` : verdict.sentence}
      action={action}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      // This app's numbers only: the team total is the usage table's own
      // "All apps" row, so 63 is shown once, with its unit.
      metrics={builtInEmpty ? [] : [
        { label: 'Screenshots', value: stats.activeProjectObjects.toLocaleString(), to: storageLinks.screenshots, hint: 'Screenshots stored for this app.' },
        { label: 'Last saved', value: relativeTime(stats.activeProjectLastWrite) ?? 'Never', hint: 'When this app last stored a screenshot.' },
      ]}
    />
  )
}
