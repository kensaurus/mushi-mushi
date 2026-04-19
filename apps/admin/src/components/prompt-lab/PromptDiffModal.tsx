import { Card, Btn, RelativeTime } from '../ui'
import type { PromptVersion } from './types'
import { lineDiff } from './lineDiff'

interface PromptDiffModalProps {
  prompt: PromptVersion
  parent: PromptVersion | undefined
  onClose: () => void
}

export function PromptDiffModal({ prompt, parent, onClose }: PromptDiffModalProps) {
  const lines = parent ? lineDiff(parent.prompt_template, prompt.prompt_template) : []
  const meta = prompt.auto_generation_metadata
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <Card
        elevated
        className="w-full max-w-5xl p-4 space-y-2 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            Diff · {prompt.stage} / {prompt.version} vs {parent?.version ?? 'parent'}
          </h3>
          <button
            type="button"
            className="text-fg-muted hover:text-fg text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {meta && (
          <div className="text-2xs text-fg-muted space-y-1 border border-edge-subtle rounded-sm p-2 bg-surface-overlay">
            {meta.changeSummary && (
              <p className="text-fg-secondary">
                <span className="text-fg-faint">Why: </span>
                {meta.changeSummary}
              </p>
            )}
            <div className="flex flex-wrap gap-2 font-mono">
              {meta.failureCount != null && <span>failures: {meta.failureCount}</span>}
              {meta.model && <span>model: {meta.model}</span>}
              {meta.generatedAt && <span>generated: <RelativeTime value={meta.generatedAt} /></span>}
            </div>
            {meta.topBuckets && meta.topBuckets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 font-mono">
                <span className="text-fg-faint">buckets:</span>
                {meta.topBuckets.map((b) => (
                  <span key={b.reason} className="px-1 rounded-sm bg-fg-faint/10">
                    {b.reason} ×{b.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {!parent ? (
          <p className="text-2xs text-fg-faint">Parent prompt not found (it may have been deleted).</p>
        ) : (
          <pre className="flex-1 overflow-auto bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono leading-snug">
            {lines.map((l, idx) => (
              <div
                key={idx}
                className={
                  l.kind === 'add'
                    ? 'bg-ok/10 text-ok'
                    : l.kind === 'del'
                      ? 'bg-danger/10 text-danger'
                      : 'text-fg-muted'
                }
              >
                <span className="select-none mr-2 text-fg-faint">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                </span>
                {l.text || '\u00A0'}
              </div>
            ))}
          </pre>
        )}
        <div className="flex justify-end gap-1.5">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </div>
      </Card>
    </div>
  )
}
