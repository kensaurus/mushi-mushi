/**
 * FILE: apps/admin/src/components/compliance/ComplianceStatusBanner.tsx
 * PURPOSE: SOC 2 / GDPR posture — entitlement, failing controls, DSAR SLA, evidence freshness.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { ComplianceStats, ComplianceTabId } from './types'

interface Props {
  stats: ComplianceStats
  onTab?: (tab: ComplianceTabId) => void
  onFilter?: (status: 'fail' | 'open' | 'legal_hold') => void
  onRefreshEvidence?: () => void
  refreshing?: boolean
}

export function ComplianceStatusBanner({
  stats,
  onTab,
  onFilter,
  onRefreshEvidence,
  refreshing,
}: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No project selected</p>
            <p className="text-2xs text-fg-muted">
              Compliance evidence and DSARs are scoped per project — pick an app in the header switcher first.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Go to Projects</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.soc2Entitlement) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">SOC 2 console requires Pro or Enterprise</p>
            <p className="text-2xs text-fg-muted">
              {stats.planDisplayName} on {projectLabel} doesn&apos;t include the compliance pack — upgrade to unlock evidence vault and DSAR tooling.
            </p>
          </div>
        </div>
        <Link to="/billing?tab=plans">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (stats.controlsFail > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.controlsFail} control{stats.controlsFail === 1 ? '' : 's'} failing evidence
            </p>
            <p className="text-2xs text-fg-muted">
              Remediate before your next audit — expand payload rows on Evidence to see what the nightly sweep flagged.
            </p>
          </div>
        </div>
        {onFilter ? (
          <Btn size="sm" variant="ghost" onClick={() => onFilter('fail')}>
            View failing
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('evidence')}>
            Open evidence
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.overdueDsars > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.overdueDsars} DSAR{stats.overdueDsars === 1 ? '' : 's'} within 9 days of the 30-day SLA
            </p>
            <p className="text-2xs text-fg-muted">
              GDPR / CCPA require fulfilment within 30 days — mark complete or reject with an audit reason.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('dsars')}>
            Open DSAR queue
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.evidenceNeverGenerated) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No evidence snapshot yet</p>
            <p className="text-2xs text-fg-muted">
              Nightly sweeps run at 04:30 UTC — click Refresh evidence for an on-demand SOC 2 control pack for {projectLabel}.
            </p>
          </div>
        </div>
        {onRefreshEvidence ? (
          <Btn size="sm" variant="ghost" onClick={onRefreshEvidence} loading={refreshing} disabled={refreshing}>
            Refresh evidence
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.controlsWarn > 0 || stats.atRiskDsars > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Items need triage</p>
            <p className="text-2xs text-fg-muted">
              {stats.controlsWarn > 0 ? `${stats.controlsWarn} warning control${stats.controlsWarn === 1 ? '' : 's'}` : ''}
              {stats.controlsWarn > 0 && stats.atRiskDsars > 0 ? ' · ' : ''}
              {stats.atRiskDsars > 0 ? `${stats.atRiskDsars} DSAR${stats.atRiskDsars === 1 ? '' : 's'} approaching SLA` : ''}
            </p>
          </div>
        </div>
        {onFilter ? (
          <Btn size="sm" variant="ghost" onClick={() => onFilter('open')}>
            View open items
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.legalHoldCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.legalHoldCount} project{stats.legalHoldCount === 1 ? '' : 's'} on legal hold
            </p>
            <p className="text-2xs text-fg-muted">
              Retention sweeps are paused for held projects — lift hold when litigation ends.
            </p>
          </div>
        </div>
        {onFilter ? (
          <Btn size="sm" variant="ghost" onClick={() => onFilter('legal_hold')}>
            View holds
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
            {stats.controlsPass} control{stats.controlsPass === 1 ? '' : 's'} green for {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.openDsars === 0 ? 'No open DSARs' : `${stats.openDsars} open DSAR${stats.openDsars === 1 ? '' : 's'}`}
            {stats.latestEvidenceAt ? (
              <> · evidence <RelativeTime value={stats.latestEvidenceAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('overview')}>
          View snapshot
        </Btn>
      ) : null}
    </div>
  )
}

