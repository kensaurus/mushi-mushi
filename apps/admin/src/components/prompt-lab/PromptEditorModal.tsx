import { Card, Btn } from '../ui'
import type { PromptVersion } from './types'

interface PromptEditorModalProps {
  prompt: PromptVersion
  onChange: (next: PromptVersion) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}

export function PromptEditorModal({ prompt, onChange, onClose, onSave, saving }: PromptEditorModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in"
      onClick={onClose}
    >
      <Card
        elevated
        className="w-full max-w-3xl p-4 space-y-2 motion-safe:animate-mushi-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            Edit prompt · {prompt.stage} / {prompt.version}
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
        <p className="text-2xs text-fg-faint">
          The prompt is hot-reloaded by the pipeline within seconds. Use{' '}
          <code className="font-mono text-fg-secondary">{'{{report_text}}'}</code>{' '}
          and other template variables that the worker substitutes.
        </p>
        <textarea
          className="w-full h-72 bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40"
          value={prompt.prompt_template}
          onChange={(e) => onChange({ ...prompt, prompt_template: e.currentTarget.value })}
          spellCheck={false}
        />
        <div className="flex justify-end gap-1.5">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
        </div>
      </Card>
    </div>
  )
}
