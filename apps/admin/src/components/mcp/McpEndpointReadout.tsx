/**
 * FILE: McpEndpointReadout.tsx
 * PURPOSE: Copyable MCP HTTP + API endpoints and connection signals for /mcp overview.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'
import type { McpStats } from './types'
import { IconGlobe, IconIntegrations } from '../icons'

interface Props {
  stats: McpStats
  fetchedAt: string | null
  validating?: boolean
}

export function McpEndpointReadout({ stats, fetchedAt, validating }: Props) {
  if (!stats.projectId) return null

  const signalRows: DetailRowItem[] = [
    {
      label: 'Expected host',
      value: stats.expectedEndpointHost ?? '—',
      mono: true,
      tone: stats.endpointMismatch ? 'danger' : stats.expectedEndpointHost ? 'ok' : 'muted',
    },
    {
      label: 'Last seen host',
      value: stats.lastSeenEndpointHost ?? 'Never connected',
      mono: true,
      tone: stats.lastSeenAt ? 'info' : 'muted',
    },
    {
      label: 'Active keys',
      value: `${stats.activeKeyCount} · ${stats.mcpReadKeyCount} read · ${stats.mcpWriteKeyCount} write`,
      tone: stats.mcpReadKeyCount > 0 ? 'ok' : 'warn',
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
    <Section title="MCP readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="MCP HTTP transport" url={RESOLVED_MCP_HTTP_URL} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Connection signals" icon={<IconIntegrations size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
