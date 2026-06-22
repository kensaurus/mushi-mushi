/**
 * FILE: ExploreWorkspaceReadout.tsx
 * PURPOSE: Lightweight atlas readout — codebase API endpoints for index scope panel.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth } from '../icons'

export interface ExploreWorkspaceReadoutProps {
  projectId: string
  scopePaths?: string[]
}

export function ExploreWorkspaceReadout({ projectId, scopePaths = [] }: ExploreWorkspaceReadoutProps) {
  const settingsUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/projects/${projectId}/codebase/settings`
  const analyzeUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/projects/${projectId}/codebase/analyze`

  const rows: DetailRowItem[] = [
    {
      label: 'Project ref',
      value: projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'Index scope paths',
      value: scopePaths.length > 0 ? scopePaths.join(', ') : 'Full repo (default)',
      wrap: true,
    },
  ]

  return (
    <Section title="Atlas readout">
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Codebase index API paths for this project — use when wiring MCP or debugging stale graph data.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Codebase settings" url={settingsUrl} />
          <div className="mt-2">
            <EndpointCodeRow label="Analyze job" url={analyzeUrl} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Scope" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
