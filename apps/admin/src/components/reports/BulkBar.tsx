/**
 * FILE: apps/admin/src/components/reports/BulkBar.tsx
 * PURPOSE: Sticky bulk-action bar that appears when one or more rows are
 *          selected. Internal `BulkSelect` resets after each pick so the menu
 *          can be used repeatedly without manual state management upstream.
 */

import { Btn } from '../ui'

interface Props {
  count: number
  busy: boolean
  /** When set, the actions stay disabled and this sentence says why. */
  disabledReason?: string | null
  onClear: () => void
  onSetStatus: (v: string) => void
  onSetSeverity: (v: string) => void
  onDismiss: () => void
}

export function BulkBar({ count, busy, disabledReason = null, onClear, onSetStatus, onSetSeverity, onDismiss }: Props) {
  if (count === 0) return null
  const locked = Boolean(disabledReason)
  return (
    <div
      className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 backdrop-blur"
      role="region"
      aria-label="Bulk actions"
    >
      <span className="text-xs font-medium text-fg">{count} selected</span>
      <span className="text-2xs text-fg-muted">·</span>
      {locked ? (
        <span className="text-2xs text-fg-secondary" data-testid="bulk-other-apps">
          {disabledReason}
        </span>
      ) : null}
      <BulkSelect
        label="Set status"
        disabled={busy || locked}
        options={['new', 'classified', 'fixing', 'fixed', 'dismissed']}
        onPick={onSetStatus}
      />
      <BulkSelect
        label="Set severity"
        disabled={busy || locked}
        options={['critical', 'high', 'medium', 'low']}
        onPick={onSetSeverity}
      />
      <Btn size="sm" variant="danger" onClick={onDismiss} disabled={busy || locked}>
        Dismiss
      </Btn>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex min-h-6 items-center text-2xs text-fg-muted hover:text-fg underline"
      >
        Clear selection (esc)
      </button>
    </div>
  )
}

interface BulkSelectProps {
  label: string
  options: string[]
  disabled?: boolean
  onPick: (v: string) => void
}

function BulkSelect({ label, options, disabled, onPick }: BulkSelectProps) {
  return (
    <select
      defaultValue=""
      disabled={disabled}
      onChange={(e) => {
        const v = e.currentTarget.value
        if (!v) return
        onPick(v)
        e.currentTarget.value = ''
      }}
      className="min-h-6 max-w-full bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
    >
      <option value="">{label}…</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
