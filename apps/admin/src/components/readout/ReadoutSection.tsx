/**
 * FILE: ReadoutSection.tsx
 * PURPOSE: Labeled readout column header with icon — shared by Connect provenance,
 *          onboarding setup readout, and future endpoint/signal bands.
 */

import type { ReactNode } from 'react'

export function ReadoutSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 border-b border-edge-subtle/60 pb-1.5">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-edge-subtle bg-surface-overlay text-fg-muted">
          {icon}
        </span>
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-secondary">{title}</h3>
      </div>
      {children}
    </div>
  )
}
