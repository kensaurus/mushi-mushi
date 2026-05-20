/**
 * Inline hint under a settings field when the draft differs from saved.
 */

import { formatSettingValue, valuesEqual } from './settingsDiff'

interface SettingsChangeHintProps {
  current: unknown
  saved: unknown
  kind?: 'text' | 'secret' | 'bool' | 'number' | 'url'
  /** Override the default "Was:" prefix — e.g. "Previously:" */
  prefix?: string
}

export function SettingsChangeHint({
  current,
  saved,
  kind = 'text',
  prefix = 'Was',
}: SettingsChangeHintProps) {
  if (valuesEqual(current, saved)) return null

  const formatted = formatSettingValue(saved, { kind })

  return (
    <p
      className="mt-1 flex flex-wrap items-baseline gap-x-1 text-2xs text-warn"
      role="status"
      aria-live="polite"
    >
      <span className="font-medium shrink-0">{prefix}:</span>
      <span className="font-mono text-fg-muted break-all">{formatted}</span>
    </p>
  )
}
