/**
 * FILE: SsoSnapshotStrip.tsx
 * PURPOSE: SSO identity KPI strip using MetricStrip — replaces hand-rolled grid on SsoPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { SsoStats } from './types'
import {
  registeredCountTooltip,
  registeredCountDetail,
  pendingFailedTooltip,
  pendingFailedDetail,
  domainCountTooltip,
  domainCountDetail,
  planGateTooltip,
  planGateDetail,
} from '../../lib/statTooltips/sso'
import { ssoLinks } from '../../lib/statCardLinks'

interface Props {
  stats: SsoStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function SsoSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'SSO SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  const pendingFailed = stats.pendingCount + stats.failedCount

  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="SSO snapshot">
        <StatCard
          label={statLabels?.registered ?? 'Registered'}
          value={stats.registeredCount}
          accent={stats.registeredCount > 0 ? 'text-ok' : stats.ssoEntitlement ? 'text-warn' : undefined}
          tooltip={registeredCountTooltip(stats)}
          detail={registeredCountDetail(stats)}
          to={ssoLinks.registered}
        />
        <StatCard
          label={statLabels?.pendingFailed ?? 'Pending / failed'}
          value={pendingFailed}
          accent={
            stats.failedCount > 0
              ? 'text-danger'
              : stats.pendingCount > 0
                ? 'text-warn'
                : 'text-ok'
          }
          tooltip={pendingFailedTooltip(stats)}
          detail={pendingFailedDetail(stats)}
          to={ssoLinks.pendingFailed}
        />
        <StatCard
          label={statLabels?.domains ?? 'Domains'}
          value={stats.domainCount}
          accent={stats.domainCount > 0 ? 'text-info' : undefined}
          tooltip={domainCountTooltip(stats)}
          detail={domainCountDetail()}
          to={ssoLinks.emailDomains}
        />
        <StatCard
          label={statLabels?.planGate ?? 'Plan'}
          value={stats.ssoEntitlement ? 'Unlocked' : 'Locked'}
          accent={stats.ssoEntitlement ? 'text-ok' : 'text-warn'}
          tooltip={planGateTooltip(stats)}
          detail={planGateDetail(stats)}
          to={ssoLinks.planGate}
        />
      </MetricStrip>
    </Section>
  )
}
