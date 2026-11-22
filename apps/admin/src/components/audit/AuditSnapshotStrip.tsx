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
  /** The newest log row's actor, as the table names it (auditActorLabel). */
  latestActor?: string | null
}

/**
 * @internal Exported for tests.
 * The sentence says what the numbers beside it do not (round-2 review
 * 2026-11-18): "2 changes in the last 24 hours. No failures." only repeated
 * the tiles, so it now names the latest change and who made it.
 */
export function auditSentence(stats: AuditStats, latestActor?: string | null): string {
  if (!stats.auditLogEntitlement) return `The audit log isn't part of the ${stats.planDisplayName} plan, so changes aren't being recorded.`
  if (stats.totalEvents === 0) return 'Nothing recorded yet. Every settings change, key rotation and fix shows up here.'
  if (stats.failCount24h > 0) return 'Failed actions in the last 24 hours need a look.'
  // The same actor label as the table row (2026-11-19: "by Mushi Mushi" here, "Test" in the row):
  // the row's name first, then the stats email, and "Mushi Mushi" only when neither knows anyone.
  const who = latestActor ?? stats.latestActorEmail ?? 'Mushi Mushi'
  const latest = stats.latestAction ? `Latest: ${stats.latestAction} by ${who}.` : ''
  if (stats.events24h === 0) return `No changes in the last 24 hours.${latest ? ` ${latest}` : ''}`
  return latest || 'Changes in the last 24 hours are below.'
}

export function AuditSnapshotStrip({ stats, statsFetchedAt, statsValidating, latestActor = null }: Props) {
  return (
    <PageStatus
      ariaLabel="Audit log status"
      tone={!stats.auditLogEntitlement ? 'warn' : stats.failCount24h > 0 ? 'danger' : stats.warnCount24h > 0 ? 'warn' : 'ok'}
      sentence={auditSentence(stats, latestActor)}
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
