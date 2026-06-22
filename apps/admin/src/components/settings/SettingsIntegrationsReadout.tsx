/**
 * FILE: SettingsIntegrationsReadout.tsx
 * PURPOSE: Settings hub provenance — routing webhook endpoints, BYOK posture,
 *          and project ref (Connect-style readout on /settings).
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { SettingsStats } from './types'
import { IconGlobe, IconHealth, IconIntegrations } from '../icons'

function sentryInboundWebhookUrl(): string {
  return `${RESOLVED_EXTERNAL_API_URL}/v1/webhooks/sentry`
}

export interface SettingsIntegrationsReadoutProps {
  stats: SettingsStats
  fetchedAt: string | null
  validating?: boolean
}

export function SettingsIntegrationsReadout({
  stats,
  fetchedAt,
  validating,
}: SettingsIntegrationsReadoutProps) {
  if (!stats.projectId) return null

  const endpointRows: DetailRowItem[] = [
    {
      label: 'Settings API',
      value: 'PATCH /v1/admin/settings',
      mono: true,
    },
    {
      label: 'BYOK keys',
      value: `${stats.byokKeysConfigured} configured · ${stats.byokKeysPassing} passing · ${stats.byokKeysFailing} failing`,
      tone: stats.byokKeysFailing > 0 ? 'danger' : stats.byokKeysPassing > 0 ? 'ok' : 'muted',
      wrap: true,
    },
  ]

  const signalRows: DetailRowItem[] = [
    {
      label: 'Slack routing',
      value: stats.slackConfigured ? 'Configured' : 'Not configured',
      tone: stats.slackConfigured ? 'ok' : 'muted',
    },
    {
      label: 'Sentry routing',
      value: stats.sentryConfigured ? 'DSN configured' : 'Not configured',
      tone: stats.sentryConfigured ? 'ok' : 'muted',
    },
    {
      label: 'SDK widget',
      value: stats.sdkConfigEnabled ? 'Enabled' : 'Disabled',
      tone: stats.sdkConfigEnabled ? 'ok' : 'warn',
    },
    {
      label: 'Classifier model',
      value: stats.stage2Model ?? 'default',
      mono: true,
      wrap: true,
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
    <Section title="Settings readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Copy inbound webhook URLs into Sentry and verify routing flags for the active project.
        Secret values stay in the form fields below — this band shows endpoints and posture only.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
          <div className="mt-2">
            <EndpointCodeRow label="Sentry inbound webhook" url={sentryInboundWebhookUrl()} />
          </div>
          <DetailRows items={endpointRows} dense className="mt-2" />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
          <div className="mt-2 flex flex-wrap gap-2 text-3xs text-fg-faint">
            <span className="inline-flex items-center gap-1 rounded-full border border-edge-subtle px-2 py-0.5">
              <IconIntegrations size={12} aria-hidden />
              General + BYOK tabs
            </span>
          </div>
        </ReadoutSection>
      </div>
    </Section>
  )
}
