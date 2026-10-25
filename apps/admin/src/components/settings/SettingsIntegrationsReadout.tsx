/**
 * FILE: SettingsIntegrationsReadout.tsx
 * PURPOSE: Raw values for developers, shown inside Settings → Developer
 *          details: the addresses to paste into Sentry or your SDK, and the
 *          project's id and switches as stored. Flat on purpose; it already
 *          sits inside a disclosure.
 */

import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { SettingsStats } from './types'

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

  const rows: DetailRowItem[] = [
    { label: 'Project id', value: stats.projectId, mono: true, copyable: true, wrap: true },
    {
      label: 'Saved keys (server count)',
      value: `${stats.byokKeysConfigured} saved · ${stats.byokKeysPassing} accepted · ${stats.byokKeysFailing} failing · ${stats.byokKeysUntested} not checked`,
      wrap: true,
    },
    { label: 'Slack alerts', value: stats.slackConfigured ? 'Set up' : 'Not set up' },
    { label: 'Sentry DSN', value: stats.sentryConfigured ? 'Saved' : 'Not saved' },
    { label: 'Bug widget', value: stats.sdkConfigEnabled ? 'On' : 'Off' },
    { label: 'Triage model', value: stats.stage2Model ?? 'default', mono: true, wrap: true },
    { label: 'Settings API', value: 'PATCH /v1/admin/settings', mono: true },
  ]

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg">Addresses to paste elsewhere</h3>
        <EndpointCodeRow label="Ingest API (your SDK sends reports here)" url={RESOLVED_EXTERNAL_API_URL} />
        <EndpointCodeRow label="Sentry webhook (paste into Sentry's internal integration)" url={sentryInboundWebhookUrl()} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg">Stored values</h3>
        <DetailRows items={rows} dense />
        {fetchedAt ? (
          <p className="text-xs text-fg-muted">
            {validating ? 'Refreshing…' : `Read ${new Date(fetchedAt).toLocaleTimeString()}`}
          </p>
        ) : null}
      </div>
    </div>
  )
}
