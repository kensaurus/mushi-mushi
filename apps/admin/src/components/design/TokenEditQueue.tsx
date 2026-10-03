/**
 * FILE: apps/admin/src/components/design/TokenEditQueue.tsx
 * PURPOSE: The queue of token edits waiting to be previewed. Lets the user
 *          remove edits, preview them as one dry-run diff, and confirm the
 *          exact previewed change into a draft PR.
 */

import { Btn, Section } from '../ui'
import type { TokenEdit } from '../../lib/recipeTypes'
import { editKey, formatEditValue } from './designTokens'
import { DesignChangePreview } from './DesignChangePreview'
import { changeLocksInputs, type DesignChangeState } from './useDesignChange'

interface TokenEditQueueProps {
  edits: TokenEdit[]
  change: DesignChangeState
  onRemove: (edit: TokenEdit) => void
  onClear: () => void
  onPreview: () => void
  onConfirm: () => void
  onDiscard: () => void
}

export function TokenEditQueue({ edits, change, onRemove, onClear, onPreview, onConfirm, onDiscard }: TokenEditQueueProps) {
  if (edits.length === 0 && change.phase === 'idle') return null
  // Also locked while a PR result is on screen: "Done" closes it and clears the queue.
  const busy = changeLocksInputs(change)

  return (
    <Section
      title="Queued token edits"
      action={<span className="text-2xs text-fg-faint">{edits.length} queued</span>}
    >
      <div className="flex flex-col gap-3">
        {edits.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {edits.map((e) => (
              <li key={editKey(e)} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="font-mono text-fg">{e.path}</span>
                  <span className="text-fg-muted"> → </span>
                  <span className="font-mono text-fg-secondary">{formatEditValue(e.value)}</span>
                  {e.set && <span className="ml-2 text-2xs text-fg-faint">set {e.set}</span>}
                </span>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(e)}
                  disabled={busy}
                  title={busy ? 'Finish or discard the current change first' : `Remove the edit to ${e.path}`}
                >
                  Remove
                </Btn>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            size="sm"
            variant="primary"
            onClick={onPreview}
            loading={change.phase === 'previewing'}
            disabled={busy || edits.length === 0}
            title={edits.length === 0 ? 'Queue at least one edit first' : busy ? 'Finish or discard the current change first' : 'Preview the diff before anything is written'}
          >
            Preview changes
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={busy || edits.length === 0}
            title={edits.length === 0 ? 'The queue is empty' : busy ? 'Finish or discard the current change first' : 'Remove every queued edit'}
          >
            Clear queue
          </Btn>
        </div>
        <DesignChangePreview state={change} onConfirm={onConfirm} onDiscard={onDiscard} />
      </div>
    </Section>
  )
}
