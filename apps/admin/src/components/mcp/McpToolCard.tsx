import { Badge } from '../ui'
import { Card } from '../../components/ui'
import { SignalChip } from '../report-detail/ReportSurface'
import { CHIP_TONE } from '../../lib/chipTone'
import { type ToolSpec, type McpScope } from '../../lib/mcpCatalog'

export function scopeBadgeTone(scope: McpScope): string {
  return scope === 'mcp:write'
    ? CHIP_TONE.warn
    : CHIP_TONE.info
}

/**
 * The chips a card shows: only what differs from its section. The catalog is
 * split into Read and Write sections, so "mcp:read", "read-only" and
 * "idempotent" on every read card said the section heading 61 times
 * (round-2 review 2026-11-18). A read tool that writes, a destructive tool,
 * and a write tool that is safe to retry still get a chip.
 * @internal Exported for tests.
 */
export function toolCardChips(spec: Pick<ToolSpec, 'scope' | 'hints'>): Array<{ label: string; tone: string; title: string }> {
  const chips: Array<{ label: string; tone: string; title: string }> = []
  if (spec.scope === 'mcp:read' && !spec.hints.readOnly) {
    chips.push({ label: 'writes', tone: CHIP_TONE.warn, title: 'Will mutate data. Your client should prompt for confirmation.' })
  }
  if (spec.scope === 'mcp:write' && spec.hints.readOnly) {
    chips.push({ label: 'read-only', tone: CHIP_TONE.neutral, title: 'Client can auto-approve. No side effects.' })
  }
  if (spec.hints.destructive) {
    chips.push({ label: 'destructive', tone: CHIP_TONE.danger, title: 'Can remove data from report queues. Confirm every call.' })
  }
  if (spec.scope === 'mcp:write' && spec.hints.idempotent) {
    chips.push({ label: 'safe to retry', tone: CHIP_TONE.neutral, title: 'Calling twice with the same args is safe.' })
  }
  return chips
}

/** The description's first sentence; the rest (the API detail) folds away. @internal Exported for tests. */
export function splitToolDescription(text: string): { lead: string; more: string | null } {
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(text.trim())
  return m ? { lead: m[1], more: m[2] } : { lead: text.trim(), more: null }
}

export function McpToolCard({ tool }: { tool: ToolSpec }) {
  const stripeTone = tool.scope === 'mcp:write' ? 'bg-warn' : 'bg-info'
  const chips = toolCardChips(tool)
  const { lead, more } = splitToolDescription(tool.description)
  // One frame, text that wraps anywhere: at 390 px the raw API text in a
  // nested grey box pushed every card off the side of the page.
  return (
    <Card className="relative min-w-0 p-3 pl-4">
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-sm ${stripeTone}`} aria-hidden="true" />
      <div className="mb-1 min-w-0">
        <div className="text-sm font-semibold text-fg">{tool.title}</div>
        <SignalChip tone="neutral" className="font-mono wrap-anywhere max-w-full">
          {tool.name}
        </SignalChip>
      </div>
      <div className="mb-1 text-sm leading-snug text-fg-secondary [overflow-wrap:anywhere]">
        <span className="text-accent">“</span>
        {tool.useCase}
        <span className="text-accent">”</span>
      </div>
      <p className="text-xs leading-snug text-fg-muted [overflow-wrap:anywhere]">{lead}</p>
      {more ? (
        <details className="mt-1 text-xs text-fg-muted">
          <summary className="cursor-pointer text-2xs font-medium text-fg-secondary">API details</summary>
          <p className="mt-1 leading-snug [overflow-wrap:anywhere]">{more}</p>
        </details>
      ) : null}
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {chips.map((chip) => (
            <Badge key={chip.label} className={chip.tone} title={chip.title}>
              {chip.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
