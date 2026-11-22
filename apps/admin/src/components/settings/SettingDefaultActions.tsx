/**
 * FILE: apps/admin/src/components/settings/SettingDefaultActions.tsx
 * PURPOSE: "Reset to default" (and "Use recommended" when the recommendation
 *          differs) under a settings field. The values come from the same
 *          places the help popover reads: the field's default and, where a
 *          source supports one, configDocs' `recommended`. Buttons only edit
 *          the form; saving stays with the panel's own Save.
 */

import { Btn } from '../ui'

/** A reset reads as a link, not a chip: a disabled "Default (0.85)" chip looked broken (fresh-eyes 2026-11-18). */
export const RESET_LINK = '!border-transparent !bg-transparent !px-1 underline underline-offset-2 hover:!shadow-none'

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
      {current === defaultValue ? (
        <span className="text-2xs text-fg-muted" data-testid={`reset-${id}`}>
          Default ({format(defaultValue)})
        </span>
      ) : (
        <Btn size="sm" variant="ghost" className={RESET_LINK} onClick={() => onApply(defaultValue)} data-testid={`reset-${id}`}>
          Reset to {format(defaultValue)}
        </Btn>
      )}
      {showRecommended &&
        (current === recommended ? (
          <span className="text-2xs text-fg-muted" data-testid={`recommend-${id}`}>
            Using recommended ({format(recommended)})
          </span>
        ) : (
          <Btn size="sm" variant="ghost" className={RESET_LINK} onClick={() => onApply(recommended)} data-testid={`recommend-${id}`}>
            Use recommended ({format(recommended)})
          </Btn>
        ))}
    </div>
  )
}
