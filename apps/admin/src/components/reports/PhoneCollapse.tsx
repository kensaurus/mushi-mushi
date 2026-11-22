/**
 * FILE: apps/admin/src/components/reports/PhoneCollapse.tsx
 * PURPOSE: On a phone, a section of the Bugs page chrome (severity tiles,
 *          filters) folds behind one line, so the list is not ~1,350px down
 *          the page (R2 sweep 2026-11-18). From `sm` up the section always
 *          shows and the toggle is hidden.
 */

import { useId, useState, type ReactNode } from 'react'

export function PhoneCollapse({
  label,
  hint,
  children,
  testId,
}: {
  /** The toggle's words, e.g. "Filters". */
  label: string
  /** Short state beside the label, e.g. "2 on". */
  hint?: string | null
  children: ReactNode
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="mb-2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-edge-subtle px-2 py-1 text-xs font-medium text-fg-secondary hover:text-fg sm:hidden"
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={`motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}>
          <path d="M3 2l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
        {hint ? <span className="font-normal text-fg-muted">· {hint}</span> : null}
      </button>
      <div id={id} className={open ? '' : 'hidden sm:block'}>
        {children}
      </div>
    </div>
  )
}
