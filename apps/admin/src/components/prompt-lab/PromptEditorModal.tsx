import { Btn } from '../ui'
import { Modal } from '../Modal'
import { ConfigHelp } from '../ConfigHelp'
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
    <Modal
      open
      size="lg"
      title={`Edit prompt · ${prompt.stage} / ${prompt.version}`}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn onClick={onSave} disabled={saving} loading={saving} data-primary>Save</Btn>
        </>
      }
    >
      <p className="text-2xs text-fg-faint mb-2 inline-flex items-center gap-1">
        <span>
          The prompt is hot-reloaded by the pipeline within seconds. Use{' '}
          <code className="font-mono text-fg-secondary">{'{{report_text}}'}</code>{' '}
          and other template variables that the worker substitutes.
        </span>
        <ConfigHelp helpId="prompt-lab.prompt_body" />
      </p>
      <textarea
        className="w-full min-h-72 h-[min(60dvh,28rem)] bg-surface-overlay border border-edge-subtle rounded-sm p-2 text-2xs font-mono text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand/40"
        value={prompt.prompt_template}
        onChange={(e) => onChange({ ...prompt, prompt_template: e.currentTarget.value })}
        spellCheck={false}
      />
    </Modal>
  )
}
