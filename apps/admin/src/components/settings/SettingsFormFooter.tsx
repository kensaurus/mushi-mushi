/**
 * Sticky save / discard / reset bar for settings panels with unsaved edits.
 */

import { Btn } from '../ui'

interface SettingsFormFooterProps {
  dirty: boolean
  saving?: boolean
  changeCount?: number
  onSave: () => void
  onDiscard: () => void
  saveLabel?: string
}

export function SettingsFormFooter({
  dirty,
  saving = false,
  changeCount,
  onSave,
  onDiscard,
  saveLabel = 'Save changes',
}: SettingsFormFooterProps) {
  if (!dirty) return null

  const countLabel =
    changeCount != null && changeCount > 0
      ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}`
      : 'Unsaved changes'

  return (
    <div
      className="sticky bottom-0 z-10 -mx-1 mt-4 rounded-md border border-edge-subtle bg-surface/95 px-3 py-2.5 shadow-raised backdrop-blur-sm"
      role="region"
      aria-label="Unsaved settings actions"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-2xs text-fg-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-warn mr-1.5 align-middle" aria-hidden />
          {countLabel}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Reset to saved
          </Btn>
          <Btn size="sm" onClick={onSave} disabled={saving} loading={saving}>
            {saveLabel}
          </Btn>
        </div>
      </div>
    </div>
  )
}
