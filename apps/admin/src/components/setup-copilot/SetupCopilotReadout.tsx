/**
 * FILE: SetupCopilotReadout.tsx
 * PURPOSE: Setup Copilot provenance — ingest endpoint, project ref, connect command.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { CodeInline } from '../CodePanel'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth, IconTerminal } from '../icons'

export interface SetupCopilotReadoutProps {
  projectId: string
  projectName: string
  projectSlug: string
  reportCount: number
  sdkConnected: boolean
  connectCmd: string
  fetchedAt?: string | null
  validating?: boolean
}

export function SetupCopilotReadout({
  projectId,
  projectName,
  projectSlug,
  reportCount,
  sdkConnected,
  connectCmd,
  fetchedAt,
  validating,
}: SetupCopilotReadoutProps) {
  const signalRows: DetailRowItem[] = [
    {
      label: 'Project',
      value: `${projectName} (${projectSlug})`,
      wrap: true,
    },
    {
      label: 'Project ref',
      value: projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'Reports ingested',
      value: String(reportCount),
      tone: reportCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'SDK heartbeat',
      value: sdkConnected ? 'Live' : 'Waiting for connect',
      tone: sdkConnected ? 'ok' : 'warn',
    },
  ]

  return (
    <Section title="Copilot setup readout" freshness={{ at: fetchedAt ?? null, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Canonical endpoints and refs for this project — paste the connect command in your repo, then
        verify heartbeat on the steps below.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
          <div className="mt-2 rounded-md border border-edge-subtle bg-surface-root/40 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-3xs font-medium uppercase tracking-wider text-fg-faint">
              <IconTerminal size={12} aria-hidden />
              Connect command
            </div>
            <CodeInline className="block break-all whitespace-normal text-fg-secondary">{connectCmd}</CodeInline>
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={signalRows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
