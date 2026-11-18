/**
 * FILE: RewardsTabNav.tsx
 * PURPOSE: Mode-aware tab navigation for Rewards — scrollable SegmentedControl.
 */

import { useMemo } from 'react'
import { SegmentedControl } from '../ui'
import type { RewardsTabId } from './types'
import { REWARDS_TABS } from './rewardsTabs'
import { useEdgeFade } from '../../lib/useEdgeFade'

interface Props {
  active: RewardsTabId
  onChange: (id: RewardsTabId) => void
  /** Quick mode: tabs hidden — caller resolves tab from posture. */
  hideTabs?: boolean
}

export function RewardsTabNav({ active, onChange, hideTabs = false }: Props) {
  const options = useMemo(
    () => REWARDS_TABS.map((t) => ({ id: t.id, label: t.label })),
    [],
  )

  // A right-edge fade while tabs sit past the edge (2026-11-18: at 390 Quests,
  // Retention and Settings were off-screen with no hint).
  const fade = useEdgeFade<HTMLDivElement>(hideTabs)

  if (hideTabs) return null

  return (
    <div ref={fade.ref} className={`-mx-1 min-w-0 overflow-x-auto pb-1 scroll-smooth [scrollbar-width:thin] ${fade.className}`} data-more={fade.more ? 'true' : undefined}>
      <SegmentedControl<RewardsTabId>
        ariaLabel="Rewards sections"
        value={active}
        options={options}
        onChange={onChange}
        size="sm"
        className="min-w-max"
      />
    </div>
  )
}
