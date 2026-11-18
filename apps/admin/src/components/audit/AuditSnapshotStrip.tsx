/**
 * FILE: AuditSnapshotStrip.tsx
 * PURPOSE: Audit log status (PageStatus, P1): one sentence on the last 24
 *          hours and up to three numbers, each opening the filtered log. The
 *          old strip's "Actor mix 18/0/0" ratio and its tab guide are gone;
 *          the actor split lives on the Breakdown tab.
 */

import { PageStatus } from '../ui'
import type { AuditStats } from './types'
import { auditLinks } from '../../lib/statCardLinks'

interface Props {
  stats: AuditStats
  statsFetchedAt: string | null
  statsValidating?: boolean
}

/**
 * @internal Exported for tests.
 * The sentence says what the numbers beside it do not (round-2 review
 * 2026-11-18): "2 changes in the last 24 hours. No failures." only repeated
 * the tiles, so it now names the latest change and who made it.
 */
export function auditSentence(stats: AuditStats): string {
  if (!stats.auditLogEntitlement) return `The audit log isn't part of the ${stats.planDisplayName} plan, so changes aren't being recorded.`
  if (stats.totalEvents === 0) return 'Nothing recorded yet. Every settings change, key rotation and fix shows up here.'
  if (stats.failCount24h > 0) return 'Failed actions in the last 24 hours need a look.'
  const latest = stats.latestAction ? `Latest: ${stats.latestAction} by ${stats.latestActorEmail ?? 'Mushi Mushi'}.` : ''
  if (stats.events24h === 0) return `No changes in the last 24 hours.${latest ? ` ${latest}` : ''}`
  return latest || 'Changes in the last 24 hours are below.'
}

export function AuditSnapshotStrip({ stats, statsFetchedAt, statsValidating }: Props) {
  return (
    <PageStatus
      ariaLabel="Audit log status"
      tone={!stats.auditLogEntitlement ? 'warn' : stats.failCount24h > 0 ? 'danger' : stats.warnCount24h > 0 ? 'warn' : 'ok'}
      sentence={auditSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      // Two numbers: the all-time total is the Log tab's count, shown once.
      metrics={[
        { label: '24h changes', value: stats.events24h, to: auditLinks.events24h, hint: 'Every recorded change in the last 24 hours.' },
        {
          label: '24h failures',
          value: stats.failCount24h,
          to: auditLinks.failures,
          tone: stats.failCount24h > 0 ? 'danger' : 'neutral',
          hint: 'Failed fixes and disconnected integrations in the last 24 hours.',
        },
      ]}
    />
  )
}
