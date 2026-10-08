import { Btn, Card } from '../ui'
import { McpEndpointReadout } from './McpEndpointReadout'
import { MCP_USE_CASES } from '../../lib/mcpPageHelpers'
import type { McpStats } from './types'

export interface McpOverviewPanelProps {
  stats: McpStats
  lastFetchedAt: string | null
  isValidating: boolean
  onOpenExamples: () => void
}

/** Connection state lives in the status banner above; this tab shows what MCP is for. */
export function McpOverviewPanel({
  stats,
  lastFetchedAt,
  isValidating,
  onOpenExamples,
}: McpOverviewPanelProps) {
  return (
    <div className="space-y-4">
      <McpEndpointReadout stats={stats} fetchedAt={lastFetchedAt} validating={isValidating} />
      <Card  className="px-4 py-3">
        <p className="text-xs font-semibold text-fg mb-2">What you can do with MCP connected</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MCP_USE_CASES.slice(0, 4).map((uc) => (
            <Card key={uc.title}  className="px-3 py-2">
              <p className="text-2xs font-semibold text-fg">{uc.title}</p>
              <p className="mt-0.5 text-2xs italic text-fg-secondary line-clamp-2">
                &ldquo;{uc.ask}&rdquo;
              </p>
              <p className="mt-1 text-2xs text-fg-faint line-clamp-1">
                {uc.calls.slice(0, 2).join(', ')}
                {uc.calls.length > 2 ? ` +${uc.calls.length - 2} more` : ''}
              </p>
            </Card>
          ))}
        </div>
        <Btn
          type="button"
          size="sm"
          variant="ghost"
          onClick={onOpenExamples}
          className="mt-2 !px-0 !py-0 text-2xs"
        >
          See all {MCP_USE_CASES.length} examples →
        </Btn>
      </Card>
    </div>
  )
}
