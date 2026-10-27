/**
 * FILE: AuditSnapshotStrip.tsx
 * PURPOSE: Audit log status (PageStatus, P1): one sentence on the last 24
 *          hours and up to three numbers, each opening the filtered log. The
 *          old strip's "Actor mix 18/0/0" ratio and its tab guide are gone;
 *          the actor split lives on the Breakdown tab.
 */

import { PageStatus } from '../ui'
import type { AuditStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { auditLinks } from '../../lib/statCardLinks'

interface Props {
  stats: AuditStats
  statsFetchedAt: string | null
  statsValidating?: boolean
}

/** @internal Exported for tests. */
export function auditSentence(stats: AuditStats): string {
  if (!stats.auditLogEntitlement) return `The audit log isn't part of the ${stats.planDisplayName} plan, so changes aren't being recorded.`
  if (stats.events24h === 0) {
    return stats.totalEvents > 0
      ? 'No changes in the last 24 hours.'
      : 'Nothing recorded yet. Every settings change, key rotation and fix shows up here.'
  }
  const who = [
    stats.humanCount24h > 0 ? pluralizeWithCount(stats.humanCount24h, 'by a person', 'by people') : null,
    stats.agentCount24h > 0 ? pluralizeWithCount(stats.agentCount24h, 'by an agent', 'by agents') : null,
    stats.systemCount24h > 0 ? `${stats.systemCount24h} by Mushi itself` : null,
  ].filter(Boolean)
  const failures = stats.failCount24h > 0 ? ` ${pluralizeWithCount(stats.failCount24h, 'failure')} to look at.` : ' No failures.'
  return `${pluralizeWithCount(stats.events24h, 'change')} in the last 24 hours${who.length ? ` (${who.join(', ')})` : ''}.${failures}`
}

export function AuditSnapshotStrip({ stats, statsFetchedAt, statsValidating }: Props) {
  return (
    <PageStatus
      ariaLabel="Audit log status"
      tone={!stats.auditLogEntitlement ? 'warn' : stats.failCount24h > 0 ? 'danger' : stats.warnCount24h > 0 ? 'warn' : 'ok'}
      sentence={auditSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        { label: 'Changes (24h)', value: stats.events24h, to: auditLinks.events24h, hint: 'Every recorded change in the last 24 hours.' },
        {
          label: 'Failures (24h)',
          value: stats.failCount24h,
          to: auditLinks.failures,
          tone: stats.failCount24h > 0 ? 'danger' : 'neutral',
          hint: 'Failed fixes and disconnected integrations in the last 24 hours.',
        },
        { label: 'All time', value: stats.totalEvents.toLocaleString(), to: auditLinks.allTime, hint: 'Every change ever recorded for your team.' },
      ]}
    />
  )
}
