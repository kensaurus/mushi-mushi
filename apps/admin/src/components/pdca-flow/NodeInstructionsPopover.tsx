/**
 * FILE: apps/admin/src/components/pdca-flow/NodeInstructionsPopover.tsx
 * PURPOSE: Onboarding-only tooltip-style popover that explains what each
 *          PDCA node does. Rendered inside the onboarding variant of
 *          PdcaFlow so first-run users can hover a letter badge and learn
 *          the pipeline without leaving the explainer.
 */

import { useState, type ReactNode } from 'react'

interface NodeInstructionsPopoverProps {
  label: string
  hint: string
  children: ReactNode
}

export function NodeInstructionsPopover({ label, hint, children }: NodeInstructionsPopoverProps) {
  const [visible, setVisible] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-10 w-56 px-2.5 py-1.5 rounded-md border border-edge/70 bg-surface-overlay shadow-raised text-2xs text-fg-secondary leading-snug pointer-events-none motion-safe:animate-mushi-fade-in"
        >
          <span className="block font-semibold text-fg mb-0.5">{label}</span>
          {hint}
        </span>
      )}
    </span>
  )
}
