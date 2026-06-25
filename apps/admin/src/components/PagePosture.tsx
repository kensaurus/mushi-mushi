/**
 * FILE: PagePosture.tsx
 * PURPOSE: Enforce per-mode chrome budget above primary work UI — prevents
 *          stacked status banners, heroes, snapshot grids, and guides from
 *          consuming the first viewport (Design System v2 chrome budget).
 */

import type { ReactNode } from 'react'
import { useAdminMode, type AdminMode } from '../lib/mode'
import { PAGE_STACK } from '../lib/pageLayout'
import { SpringChromeEnter } from './motion/SpringChromeEnter'

export interface PagePostureSlot {
  /**
   * Stable identity for React's key. Prefer this when two slots could share a
   * priority. Falls back to `priority` (unique per page in practice) so React
   * never reuses the wrong child when slots appear/disappear or reorder.
   */
  id?: string
  /** Lower number = higher priority (rendered first). */
  priority: number
  /** When false, slot is omitted. Defaults to true. */
  show?: boolean
  children: ReactNode
}

export interface PagePostureProps {
  slots: PagePostureSlot[]
  /** Override mode-derived row cap (Quickstart/Beginner: 2, Advanced: 3). */
  maxRows?: number
  className?: string
}

/** Max summary rows above primary work UI — documented in apps/admin/README.md. */
export function postureBudgetForMode(mode: AdminMode): number {
  switch (mode) {
    case 'quickstart':
    case 'beginner':
      return 2
    case 'advanced':
      return 3
    default:
      return 2
  }
}

/** Shared priority constants for posture slots across pages. */
export const POSTURE_PRIORITY = {
  status: 0,
  recommended: 10,
  heroOrSnapshot: 20,
  guide: 30,
  nudge: 5,
} as const

export function PagePosture({ slots, maxRows, className }: PagePostureProps) {
  const { mode } = useAdminMode()
  const cap = maxRows ?? postureBudgetForMode(mode)

  const visible = slots
    .filter((slot) => slot.show !== false && slot.children != null)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, cap)

  if (visible.length === 0) return null

  return (
    <div className={className ?? PAGE_STACK} data-page-posture="">
      {visible.map((slot, idx) => (
        <SpringChromeEnter key={slot.id ?? slot.priority} delay={idx * 0.04}>
          {slot.children}
        </SpringChromeEnter>
      ))}
    </div>
  )
}
