import { Btn, Card, RecommendedAction, RelativeTime } from '../ui'
import { Card } from '../../components/ui'
import { McpEndpointReadout } from './McpEndpointReadout'
import {
  ActionPill,
  ActionPillRow,
  InlineProof,
  SignalChip,
} from '../report-detail/ReportSurface'
import { MCP_USE_CASES } from '../../lib/mcpPageHelpers'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { McpStats } from './types'

export interface McpOverviewPanelProps {
  stats: McpStats
  lastFetchedAt: string | null
  isValidating: boolean
  hideOverviewChrome: boolean
  onOpenExamples: () => void
  onCopySnippet: (payload: string, label: string) => void
}

export function McpOverviewPanel({
  stats,
  lastFetchedAt,
  isValidating,
  hideOverviewChrome,
  onOpenExamples,
  onCopySnippet,
}: McpOverviewPanelProps) {
  const mushiMcpApi = RESOLVED_EXTERNAL_API_URL

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

      {stats.topPriority === 'healthy' && (
        <RecommendedAction
          tone="success"
          title="Agent access live"
          description={stats.topPriorityLabel ?? `${stats.connectedKeyCount} MCP key(s) connected with heartbeat.`}
          cta={{ label: 'Browse catalog', to: '/mcp?tab=catalog' }}
        />
      )}
      {!hideOverviewChrome && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="space-y-2 border-edge p-3 sm:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Connection cockpit</p>
              <SignalChip tone={stats.connectedKeyCount > 0 ? 'ok' : stats.mcpReadKeyCount > 0 ? 'warn' : 'neutral'}>
                {stats.connectedKeyCount > 0 ? 'Handshake OK' : stats.mcpReadKeyCount > 0 ? 'Awaiting IDE' : 'No MCP key'}
              </SignalChip>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 text-xs">
              <div>
                <p className="text-fg-faint text-3xs uppercase tracking-wide">Expected endpoint</p>
                <p className="font-mono text-fg-secondary truncate" title={stats.expectedEndpointHost ?? mushiMcpApi}>
                  {stats.expectedEndpointHost ?? new URL(mushiMcpApi).host}
                </p>
              </div>
              <div>
                <p className="text-fg-faint text-3xs uppercase tracking-wide">Last agent host</p>
                <p className="font-mono text-fg-secondary truncate" title={stats.lastSeenEndpointHost ?? undefined}>
                  {stats.lastSeenEndpointHost ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-fg-faint text-3xs uppercase tracking-wide">Try in Cursor</p>
                <ActionPillRow>
                  <ActionPill
                    tone="brand"
                    onClick={() => void onCopySnippet('List all Mushi MCP tools for this project.', 'Try command')}
                  >
                    Copy: list tools
                  </ActionPill>
                  <ActionPill
                    tone="neutral"
                    onClick={() => void onCopySnippet('get_recent_reports limit=5', 'Try command')}
                  >
                    Copy: recent reports
                  </ActionPill>
                </ActionPillRow>
              </div>
            </div>
          </Card>
          <Card className="space-y-2 border-edge p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Read scope</p>
              <SignalChip tone={stats.mcpReadKeyCount > 0 ? 'ok' : 'warn'}>
                {stats.mcpReadKeyCount > 0 ? 'Ready' : 'Missing'}
              </SignalChip>
            </div>
            <p className="text-lg font-semibold tabular-nums text-fg-primary">{stats.mcpReadKeyCount}</p>
            <InlineProof>Required to list tools + read triage</InlineProof>
          </Card>
          <Card className="space-y-2 border-edge p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Write scope</p>
              <SignalChip tone={stats.mcpWriteKeyCount > 0 ? 'ok' : 'neutral'}>
                {stats.mcpWriteKeyCount > 0 ? 'Enabled' : 'Optional'}
              </SignalChip>
            </div>
            <p className="text-lg font-semibold tabular-nums text-warn">{stats.mcpWriteKeyCount}</p>
            <InlineProof>Optional — dispatch fixes from agents</InlineProof>
          </Card>
          <Card className="space-y-2 border-edge p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Last heartbeat</p>
              <SignalChip tone={stats.lastSeenAt ? 'brand' : 'neutral'}>
                {stats.lastSeenAt ? 'Live' : 'Silent'}
              </SignalChip>
            </div>
            <p className="text-sm font-semibold text-fg-primary">
              {stats.lastSeenAt ? <RelativeTime value={stats.lastSeenAt} /> : 'Never'}
            </p>
            <InlineProof className="truncate font-mono">
              <span title={stats.lastSeenEndpointHost ?? undefined}>
                {stats.lastSeenEndpointHost ?? 'No MCP traffic yet'}
              </span>
            </InlineProof>
          </Card>
        </div>
      )}
    </div>
  )
}
