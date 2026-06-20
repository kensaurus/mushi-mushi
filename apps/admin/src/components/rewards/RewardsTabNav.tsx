/**
 * FILE: RewardsTabNav.tsx
 * PURPOSE: Mode-aware tab navigation for Rewards — scrollable SegmentedControl.
 */

import { useMemo } from 'react'
import { SegmentedControl } from '../ui'
import type { RewardsTabId } from './types'
import { REWARDS_TABS } from './rewardsTabs'

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

  if (hideTabs) return null

  return (
    <div className="-mx-1 min-w-0 overflow-x-auto pb-1 scroll-smooth [scrollbar-width:thin]">
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
