/**
 * FILE: OnboardingSetupReadout.tsx
 * PURPOSE: Setup wizard provenance — ingest endpoint, project ref, and SDK/admin
 *          host alignment using live onboarding stats (mirrors ConnectProvenanceBand).
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { OnboardingStats } from './types'
import { IconCheck, IconGlobe, IconHealth, IconNetwork } from '../icons'

export interface OnboardingSetupReadoutProps {
  stats: OnboardingStats
  statsFetchedAt: string | null
  statsValidating?: boolean
}

export function OnboardingSetupReadout({
  stats,
  statsFetchedAt,
  statsValidating,
}: OnboardingSetupReadoutProps) {
  if (!stats.hasAnyProject || !stats.projectId) return null

  const endpointRows: DetailRowItem[] = [
    {
      label: 'Console expects',
      value: stats.adminEndpointHost ?? '—',
      mono: true,
      hint: 'Host this admin session uses for ingest comparisons',
    },
    {
      label: 'Reports ingested',
      value: String(stats.reportCount),
      tone: stats.reportCount > 0 ? 'ok' : 'muted',
    },
  ]

  const signalRows: DetailRowItem[] = [
    {
      label: 'SDK endpoint',
      value: stats.sdkEndpointHost ?? (stats.sdkInstalled ? 'Live (host unknown)' : 'No heartbeat yet'),
      tone: stats.sdkHostMismatch ? 'warn' : stats.sdkInstalled ? 'ok' : 'muted',
      wrap: true,
    },
    {
      label: 'Endpoint match',
      value: stats.sdkHostMismatch
        ? `Mismatch — SDK → ${stats.sdkEndpointHost ?? '?'}`
        : stats.sdkInstalled
          ? 'Aligned with console'
          : 'Install SDK to verify',
      tone: stats.sdkHostMismatch ? 'warn' : stats.sdkInstalled ? 'ok' : 'muted',
      wrap: stats.sdkHostMismatch,
    },
    {
      label: 'Project ref',
      value: stats.projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
  ]

  return (
    <Section
      title="Setup provenance"
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Where your SDK should send reports and whether the pipeline is aligned with this console.
        Copy the ingest URL into your app env or SDK init.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
          <DetailRows items={endpointRows} dense className="mt-2" />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
          <div className="mt-2 flex flex-wrap gap-2 text-3xs text-fg-faint">
            <span className="inline-flex items-center gap-1 rounded-full border border-edge-subtle px-2 py-0.5">
              <IconNetwork size={12} aria-hidden />
              SDK + test report
            </span>
            {stats.sdkHostMismatch ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-muted/40 px-2 py-0.5 text-warning-foreground">
                Fix SDK endpoint env
              </span>
            ) : stats.sdkInstalled ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok-muted/30 px-2 py-0.5 text-ok">
                <IconCheck size={12} aria-hidden />
                Pipeline live
              </span>
            ) : null}
          </div>
        </ReadoutSection>
      </div>
    </Section>
  )
}
