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
      {/* Bare glyph, no bordered tile: a boxed icon beside a heading reads as
          a second button and adds a third outline to an already-framed card. */}
      <div className="flex items-center gap-2 border-b border-edge-subtle pb-1.5">
        <span className="inline-flex shrink-0 text-fg-muted" aria-hidden="true">
          {icon}
        </span>
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-fg-secondary">{title}</h3>
      </div>
      {children}
    </div>
  )
}
