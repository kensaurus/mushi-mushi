/**
 * FILE: apps/admin/src/components/reports/CloseReasonSelect.tsx
 * PURPOSE: The "Why close it?" picker inside the list and bulk close dialogs,
 *          with the exact message the reporter will see underneath.
 */

import { closeReasonNotice, QUICK_CLOSE_REASONS } from '../../lib/closeReasons'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Reports being closed, for the "Each reporter sees" wording. */
  count?: number
}

export function CloseReasonSelect({ value, onChange, count = 1 }: Props) {
  return (
    <div className="mt-3 space-y-1.5">
      <label className="block text-xs font-medium text-fg-secondary" htmlFor="close-reason">
        Why close {count === 1 ? 'it' : 'them'}?
      </label>
      <select
        id="close-reason"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="w-full rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <option value="">No reason</option>
        {QUICK_CLOSE_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-fg-muted">{closeReasonNotice(value, count)}</p>
    </div>
  )
}
