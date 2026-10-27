/**
 * FILE: apps/admin/src/components/mcp/McpOverviewPanel.tsx
 * PURPOSE: Editor agents → Overview (console journeys 2026-10-27): which
 *          editors talk to Mushi and when each last called, then a few things
 *          to paste into your editor, then key health in one line. The six
 *          key-scope tiles are gone; the endpoint details sit at the foot.
 */

import { Btn, Card, CopyButton, formatRelative } from '../ui'
import { McpEndpointReadout } from './McpEndpointReadout'
import { MCP_USE_CASES } from '../../lib/mcpPageHelpers'
import { connectedEditors, keyHealthLine } from './connectedEditors'
import type { McpKeyRow, McpStats } from './types'

export interface McpOverviewPanelProps {
  stats: McpStats
  /** The open app's keys; null while loading. */
  keys: McpKeyRow[] | null
  lastFetchedAt: string | null
  isValidating: boolean
  onOpenExamples: () => void
  onOpenSetup: () => void
}

/** How many prompts to show before "See all". */
const PROMPTS_SHOWN = 5

export function McpOverviewPanel({ stats, keys, lastFetchedAt, isValidating, onOpenExamples, onOpenSetup }: McpOverviewPanelProps) {
  const editors = connectedEditors(keys ?? [])
  return (
    <div className="space-y-4">
      <Card className="p-0" data-testid="mcp-connected-editors">
        <h3 className="border-b border-edge-subtle px-3 py-2 text-xs font-semibold text-fg">Connected editors</h3>
        {keys == null ? (
          <p className="px-3 py-3 text-xs text-fg-muted">Reading your keys…</p>
        ) : editors.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
            <p className="text-xs text-fg-muted">No editor has called Mushi from this app yet.</p>
            <Btn size="sm" variant="primary" to="/connect">
              Connect an editor
            </Btn>
          </div>
        ) : (
          <ul aria-label="Connected editors" className="divide-y divide-edge-subtle">
            {editors.map((e) => (
              <li key={e.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ok" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{e.name}</span>
                <span className="shrink-0 text-2xs text-fg-muted">{e.canWrite ? 'Reads and fixes' : 'Reads only'}</span>
                <span className="shrink-0 text-2xs text-fg-secondary">Last call {formatRelative(e.lastCallAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-fg">Paste one of these into your editor</p>
        <ul aria-label="Example prompts" className="space-y-1.5">
          {MCP_USE_CASES.slice(0, PROMPTS_SHOWN).map((uc) => (
            <li key={uc.title} className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-semibold text-fg-muted">{uc.title}</p>
                <p className="text-sm leading-snug text-fg">&ldquo;{uc.ask}&rdquo;</p>
              </div>
              <CopyButton value={uc.ask} label={`Copy "${uc.ask}"`} className="mt-1 shrink-0" />
            </li>
          ))}
        </ul>
        <Btn type="button" size="sm" variant="ghost" onClick={onOpenExamples} className="mt-2 !px-0 !py-0 text-2xs">
          See all {MCP_USE_CASES.length} examples →
        </Btn>
      </Card>

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted" data-testid="mcp-key-health">
        <span>{keyHealthLine(stats)}</span>
        <Btn type="button" size="sm" variant="ghost" onClick={onOpenSetup} className="!px-0 !py-0 text-2xs">
          Manage keys →
        </Btn>
      </p>

      <McpEndpointReadout stats={stats} fetchedAt={lastFetchedAt} validating={isValidating} />
    </div>
  )
}
