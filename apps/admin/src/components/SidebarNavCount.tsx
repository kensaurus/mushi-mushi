/**
 * FILE: apps/admin/src/components/SidebarNavCount.tsx
 * PURPOSE: Sidebar count for inventory/metadata nav items. Neutral number
 *          by default; delegates to SidebarHealthDot when attention is
 *          required so inventory and action-required signals stay visually
 *          distinct (NN/g #4 Consistency).
 */

import type { HealthTone } from '../lib/useNavCounts'
import { SidebarHealthDot } from './SidebarHealthDot'

interface AttentionProps {
  tone: HealthTone
  count: number
  label: string
}

interface Props {
  /** Inventory count — muted, no coloured dot. */
  count: number
  label: string
  /** When set and count > 0, renders attention dot instead of inventory. */
  attention?: AttentionProps | null
}

export function SidebarNavCount({ count, label, attention }: Props) {
  if (attention && attention.count > 0) {
    return (
      <SidebarHealthDot
        tone={attention.tone}
        count={attention.count}
        label={attention.label}
        hideWhenZero
      />
    )
  }
  if (count <= 0) return null
  return (
    <span
      aria-label={label}
      title={label}
      className="ml-auto text-2xs font-medium tabular-nums text-fg-muted"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
