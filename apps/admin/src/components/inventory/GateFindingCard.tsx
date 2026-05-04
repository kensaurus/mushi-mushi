import { Btn } from '../ui'

export interface GateFinding {
  id: string
  message: string
  severity?: string
  file_path?: string | null
  line?: number | null
  rule_id?: string | null
  gate?: string
}

export function GateFindingCard({ f, onOpenFile }: { f: GateFinding; onOpenFile?: (path: string, line?: number | null) => void }) {
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/40 p-3 text-2xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono uppercase ${f.severity === 'error' ? 'text-danger' : 'text-warn'}`}>
          {f.gate ?? 'gate'} · {f.severity ?? 'info'}
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
    </div>
  )
}
