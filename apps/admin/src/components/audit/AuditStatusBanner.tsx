/**
 * FILE: apps/admin/src/components/audit/AuditStatusBanner.tsx
 * PURPOSE: Audit trail health — entitlement, failures, freshness, actor mix.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { AuditStats, AuditTabId } from './types'

/** Nominal audit activity is covered by the page hero + snapshot — skip the banner. */
export function isAuditStatusBannerCritical(stats: AuditStats): boolean {
  if (!stats.projectId) return true
  if (!stats.auditLogEntitlement) return true
  if (stats.failCount24h > 0) return true
  if (stats.warnCount24h > 0) return true
  return false
}

interface Props {
  stats: AuditStats
  onTab?: (tab: AuditTabId) => void
  onFilterFailures?: () => void
  onFilterWarns?: () => void
}

export function AuditStatusBanner({ stats, onTab, onFilterFailures, onFilterWarns }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <StatusBannerShell
        tone="warn"
        title="No project selected"
        subtitle="Audit entries are scoped per project — pick an app in the header switcher before investigating mutations."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (!stats.auditLogEntitlement) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Audit log requires Pro or Enterprise"
        subtitle={`${stats.planDisplayName} on ${projectLabel} doesn't include append-only audit history — upgrade to export SOC 2 evidence.`}
        action={
          <Link to="/billing?tab=plans">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.failCount24h > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.failCount24h} failure event${stats.failCount24h === 1 ? '' : 's'} in the last 24h`}
        subtitle="fix.failed and integration.disconnected rows block a clean audit cycle — triage before your next review."
        action={
          onFilterFailures ? (
            <Btn size="sm" variant="ghost" onClick={onFilterFailures}>
              View failures
            </Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
              Open log
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.totalEvents === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title="Audit stream empty"
        subtitle={`Mutations like report triage, key rotation, and settings saves on ${projectLabel} will appear here automatically.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
              Watch log
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.warnCount24h > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.warnCount24h} warn event${stats.warnCount24h === 1 ? '' : 's'} in the last 24h`}
        subtitle="Revoked keys and uninstalled plugins are tracked — review before they stack into compliance debt."
        action={
          onFilterWarns ? (
            <Btn size="sm" variant="ghost" onClick={onFilterWarns}>
              View warns
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.events24h === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title="Quiet last 24 hours"
        subtitle={
          <>
            {stats.totalEvents.toLocaleString()} historical event{stats.totalEvents === 1 ? '' : 's'} on file
            {stats.latestEventAt ? (
              <> · last <RelativeTime value={stats.latestEventAt} /></>
            ) : null}
          </>
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('breakdown')}>
              View breakdown
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`${stats.events24h} event${stats.events24h === 1 ? '' : 's'} in 24h for ${projectLabel}`}
      subtitle={
        <>
          {stats.humanCount24h} human · {stats.agentCount24h} agent · {stats.systemCount24h} system
          {stats.latestAction ? <> · latest {stats.latestAction}</> : null}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
            Open log
          </Btn>
        ) : null
      }
    />
  )
}
