/**
 * FILE: GraphWorkspaceReadout.tsx
 * PURPOSE: Graph canvas contextual readout — project ref and graph API endpoints.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth } from '../icons'

export interface GraphWorkspaceReadoutProps {
  projectId: string | null
  nodeCount?: number
  edgeCount?: number
}

export function GraphWorkspaceReadout({
  projectId,
  nodeCount,
  edgeCount,
}: GraphWorkspaceReadoutProps) {
  if (!projectId) return null

  const graphUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/graph?project_id=${projectId}`

  const rows: DetailRowItem[] = [
    {
      label: 'Project ref',
      value: projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'Nodes',
      value: nodeCount != null ? String(nodeCount) : '—',
      tone: nodeCount != null && nodeCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Edges',
      value: edgeCount != null ? String(edgeCount) : '—',
      tone: edgeCount != null && edgeCount > 0 ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Graph readout">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Graph API" url={graphUrl} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
