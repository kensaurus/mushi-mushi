import type { ReactNode } from 'react'
import { Btn } from '../ui'
import { Card } from '../../components/ui'
import { gateLabel, ruleLabel } from '../../lib/gateLabels'

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
  inGroup = false,
}: {
  f: GateFinding
  onOpenFile?: (path: string, line?: number | null) => void
  /** An extra control for this finding, e.g. a one-click fix. */
  action?: ReactNode
  /**
   * The finding sits under its check's own header (fresh-eyes 2026-11-18): draw it as a
   * hairline row, not a card in a card, and don't repeat the check's name on every finding.
   */
  inGroup?: boolean
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono uppercase ${f.severity === 'error' ? 'text-danger' : f.severity === 'info' ? 'text-fg-muted' : 'text-warn'}`}>
          {inGroup ? null : <>{f.gate ? gateLabel(f.gate) : 'gate'} · </>}
          {f.severity ?? 'info'}
          {f.rule_id ? (
            <span className="font-sans normal-case" title={f.rule_id}> · {ruleLabel(f.rule_id)}</span>
          ) : null}
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
    </>
  )
  if (inGroup) {
    return (
      <div className="space-y-1 py-2 text-2xs" data-testid="gate-finding-row">
        {body}
      </div>
    )
  }
  return <Card className="p-3 text-2xs space-y-1">{body}</Card>
}
