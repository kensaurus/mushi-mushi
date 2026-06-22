/**
 * FILE: ProjectsSetupReadout.tsx
 * PURPOSE: Active-project ingest provenance on the Projects hub — copyable
 *          endpoint, project ref, and key prefix stack (Connect-style readout).
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth, IconKey } from '../icons'

export interface ProjectsSetupReadoutProps {
  activeProjectId: string | null
  activeProjectName: string | null
  activeKeyCount: number
  staleKeyCount: number
  activeProjectSdkConnected: boolean
  keyPrefixes?: string[]
  fetchedAt: string | null
  validating?: boolean
}

export function ProjectsSetupReadout({
  activeProjectId,
  activeProjectName,
  activeKeyCount,
  staleKeyCount,
  activeProjectSdkConnected,
  keyPrefixes = [],
  fetchedAt,
  validating,
}: ProjectsSetupReadoutProps) {
  if (!activeProjectId) return null

  const signalRows: DetailRowItem[] = [
    {
      label: 'Active project',
      value: activeProjectName ?? activeProjectId,
      wrap: true,
    },
    {
      label: 'Project ref',
      value: activeProjectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'SDK heartbeat',
      value: activeProjectSdkConnected ? 'Live on active project' : 'No heartbeat yet',
      tone: activeProjectSdkConnected ? 'ok' : 'warn',
    },
    {
      label: 'API keys',
      value: `${activeKeyCount} active · ${staleKeyCount} never seen`,
      tone: staleKeyCount > 0 ? 'warn' : activeKeyCount > 0 ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Project setup readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Copy the ingest endpoint and project ref into your host app env. Key prefixes help match
        heartbeats to the console.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
          {keyPrefixes.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-3xs font-medium uppercase tracking-wider text-fg-faint">
                <IconKey size={12} aria-hidden />
                Key prefixes
              </div>
              <ul className="space-y-1">
                {keyPrefixes.slice(0, 5).map((prefix) => (
                  <li
                    key={prefix}
                    className="rounded-md border border-edge-subtle bg-surface-raised px-2 py-1 font-mono text-2xs text-fg-secondary"
                  >
                    {prefix}…
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ReadoutSection>
      </div>
    </Section>
  )
}
