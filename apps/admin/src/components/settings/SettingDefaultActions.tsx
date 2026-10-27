/**
 * FILE: apps/admin/src/components/settings/SettingDefaultActions.tsx
 * PURPOSE: "Reset to default" (and "Use recommended" when the recommendation
 *          differs) under a settings field. The values come from the same
 *          places the help popover reads: the field's default and, where a
 *          source supports one, configDocs' `recommended`. Buttons only edit
 *          the form; saving stays with the panel's own Save.
 */

import { Btn } from '../ui'

export function SettingDefaultActions<T extends string | number>({
  current,
  defaultValue,
  recommended,
  format = (v) => String(v),
  onApply,
  id,
}: {
  current: T
  defaultValue: T
  /** Leave out when the recommendation is the default (or there is none). */
  recommended?: T
  format?: (v: T) => string
  onApply: (v: T) => void
  /** Suffix for data-testid. */
  id: string
}) {
  const showRecommended = recommended !== undefined && recommended !== defaultValue
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Btn
        size="sm"
        variant="ghost"
        onClick={() => onApply(defaultValue)}
        disabled={current === defaultValue}
        data-testid={`reset-${id}`}
      >
        {current === defaultValue ? `Default (${format(defaultValue)})` : `Reset to default (${format(defaultValue)})`}
      </Btn>
      {showRecommended && (
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => onApply(recommended)}
          disabled={current === recommended}
          data-testid={`recommend-${id}`}
        >
          {current === recommended ? `Using recommended (${format(recommended)})` : `Use recommended (${format(recommended)})`}
        </Btn>
      )}
    </div>
  )
}
