/**
 * FILE: apps/admin/src/components/audit/AuditStatusBanner.tsx
 * PURPOSE: Audit trail health — entitlement, failures, freshness, actor mix.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { AuditStats, AuditTabId } from './types'

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
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No project selected</p>
            <p className="text-2xs text-fg-muted">
              Audit entries are scoped per project — pick an app in the header switcher before investigating mutations.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Go to Projects</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.auditLogEntitlement) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Audit log requires Pro or Enterprise</p>
            <p className="text-2xs text-fg-muted">
              {stats.planDisplayName} on {projectLabel} doesn&apos;t include append-only audit history — upgrade to export SOC 2 evidence.
            </p>
          </div>
        </div>
        <Link to="/billing?tab=plans">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (stats.failCount24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.failCount24h} failure event{stats.failCount24h === 1 ? '' : 's'} in the last 24h
            </p>
            <p className="text-2xs text-fg-muted">
              fix.failed and integration.disconnected rows block a clean audit cycle — triage before your next review.
            </p>
          </div>
        </div>
        {onFilterFailures ? (
          <Btn size="sm" variant="ghost" onClick={onFilterFailures}>
            View failures
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
            Open log
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.totalEvents === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Audit stream empty</p>
            <p className="text-2xs text-fg-muted">
              Mutations like report triage, key rotation, and settings saves on {projectLabel} will appear here automatically.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
            Watch log
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.warnCount24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.warnCount24h} warn event{stats.warnCount24h === 1 ? '' : 's'} in the last 24h
            </p>
            <p className="text-2xs text-fg-muted">
              Revoked keys and uninstalled plugins are tracked — review before they stack into compliance debt.
            </p>
          </div>
        </div>
        {onFilterWarns ? (
          <Btn size="sm" variant="ghost" onClick={onFilterWarns}>
            View warns
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.events24h === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Quiet last 24 hours</p>
            <p className="text-2xs text-fg-muted">
              {stats.totalEvents.toLocaleString()} historical event{stats.totalEvents === 1 ? '' : 's'} on file
              {stats.latestEventAt ? (
                <> · last <RelativeTime value={stats.latestEventAt} /></>
              ) : null}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('breakdown')}>
            View breakdown
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.events24h} event{stats.events24h === 1 ? '' : 's'} in 24h for {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.humanCount24h} human · {stats.agentCount24h} agent · {stats.systemCount24h} system
            {stats.latestAction ? <> · latest {stats.latestAction}</> : null}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
          Open log
        </Btn>
      ) : null}
    </div>
  )
}

