import { Badge } from '../ui'
import { ContainedBlock, SignalChip } from '../report-detail/ReportSurface'
import { CHIP_TONE } from '../../lib/chipTone'
import { type ToolSpec, type McpScope } from '../../lib/mcpCatalog'

export function scopeBadgeTone(scope: McpScope): string {
  return scope === 'mcp:write'
    ? CHIP_TONE.warnSubtle
    : CHIP_TONE.infoSubtle
}

export function hintBadges(spec: ToolSpec) {
  const chips: Array<{ label: string; tone: string; title: string }> = []
  if (spec.hints.readOnly) {
    chips.push({
      label: 'read-only',
      tone: CHIP_TONE.okSubtle + ' border border-ok/30',
      title: 'Client can auto-approve. No side effects.',
    })
  } else {
    chips.push({
      label: 'writes',
      tone: CHIP_TONE.warnSubtle,
      title: 'Will mutate data. Your client should prompt for confirmation.',
    })
  }
  if (spec.hints.destructive) {
    chips.push({
      label: 'destructive',
      tone: CHIP_TONE.dangerSubtle + ' border border-danger/30',
      title: 'Can remove data from report queues. Confirm every call.',
    })
  }
  if (spec.hints.idempotent) {
    chips.push({
      label: 'idempotent',
      tone: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
      title: 'Calling twice with the same args is safe.',
    })
  }
  return chips
}

export function McpToolCard({ tool }: { tool: ToolSpec }) {
  const stripeTone = tool.scope === 'mcp:write' ? 'bg-warn' : 'bg-info'
  return (
    <div className="relative rounded-md border border-edge-subtle bg-surface-raised p-3 pl-4 motion-safe:transition-colors hover:border-edge">
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-sm ${stripeTone}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{tool.title}</div>
          <SignalChip tone="neutral" className="font-mono wrap-anywhere max-w-full">
            {tool.name}
          </SignalChip>
        </div>
        <Badge className={scopeBadgeTone(tool.scope)}>{tool.scope}</Badge>
      </div>
      <div className="text-sm text-fg-secondary leading-snug mb-1">
        <span className="text-accent">“</span>
        {tool.useCase}
        <span className="text-accent">”</span>
      </div>
      <ContainedBlock tone="muted" className="mb-2">
        <p className="text-xs leading-snug text-fg-muted">{tool.description}</p>
      </ContainedBlock>
      <div className="flex items-center gap-1 flex-wrap">
        {hintBadges(tool).map((chip) => (
          <Badge key={chip.label} className={chip.tone} title={chip.title}>
            {chip.label}
          </Badge>
        ))}
      </div>
    </div>
  )
}
