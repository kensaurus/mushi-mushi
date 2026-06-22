/**
 * FILE: IntegrationsProvenanceReadout.tsx
 * PURPOSE: Platform integration provenance — GitHub repo URL, probe API, and
 *          connection counts from live integration stats.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { IntegrationStats } from './types'
import { IconGit, IconGlobe, IconHealth } from '../icons'

export interface IntegrationsProvenanceReadoutProps {
  stats: IntegrationStats
  githubRepoUrl: string | null
  fetchedAt: string | null
  validating?: boolean
}

export function IntegrationsProvenanceReadout({
  stats,
  githubRepoUrl,
  fetchedAt,
  validating,
}: IntegrationsProvenanceReadoutProps) {
  if (!stats.projectId) return null

  const platformProbeUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/health/integration/github`

  const signalRows: DetailRowItem[] = [
    {
      label: 'Platform connected',
      value: `${stats.platformConnected}/${stats.platformTotal}`,
      tone: stats.platformConnected >= stats.platformTotal ? 'ok' : 'warn',
    },
    {
      label: 'Platform health',
      value: `${stats.platformHealthy} healthy · ${stats.platformDown} down`,
      tone: stats.platformDown > 0 ? 'danger' : stats.platformHealthy > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Routing rules',
      value: `${stats.routingActive} active · ${stats.routingPaused} paused · ${stats.routingTotal} total`,
      tone: stats.routingActive > 0 ? 'ok' : 'muted',
      wrap: true,
    },
    {
      label: 'Last probe',
      value: stats.lastProbeAt ? new Date(stats.lastProbeAt).toLocaleString() : 'Never',
      tone: stats.lastProbeAt ? 'info' : 'muted',
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
    <Section title="Integration provenance" freshness={{ at: fetchedAt, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Where platform credentials land and how probe health maps to the cards below.
        Paste the GitHub repo URL into the GitHub card if it differs from your primary repo.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          {githubRepoUrl ? (
            <div className="mt-2">
              <EndpointCodeRow label="GitHub repo" url={githubRepoUrl} />
            </div>
          ) : null}
          <div className="mt-2 rounded-md border border-edge-subtle bg-surface-root/40 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-3xs font-medium uppercase tracking-wider text-fg-faint">
              <IconGit size={12} aria-hidden />
              Probe example
            </div>
            <p className="font-mono text-2xs text-fg-secondary break-all">{platformProbeUrl}</p>
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
