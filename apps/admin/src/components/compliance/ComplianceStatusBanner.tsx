/**
 * FILE: apps/admin/src/components/compliance/ComplianceStatusBanner.tsx
 * PURPOSE: SOC 2 / GDPR posture — entitlement, failing controls, DSAR SLA, evidence freshness.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ComplianceStats, ComplianceTabId } from './types'

/** Green / informational posture is covered by the page hero + snapshot. */
export function isComplianceStatusBannerCritical(stats: ComplianceStats): boolean {
  if (!stats.projectId) return true
  if (!stats.soc2Entitlement) return true
  if (stats.controlsFail > 0) return true
  if (stats.overdueDsars > 0) return true
  if (stats.evidenceNeverGenerated) return true
  if (stats.controlsWarn > 0 || stats.atRiskDsars > 0) return true
  return false
}

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
      <StatusBannerShell
        tone="warn"
        title="No project selected"
        subtitle="Compliance evidence and DSARs are scoped per project — pick an app in the header switcher first."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (!stats.soc2Entitlement) {
    return (
      <StatusBannerShell
        tone="warn"
        title="SOC 2 console requires Pro or Enterprise"
        subtitle={`${stats.planDisplayName} on ${projectLabel} doesn't include the compliance pack — upgrade to unlock evidence vault and DSAR tooling.`}
        action={
          <Link to="/billing?tab=plans">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.controlsFail > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.controlsFail} control${stats.controlsFail === 1 ? '' : 's'} failing evidence`}
        subtitle="Remediate before your next audit — expand payload rows on Evidence to see what the nightly sweep flagged."
        action={
          onFilter ? (
            <Btn size="sm" variant="ghost" onClick={() => onFilter('fail')}>
              View failing
            </Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('evidence')}>
              Open evidence
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.overdueDsars > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.overdueDsars} DSAR${stats.overdueDsars === 1 ? '' : 's'} within 9 days of the 30-day SLA`}
        subtitle="GDPR / CCPA require fulfilment within 30 days — mark complete or reject with an audit reason."
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('dsars')}>
              Open DSAR queue
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.evidenceNeverGenerated) {
    return (
      <StatusBannerShell
        tone="info"
        title="No evidence snapshot yet"
        subtitle={`Nightly sweeps run at 04:30 UTC — click Refresh evidence for an on-demand SOC 2 control pack for ${projectLabel}.`}
        action={
          onRefreshEvidence ? (
            <Btn size="sm" variant="ghost" onClick={onRefreshEvidence} loading={refreshing} disabled={refreshing}>
              Refresh evidence
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.controlsWarn > 0 || stats.atRiskDsars > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Items need triage"
        subtitle={
          <>
            {stats.controlsWarn > 0 ? `${stats.controlsWarn} warning control${stats.controlsWarn === 1 ? '' : 's'}` : ''}
            {stats.controlsWarn > 0 && stats.atRiskDsars > 0 ? ' · ' : ''}
            {stats.atRiskDsars > 0 ? `${stats.atRiskDsars} DSAR${stats.atRiskDsars === 1 ? '' : 's'} approaching SLA` : ''}
          </>
        }
        action={
          onFilter ? (
            <Btn size="sm" variant="ghost" onClick={() => onFilter('open')}>
              View open items
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.legalHoldCount > 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.legalHoldCount} project${stats.legalHoldCount === 1 ? '' : 's'} on legal hold`}
        subtitle="Retention sweeps are paused for held projects — lift hold when litigation ends."
        action={
          onFilter ? (
            <Btn size="sm" variant="ghost" onClick={() => onFilter('legal_hold')}>
              View holds
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`${stats.controlsPass} control${stats.controlsPass === 1 ? '' : 's'} green for ${projectLabel}`}
      subtitle={
        <>
          {stats.openDsars === 0 ? 'No open DSARs' : `${stats.openDsars} open DSAR${stats.openDsars === 1 ? '' : 's'}`}
          {stats.latestEvidenceAt ? (
            <> · evidence <RelativeTime value={stats.latestEvidenceAt} /></>
          ) : null}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('overview')}>
            View snapshot
          </Btn>
        ) : null
      }
    />
  )
}
