import { SignalChip } from '../report-detail/ReportSurface'
import { MCP_USE_CASES } from '../../lib/mcpPageHelpers'

export function McpExamplesPanel() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="mcp-use-cases">
      {MCP_USE_CASES.map((uc) => (
        <div
          key={uc.title}
          className="rounded-md border border-edge-subtle bg-surface-raised p-3 space-y-2 motion-safe:transition-opacity hover:border-edge"
        >
          <div className="text-xs font-semibold text-fg">{uc.title}</div>
          <div className="text-sm text-fg-secondary leading-snug">
            <span className="text-accent">“</span>
            {uc.ask}
            <span className="text-accent">”</span>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {uc.calls.map((c) => (
              <SignalChip key={c} tone="neutral" className="font-mono text-2xs">
                {c}
              </SignalChip>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
