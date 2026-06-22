/**
 * FILE: InventoryWorkspaceReadout.tsx
 * PURPOSE: Inventory atlas readout — proposal API and project ref for QA inventory tab.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth } from '../icons'

export interface InventoryWorkspaceReadoutProps {
  projectId: string | null
  nodeCount?: number
  storyCount?: number
}

export function InventoryWorkspaceReadout({
  projectId,
  nodeCount,
  storyCount,
}: InventoryWorkspaceReadoutProps) {
  if (!projectId) return null

  const inventoryUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/inventory?project_id=${projectId}`

  const rows: DetailRowItem[] = [
    {
      label: 'Project ref',
      value: projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'Inventory nodes',
      value: nodeCount != null ? String(nodeCount) : '—',
      tone: nodeCount != null && nodeCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'User stories',
      value: storyCount != null ? String(storyCount) : '—',
      tone: storyCount != null && storyCount > 0 ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Inventory readout">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Inventory API" url={inventoryUrl} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
