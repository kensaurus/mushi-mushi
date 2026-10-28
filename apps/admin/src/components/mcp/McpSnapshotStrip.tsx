/**
 * FILE: McpSnapshotStrip.tsx
 * PURPOSE: Editor agents status: is your editor talking to Mushi, and when did
 *          it last call (PageStatus, P1). Key scopes stay on the Setup tab.
 */

import { PageStatus } from '../ui'
import type { McpStats } from './types'
import { formatRelative } from '../ui'
import { pluralizeWithCount } from '../../lib/format'
import { mcpLinks } from '../../lib/statCardLinks'

interface Props {
  stats: McpStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function mcpSentence(stats: McpStats): string {
  if (stats.connectedKeyCount === 0) {
    return stats.activeKeyCount > 0
      ? 'No editor has called Mushi yet. Connect one from Setup.'
      : 'No editor is connected yet.'
  }
  const last = stats.lastSeenAt ? `, last call ${formatRelative(stats.lastSeenAt)}` : ''
  const mismatch = stats.endpointMismatch ? ' Your editor is calling a different Mushi address than this console.' : ''
  return `${pluralizeWithCount(stats.connectedKeyCount, 'editor')} connected${last}; ${pluralizeWithCount(stats.toolCount, 'tool')} available.${mismatch}`
}

export function McpSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Editor agents status"
      tone={stats.endpointMismatch ? 'warn' : stats.connectedKeyCount > 0 ? 'ok' : 'neutral'}
      sentence={mcpSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.connected ?? 'Editors connected',
          value: stats.connectedKeyCount,
          tone: stats.connectedKeyCount > 0 ? 'ok' : 'neutral',
          hint: 'Editor keys that have called Mushi at least once.',
          to: mcpLinks.connected,
        },
        {
          label: 'Not used yet',
          value: stats.neverConnectedCount,
          hint: 'Editor keys you created that no editor has called with.',
          to: mcpLinks.activeKeys,
        },
        {
          label: statLabels?.tools ?? 'Tools',
          value: stats.toolCount,
          hint: 'Things your editor’s agent can ask Mushi to do, like read a bug or start a fix.',
          to: mcpLinks.tools,
        },
      ]}
    />
  )
}
