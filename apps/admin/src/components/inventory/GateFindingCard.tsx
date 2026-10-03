import type { ReactNode } from 'react'
import { Btn } from '../ui'
import { Card } from '../../components/ui'
import { gateLabel } from '../../lib/gateLabels'

export interface GateFinding {
  id: string
  message: string
  severity?: string
  file_path?: string | null
  line?: number | null
  rule_id?: string | null
  gate?: string
}

export function GateFindingCard({
  f,
  onOpenFile,
  action,
}: {
  f: GateFinding
  onOpenFile?: (path: string, line?: number | null) => void
  /** An extra control for this finding, e.g. a one-click fix. */
  action?: ReactNode
}) {
  return (
    <Card  className="p-3 text-2xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono uppercase ${f.severity === 'error' ? 'text-danger' : f.severity === 'info' ? 'text-fg-muted' : 'text-warn'}`}>
          {f.gate ? gateLabel(f.gate) : 'gate'} · {f.severity ?? 'info'}
          {f.rule_id ? ` · ${f.rule_id}` : ''}
        </span>
        {f.file_path && onOpenFile && (
          <Btn
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => onOpenFile(f.file_path!, f.line ?? null)}
            className="!text-2xs"
          >
            Open file
          </Btn>
        )}
      </div>
      <p className="text-fg-secondary leading-snug">{f.message}</p>
      {f.file_path && (
        <p className="text-fg-faint font-mono truncate">
          {f.file_path}
          {f.line != null ? `:${f.line}` : ''}
        </p>
      )}
      {action && <div className="flex flex-wrap items-center gap-2 pt-1">{action}</div>}
    </Card>
  )
}
